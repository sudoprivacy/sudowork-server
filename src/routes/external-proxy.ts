/**
 * External API Proxy Routes
 * Proxy requests to sudoworkhub.sudoprivacy.com
 */

import { Hono } from "hono";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { applyAssistantMetadataOverrides } from "../services/AssistantMetadataOverrideService.js";

const SKILLHUB_BASE_URL = (
  process.env.SKILLHUB_BASE_URL || "https://sudoworkhub.sudoprivacy.com"
).replace(/\/+$/, "");
const SKILLHUB_API_TOKEN = process.env.SKILLHUB_API_TOKEN || "sud0@sudo";

const proxyRoutes = new Hono();
const PROXY_HEADERS = {
  Authorization: SKILLHUB_API_TOKEN,
  "Content-Type": "application/json",
};
const SUDOHUB_CURSOR_LIMIT = 100;

async function parseProxyResponse(response: Response) {
  const rawText = await response.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return { success: response.ok, message: rawText };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function enterpriseIdForTenantCode(tenantId?: string): number | undefined {
  if (!tenantId) return undefined;
  const row = db
    .prepare(`SELECT id FROM enterprises WHERE code = ?`)
    .get(tenantId) as { id: number } | undefined;
  return row?.id;
}

function normalizeTenantCodes(
  values: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function readAssistantTenantCodes(
  record: Record<string, unknown>,
  fallbackTenantCode?: string,
): string[] {
  const rawPlural = record.tenantIds ?? record.tenant_ids;
  if (Array.isArray(rawPlural)) {
    const tenantCodes = normalizeTenantCodes(
      rawPlural.map((item) => (typeof item === "string" ? item : undefined)),
    );
    if (tenantCodes.length > 0) return tenantCodes;
  }
  const rawSingular = record.tenantId ?? record.tenant_id;
  return normalizeTenantCodes([
    typeof rawSingular === "string" ? rawSingular : undefined,
    fallbackTenantCode,
  ]);
}

function normalizeOwnedAssistantRows(
  rows: Array<Record<string, unknown>>,
  tenantCode?: string,
): Array<Record<string, unknown>> {
  return rows
    .map((row) => {
      const tenantIds = readAssistantTenantCodes(row, tenantCode);
      return {
        ...row,
        tenantId: tenantIds[0] ?? null,
        tenantIds,
      };
    })
    .filter((row) => {
      if (!tenantCode) return true;
      return readAssistantTenantCodes(row, tenantCode)[0] === tenantCode;
    });
}

function assistantCursorRows(body: unknown): {
  rows: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextCursor?: string;
} {
  const root = asRecord(body);
  const rootData = root?.data;
  const data = asRecord(rootData);
  const rawRows = Array.isArray(rootData)
    ? rootData
    : Array.isArray(data?.assistants)
      ? data.assistants
      : [];
  const rows = rawRows.filter(
    (item): item is Record<string, unknown> => !!asRecord(item),
  );
  const hasMoreValue = Array.isArray(rootData) ? root?.has_more : data?.has_more;
  const nextCursorValue = Array.isArray(rootData)
    ? root?.next_cursor
    : data?.next_cursor;
  return {
    rows,
    hasMore: hasMoreValue === true,
    nextCursor:
      typeof nextCursorValue === "string" && nextCursorValue.length > 0
        ? nextCursorValue
        : undefined,
  };
}

async function fetchAssistantsAdminCursor(params: URLSearchParams): Promise<{
  body: unknown;
  status: number;
  url: string;
}> {
  const url = `${SKILLHUB_BASE_URL}/api/assistants/admin/cursor?${params.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: PROXY_HEADERS,
  });
  return {
    body: await parseProxyResponse(response),
    status: response.status,
    url,
  };
}

function mergeAssistantOverridesIntoCursorResponse(
  body: unknown,
  enterpriseId?: number,
  tenantCode?: string,
): unknown {
  if (!enterpriseId) return body;

  const root = asRecord(body);
  if (!root) return body;

  if (Array.isArray(root.data)) {
    root.data = normalizeOwnedAssistantRows(
      applyAssistantMetadataOverrides(
        enterpriseId,
        root.data.filter(
          (item): item is Record<string, unknown> => !!asRecord(item),
        ),
      ),
      tenantCode,
    );
    return root;
  }

  const data = asRecord(root.data);
  if (data && Array.isArray(data.assistants)) {
    data.assistants = normalizeOwnedAssistantRows(
      applyAssistantMetadataOverrides(
        enterpriseId,
        data.assistants.filter(
          (item): item is Record<string, unknown> => !!asRecord(item),
        ),
      ),
      tenantCode,
    );
  }
  return root;
}

function stopRepeatedAssistantCursor(body: unknown, cursor?: string): unknown {
  if (!cursor) return body;
  const page = assistantCursorRows(body);
  if (page.nextCursor !== cursor) return body;

  const root = asRecord(body);
  const data = asRecord(root?.data);
  if (!root || !data) return body;

  // Avoid appending the same page forever if the upstream cursor does not move.
  data.assistants = [];
  data.has_more = false;
  data.next_cursor = null;
  return root;
}

function decodeSudohubCursorId(cursor?: string): string | undefined {
  if (!cursor) return undefined;

  try {
    const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const decoded = asRecord(
      JSON.parse(Buffer.from(padded, "base64").toString("utf8")),
    );
    return typeof decoded?.id === "string" ? decoded.id : undefined;
  } catch {
    return undefined;
  }
}

function trimAssistantsCoveredByCursor(body: unknown, cursor?: string): unknown {
  const cursorId = decodeSudohubCursorId(cursor);
  if (!cursorId) return body;

  const root = asRecord(body);
  if (!root) return body;

  if (Array.isArray(root.data)) {
    const index = root.data.findIndex((item) => asRecord(item)?.id === cursorId);
    if (index >= 0) root.data = root.data.slice(index + 1);
    return root;
  }

  const data = asRecord(root.data);
  if (!data || !Array.isArray(data.assistants)) return body;

  const index = data.assistants.findIndex(
    (item) => asRecord(item)?.id === cursorId,
  );
  if (index >= 0) data.assistants = data.assistants.slice(index + 1);
  return root;
}

// Proxy skills API
proxyRoutes.get(
  "/skills/cursor",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const tenantId = c.req.query("tenant_id");
    const cursor = c.req.query("cursor");
    const limit = c.req.query("limit");
    const query = c.req.query("query");
    const categories = c.req.query("categories");

    const params = new URLSearchParams();
    if (tenantId) params.append("tenant_id", tenantId);
    if (cursor) params.append("cursor", cursor);
    if (limit) params.append("limit", limit);
    if (query) params.append("query", query);
    if (categories) params.append("categories", categories);

    const url = `${SKILLHUB_BASE_URL}/api/skills/admin/cursor?${params.toString()}`;

    console.log("=== 专属技能请求 ===");
    console.log("完整URL:", url);
    console.log("请求参数:", Object.fromEntries(params));
    console.log("Authorization: 已配置, Content-Type: application/json");

    const response = await fetch(url, {
      method: "GET",
      headers: PROXY_HEADERS,
    });

    const data = await parseProxyResponse(response);
    console.log("响应状态:", response.status);
    console.log("响应数据:", JSON.stringify(data, null, 2));
    return c.json(data, response.status as 200);
  },
);

// Proxy assistants API
proxyRoutes.get(
  "/assistants/cursor",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const tenantId = c.req.query("tenant_id");
    const cursor = c.req.query("cursor");
    const limit = c.req.query("limit");
    const query = c.req.query("query");
    const category = c.req.query("category");

    console.log("=== 专属智能体请求 ===");
    console.log("请求参数:", {
      tenant_id: tenantId,
      cursor,
      limit,
      query,
      category,
    });
    console.log("Authorization: 已配置, Content-Type: application/json");

    const params = new URLSearchParams();
    if (tenantId) params.append("tenant_id", tenantId);
    if (cursor) params.append("cursor", cursor);
    // Sudohub repeats page 1 when `tenant_id + cursor` are combined. Pull the
    // largest supported tenant page up front so the admin UI is not capped at 20.
    if (tenantId) {
      params.append("limit", String(SUDOHUB_CURSOR_LIMIT));
    } else if (limit) {
      params.append("limit", limit);
    }
    if (query) params.append("query", query);
    if (category) params.append("category", category);
    const fetched = await fetchAssistantsAdminCursor(params);
    const data = stopRepeatedAssistantCursor(
      trimAssistantsCoveredByCursor(
        mergeAssistantOverridesIntoCursorResponse(
          fetched.body,
          enterpriseIdForTenantCode(tenantId),
          tenantId,
        ),
        cursor,
      ),
      cursor,
    );
    console.log("上游URL:", fetched.url);
    console.log("响应状态:", fetched.status);
    console.log("响应数据:", JSON.stringify(data, null, 2));
    return c.json(data, fetched.status as 200);
  },
);

// Approve skill API
proxyRoutes.post(
  "/skills/:skillId/approve",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const skillId = c.req.param("skillId");
    const url = `${SKILLHUB_BASE_URL}/api/skills/${skillId}/approve`;

    console.log("=== 审批专属技能请求 ===");
    console.log("完整URL:", url);
    console.log("skillId:", skillId);
    console.log("Authorization: 已配置, Content-Type: application/json");

    const response = await fetch(url, {
      method: "POST",
      headers: PROXY_HEADERS,
    });

    const data = await parseProxyResponse(response);
    console.log("响应状态:", response.status);
    console.log("响应数据:", JSON.stringify(data, null, 2));
    return c.json(data, response.status as 200);
  },
);

// Delete skill API
proxyRoutes.delete(
  "/skills/:skillId",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const skillId = c.req.param("skillId");
    const url = `${SKILLHUB_BASE_URL}/api/skills/${skillId}`;

    console.log("=== 删除专属技能请求 ===");
    console.log("完整URL:", url);
    console.log("skillId:", skillId);
    console.log("Authorization: 已配置, Content-Type: application/json");

    const response = await fetch(url, {
      method: "DELETE",
      headers: PROXY_HEADERS,
    });

    const data = await parseProxyResponse(response);
    console.log("响应状态:", response.status);
    console.log("响应数据:", JSON.stringify(data, null, 2));
    return c.json(data, response.status as 200);
  },
);

// Approve assistant API
proxyRoutes.post(
  "/assistants/:assistantId/approve",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const assistantId = c.req.param("assistantId");
    const url = `${SKILLHUB_BASE_URL}/api/assistants/${assistantId}/approve`;

    console.log("=== 审批专属智能体请求 ===");
    console.log("完整URL:", url);
    console.log("assistantId:", assistantId);
    console.log("Authorization: 已配置, Content-Type: application/json");

    const response = await fetch(url, {
      method: "POST",
      headers: PROXY_HEADERS,
    });

    const data = await parseProxyResponse(response);
    console.log("响应状态:", response.status);
    console.log("响应数据:", JSON.stringify(data, null, 2));
    return c.json(data, response.status as 200);
  },
);

// Delete assistant API
proxyRoutes.delete(
  "/assistants/:assistantId",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const assistantId = c.req.param("assistantId");
    const url = `${SKILLHUB_BASE_URL}/api/assistants/${assistantId}`;

    console.log("=== 删除专属智能体请求 ===");
    console.log("完整URL:", url);
    console.log("assistantId:", assistantId);
    console.log("Authorization: 已配置, Content-Type: application/json");

    const response = await fetch(url, {
      method: "DELETE",
      headers: PROXY_HEADERS,
    });

    const data = await parseProxyResponse(response);
    console.log("响应状态:", response.status);
    console.log("响应数据:", JSON.stringify(data, null, 2));
    return c.json(data, response.status as 200);
  },
);

export { proxyRoutes };
