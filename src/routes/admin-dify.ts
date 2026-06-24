/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Admin-facing Dify integration endpoints.
 *
 * Mounted at /api/v1/admin/dify by index.ts. All routes require an enterprise
 * admin or super admin. Two URL shapes show up:
 *
 *   /sso             — issue & 302 to a SudoWork-signed JWT landing URL.
 *   /agents          — list / create / inspect / delete agents (Dify Apps).
 *   /agents/:id/acl  — replace visibility ACL for an assistant.
 *   /agents/:id/datasets — replace knowledge-base bindings.
 *
 * The Dify Studio editing path is "open in new tab", driven by /sso?next=…
 *
 * Enterprise scoping (added 2026-06-20):
 *   - SUPER_ADMIN must explicitly specify `enterprise_id` via query / body /
 *     form field so the same endpoints can drive a cross-tenant admin UI.
 *   - ENTERPRISE_ADMIN auto-scopes to their JWT enterprise_id; passing a
 *     mismatched id is rejected with 403.
 *   - The `resolveAdminEnterpriseId` helper centralizes this logic; if it
 *     ever needs to change (e.g. add a tenant-code variant) we touch one
 *     place instead of 12.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import {
  createAgent,
  deleteAgent,
  findAgent,
  listAcl,
  listAgentsForEnterprise,
  listDatasets,
  replaceAcl,
  replaceDatasets,
  type AclEntry,
  type AclSubjectType,
  type AgentMode,
} from "../services/DifyAgentService.js";
import {
  createEnterpriseAssistant,
  getEnhancement as getEnhancementInfo,
  setEnhancement,
  type EnhancementMode,
} from "../services/EnterpriseAssistantService.js";
import { buildSsoLink } from "../services/DifySsoService.js";
import { ensureTenantBinding, findBinding } from "../services/DifyTenantService.js";
import { db } from "../db/index.js";
import * as sudohub from "../services/SudohubClient.js";
import { system as difySystem } from "../services/DifyClient.js";
import {
  resolveAdminEnterpriseId,
  resolveFromBody,
  resolveFromQuery,
  type ResolveResult,
} from "../services/AdminEnterpriseResolver.js";

const adminDifyRoutes = new Hono();

adminDifyRoutes.use("*", authMiddleware);
adminDifyRoutes.use("*", adminMiddleware);

/** Tiny adapter so handlers can either get `enterpriseId` or short-circuit. */
function resolveOrFail(c: Context, r: ResolveResult): number | Response {
  if (r.ok) return r.enterpriseId;
  return c.json({ success: false, msg: r.msg }, r.status);
}

/**
 * Resolve the admin's enterprise.code for sudohub `tenantId` plumbing.
 */
function loadEnterpriseCode(enterpriseId: number): string {
  const row = db
    .prepare(`SELECT code FROM enterprises WHERE id = ?`)
    .get(enterpriseId) as { code: string } | undefined;
  if (!row) throw new Error(`enterprise ${enterpriseId} missing`);
  return row.code;
}

function aclSummary(rows: Array<{ subject_type: string; subject_id: string | null }>): {
  scope: "all" | "specific";
  user_ids: string[];
} {
  if (rows.length === 0) return { scope: "all", user_ids: [] };
  if (rows.some((r) => r.subject_type === "all")) return { scope: "all", user_ids: [] };
  return {
    scope: "specific",
    user_ids: rows.filter((r) => r.subject_type === "user" && r.subject_id).map((r) => r.subject_id!),
  };
}

// ============================================
// SSO + binding
// ============================================

/**
 * GET /admin/dify/sso?next=/datasets[&enterprise_id=N]
 *
 * Provisions the Dify tenant if needed and mints a 5-minute JWT. Returns
 * the resulting SSO URL as JSON so the admin SPA can `window.open(url)` in
 * a new tab — direct `window.open('/sso')` won't work because the browser
 * tab wouldn't carry the Authorization header that authMiddleware requires.
 *
 * Response: { success: true, data: { url: 'http://dify.../sudowork/sso/exchange?token=...' } }
 *
 * `format=redirect` query param is kept for any future server-driven 302
 * use cases (e.g., a session-cookie-authenticated future flow) but is NOT
 * what the current admin SPA uses.
 */
adminDifyRoutes.get("/sso", async (c) => {
  const r = resolveFromQuery(c);
  const enterpriseId = resolveOrFail(c, r);
  if (typeof enterpriseId !== "number") return enterpriseId;
  const user = c.get("user");
  try {
    const binding = await ensureTenantBinding(enterpriseId);
    const next = c.req.query("next") || "/apps";
    const link = await buildSsoLink(
      {
        sudoworkUserId: user.id,
        name: user.phone,
        enterpriseCode: String(binding.dify_tenant_id), // not user-visible
        difyTenantId: binding.dify_tenant_id,
        role: user.role === "SUPER_ADMIN" ? "admin" : "admin",
      },
      { next },
    );
    if (c.req.query("format") === "redirect") {
      return c.redirect(link.url, 302);
    }
    return c.json({ success: true, data: { url: link.url, expires_at: link.expiresAt } });
  } catch (err: any) {
    return c.json({ success: false, msg: err?.message || "sso failed" }, 500);
  }
});

/** GET /admin/dify/binding[?enterprise_id=N] — debug helper. */
adminDifyRoutes.get("/binding", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const binding = findBinding(enterpriseId);
  return c.json({
    success: true,
    data: binding
      ? {
          dify_tenant_id: binding.dify_tenant_id,
          dify_system_account_id: binding.dify_system_account_id,
          created_at: binding.created_at,
        }
      : null,
  });
});

/** POST /admin/dify/binding/provision — explicit provisioning trigger. */
adminDifyRoutes.post("/binding/provision", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { enterprise_id?: number | string }
    | null;
  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  try {
    const binding = await ensureTenantBinding(enterpriseId);
    return c.json({
      success: true,
      data: {
        dify_tenant_id: binding.dify_tenant_id,
        dify_system_account_id: binding.dify_system_account_id,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, msg: err?.message || "provision failed" }, 500);
  }
});

// ============================================
// Agents (Dify Apps) CRUD
// ============================================

adminDifyRoutes.get("/agents", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const data = listAgentsForEnterprise(enterpriseId);
  return c.json({ success: true, data });
});

adminDifyRoutes.post("/agents", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        name?: string;
        description?: string;
        mode?: AgentMode;
        icon?: string;
        icon_type?: string;
        icon_background?: string;
        assistant_id?: string;
      }
    | null;
  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  if (!body?.name) {
    return c.json({ success: false, msg: "name is required" }, 400);
  }
  try {
    const agent = await createAgent({
      enterpriseId,
      name: body.name,
      description: body.description,
      mode: body.mode,
      icon: body.icon,
      icon_type: body.icon_type,
      icon_background: body.icon_background,
      assistantId: body.assistant_id,
    });
    return c.json({ success: true, data: agent });
  } catch (err: any) {
    return c.json({ success: false, msg: err?.message || "create failed" }, 500);
  }
});

adminDifyRoutes.get("/agents/:assistantId", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const agent = findAgent(enterpriseId, c.req.param("assistantId"));
  if (!agent) return c.json({ success: false, msg: "not found" }, 404);
  return c.json({
    success: true,
    data: {
      ...agent,
      acl: listAcl(enterpriseId, agent.assistantId),
      datasets: listDatasets(enterpriseId, agent.assistantId),
    },
  });
});

adminDifyRoutes.delete("/agents/:assistantId", async (c) => {
  // DELETE may carry `enterprise_id` either in the query string or a JSON body;
  // we accept both since fetch().delete with a body is awkward in some clients.
  const bodyRaw = await c.req.json().catch(() => null);
  const fromQuery = resolveFromQuery(c);
  const enterpriseId = resolveOrFail(
    c,
    fromQuery.ok ? fromQuery : resolveFromBody(c, bodyRaw as { enterprise_id?: number | string } | null),
  );
  if (typeof enterpriseId !== "number") return enterpriseId;
  await deleteAgent(enterpriseId, c.req.param("assistantId"));
  return c.json({ success: true });
});

adminDifyRoutes.put("/agents/:assistantId/acl", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        entries?: Array<{ subject_type: AclSubjectType; subject_id?: string | null }>;
      }
    | null;
  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  if (!body?.entries) {
    return c.json({ success: false, msg: "entries is required" }, 400);
  }
  const entries: AclEntry[] = body.entries.map((e) => ({
    subjectType: e.subject_type,
    subjectId: e.subject_id ?? null,
  }));
  const updated = replaceAcl(enterpriseId, c.req.param("assistantId"), entries);
  return c.json({ success: true, data: updated });
});

// ============================================
// Enterprise assistants (the admin-facing form combines sudohub create with
// optional Dify enhancement + ACL in one transaction)
// ============================================

/**
 * List sudohub assistants for the (resolved) enterprise, annotated with
 * binding + ACL summary. This is the data source for the admin UI's
 * "专属助手" page (assistants tab).
 */
adminDifyRoutes.get("/enterprise-assistants", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;

  const enterpriseRow = db
    .prepare(`SELECT code FROM enterprises WHERE id = ?`)
    .get(enterpriseId) as { code: string } | undefined;
  if (!enterpriseRow) return c.json({ success: true, data: [] });

  let sudohubAssistants: Array<Record<string, unknown>> = [];
  try {
    // sudohub cursor shape is { success, message, data: { assistants, has_more, next_cursor } }.
    // Keep the legacy-flat shape as a fallback in case a future version
    // returns `data: [...]` directly.
    const body = (await sudohub.listAssistantsAdmin({
      tenantId: enterpriseRow.code,
      limit: 100,
    })) as
      | {
          data?:
            | Array<Record<string, unknown>>
            | { assistants?: Array<Record<string, unknown>> };
        }
      | null;
    const data = body?.data;
    sudohubAssistants = Array.isArray(data)
      ? data
      : Array.isArray((data as { assistants?: unknown })?.assistants)
        ? ((data as { assistants: Array<Record<string, unknown>> }).assistants)
        : [];
  } catch (err) {
    return c.json({ success: false, msg: `sudohub list failed: ${(err as Error).message}` }, 502);
  }

  const bindings = db
    .prepare(
      `SELECT assistant_id, dify_app_id, dify_app_mode
         FROM dify_app_binding WHERE enterprise_id = ?`,
    )
    .all(enterpriseId) as Array<{
    assistant_id: string;
    dify_app_id: string;
    dify_app_mode: string;
  }>;
  const bindingByAssistant = new Map(bindings.map((b) => [b.assistant_id, b]));

  // 2026-06-22 P2.5.1: surface the independent dataset-attachment dimension so
  // the admin UI can render "纯知识库" vs "Dify 增强" without an extra round-trip.
  const datasetRows = db
    .prepare(
      `SELECT assistant_id, dify_dataset_id FROM dify_dataset_binding WHERE enterprise_id = ?`,
    )
    .all(enterpriseId) as Array<{ assistant_id: string; dify_dataset_id: string }>;
  const datasetsByAssistant = new Map<string, string[]>();
  for (const row of datasetRows) {
    const list = datasetsByAssistant.get(row.assistant_id) ?? [];
    list.push(row.dify_dataset_id);
    datasetsByAssistant.set(row.assistant_id, list);
  }

  const aclRows = db
    .prepare(
      `SELECT assistant_id, subject_type, subject_id
         FROM assistant_acl WHERE enterprise_id = ?`,
    )
    .all(enterpriseId) as Array<{
    assistant_id: string;
    subject_type: string;
    subject_id: string | null;
  }>;
  const aclByAssistant = new Map<
    string,
    Array<{ subject_type: string; subject_id: string | null }>
  >();
  for (const row of aclRows) {
    const list = aclByAssistant.get(row.assistant_id) ?? [];
    list.push({ subject_type: row.subject_type, subject_id: row.subject_id });
    aclByAssistant.set(row.assistant_id, list);
  }

  const out = sudohubAssistants.map((a) => {
    const id = a.id as string;
    const binding = bindingByAssistant.get(id);
    const acl = aclByAssistant.get(id) || [];
    const datasetIds = datasetsByAssistant.get(id) || [];
    return {
      assistant_id: id,
      name: a.name,
      display_name: (a as { display_name?: string }).display_name,
      description: a.description,
      avatar: a.avatar,
      categories: a.categories,
      profession: a.profession,
      status: a.status,
      enhancement: binding
        ? {
            enabled: true,
            mode: binding.dify_app_mode,
            dify_app_id: binding.dify_app_id,
          }
        : { enabled: false },
      // Mutually exclusive with `enhancement.enabled` (see design doc).
      dataset_ids: datasetIds,
      acl_summary: aclSummary(acl),
    };
  });

  return c.json({ success: true, data: out });
});

/**
 * List datasets visible to the resolved tenant. Used by the dataset-binding
 * UI in the admin form. We do not cache; admins iterate rarely.
 */
adminDifyRoutes.get("/datasets", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  let binding;
  try {
    binding = await ensureTenantBinding(enterpriseId);
  } catch (err) {
    return c.json({ success: false, msg: `provisioning failed: ${(err as Error).message}` }, 500);
  }
  try {
    const datasets = await difySystem.listDatasets(binding.dify_tenant_id);
    return c.json({ success: true, data: datasets });
  } catch (err) {
    return c.json({ success: false, msg: `dataset list failed: ${(err as Error).message}` }, 502);
  }
});

adminDifyRoutes.post("/enterprise-assistants", async (c) => {
  // Accepts multipart/form-data so the admin form can carry prompt.md/avatar/zip
  // straight through to sudohub without re-encoding.
  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json({ success: false, msg: "expected multipart/form-data" }, 400);
  }

  const optional = (k: string): string | undefined => {
    const v = form.get(k);
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const required = (k: string): string | null => optional(k) ?? null;
  const jsonField = <T>(k: string): T | undefined => {
    const raw = optional(k);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  };
  const fileBytes = async (
    k: string,
  ): Promise<{ bytes: Buffer; name: string } | undefined> => {
    const f = form.get(k);
    if (!(f instanceof File)) return undefined;
    const buf = Buffer.from(await f.arrayBuffer());
    return { bytes: buf, name: f.name };
  };

  // Resolve enterprise from the form field (super admin) or JWT (enterprise admin).
  const enterpriseId = resolveOrFail(
    c,
    resolveAdminEnterpriseId(c, { kind: "body", value: optional("enterprise_id") }),
  );
  if (typeof enterpriseId !== "number") return enterpriseId;

  const name = required("name");
  const profession = required("profession");
  if (!name || !profession) {
    return c.json({ success: false, msg: "name and profession are required" }, 400);
  }

  const enhancementModeRaw = optional("enhancement_mode") as EnhancementMode | undefined;
  const enhancementEnabled = optional("enable_enhancement") === "true";
  const enhancement =
    enhancementEnabled && enhancementModeRaw ? { mode: enhancementModeRaw } : undefined;

  // 2026-06-22 P2.5.1: dataset_ids is the "纯知识库" path. Mutually exclusive
  // with Dify enhancement — reject the conflicting combo early so the
  // sudohub assistant doesn't get created in a bad state.
  const datasetIds = jsonField<string[]>("dataset_ids") ?? [];
  if (enhancement && datasetIds.length > 0) {
    return c.json(
      {
        success: false,
        msg: "enable_enhancement and dataset_ids are mutually exclusive — pick one",
      },
      400,
    );
  }

  const promptFile = await fileBytes("prompt_file");
  const avatar = await fileBytes("avatar");
  const sourceZip = await fileBytes("source_url");

  let tenantCode: string;
  try {
    tenantCode = loadEnterpriseCode(enterpriseId);
  } catch (err) {
    return c.json({ success: false, msg: (err as Error).message }, 500);
  }

  try {
    const summary = await createEnterpriseAssistant({
      enterpriseId,
      tenantCode,
      name,
      profession,
      description: optional("description"),
      defaultInitPrompt: optional("default_init_prompt"),
      categories: jsonField<string[]>("categories"),
      skills: jsonField<string[]>("skills"),
      promptFileBytes: promptFile?.bytes,
      promptFileName: promptFile?.name,
      avatarBytes: avatar?.bytes,
      avatarFileName: avatar?.name,
      sourceZipBytes: sourceZip?.bytes,
      sourceZipFileName: sourceZip?.name,
      aclEntries: jsonField<AclEntry[]>("acl_entries") ?? [],
      enhancement,
      datasetIds,
    });
    return c.json({ success: true, data: summary });
  } catch (err: any) {
    return c.json({ success: false, msg: err?.message || "create failed" }, 500);
  }
});

adminDifyRoutes.put("/enterprise-assistants/:assistantId/enhancement", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        enable: boolean;
        mode?: EnhancementMode;
        app_name?: string;
      }
    | null;
  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  if (!body || typeof body.enable !== "boolean") {
    return c.json({ success: false, msg: "enable (boolean) required" }, 400);
  }
  try {
    const result = await setEnhancement({
      enterpriseId,
      assistantId: c.req.param("assistantId"),
      enable: body.enable,
      mode: body.mode,
      appName: body.app_name,
    });
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, msg: err?.message || "update failed" }, 500);
  }
});

adminDifyRoutes.get("/enterprise-assistants/:assistantId/enhancement", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const info = getEnhancementInfo(enterpriseId, c.req.param("assistantId"));
  return c.json({ success: true, data: info });
});

adminDifyRoutes.get("/agents/:assistantId/datasets", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const ids = listDatasets(enterpriseId, c.req.param("assistantId"));
  return c.json({ success: true, data: ids });
});

adminDifyRoutes.put("/agents/:assistantId/datasets", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        dataset_ids?: string[];
      }
    | null;
  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  if (!body || !Array.isArray(body.dataset_ids)) {
    return c.json({ success: false, msg: "dataset_ids is required" }, 400);
  }
  try {
    const stored = replaceDatasets(enterpriseId, c.req.param("assistantId"), body.dataset_ids);
    return c.json({ success: true, data: stored });
  } catch (err: any) {
    return c.json({ success: false, msg: err?.message || "bind failed" }, 400);
  }
});

export { adminDifyRoutes };
