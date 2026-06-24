/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Admin-side knowledge base (dataset) management routes.
 *
 * 2026-06-23 P3 RAG 挂载: full CRUD over Dify datasets + documents from
 * the sudowork-server admin UI, so administrators no longer need to SSO
 * into Dify Studio for routine knowledge base operations.
 *
 * Implementation: every endpoint proxies to the Dify Service API
 * (/v1/datasets/*) using the tenant-scoped `dataset` api_key. **No** new Dify
 * Inner API endpoints are required — Service API already covers everything.
 *
 * Auth & scoping: admin-only middleware applied at router level. Enterprise id
 * is resolved per request via `resolveAdminEnterpriseId` (super admin: query/
 * body field; enterprise admin: auto from JWT).
 */

import { Hono } from "hono";
import type { Context } from "hono";

import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import {
  resolveAdminEnterpriseId,
  resolveFromQuery,
  resolveFromBody,
  type ResolveResult,
} from "../services/AdminEnterpriseResolver.js";
import {
  createDataset,
  createDocumentByFile,
  createDocumentByText,
  deleteDataset,
  deleteDocument,
  getDataset,
  listDatasetsServiceApi,
  listDocuments,
  loadServiceApiKey,
  retrieveDataset,
  updateDataset,
  DifyClientError,
} from "../services/DifyClient.js";

const adminDatasetsRoutes = new Hono();

adminDatasetsRoutes.use("*", authMiddleware);
adminDatasetsRoutes.use("*", adminMiddleware);

function resolveOrFail(c: Context, r: ResolveResult): number | Response {
  if (r.ok) return r.enterpriseId;
  return c.json({ success: false, msg: r.msg }, r.status);
}

/**
 * Pull the tenant-scoped api key. If the enterprise has never been
 * provisioned (i.e. nobody ever opened the Dify Studio link), bubble up
 * a helpful 409 instead of a generic 500 — the admin needs to know they
 * have to bootstrap first.
 */
function loadApiKeyOrFail(c: Context, enterpriseId: number): { apiKey: string } | Response {
  try {
    return { apiKey: loadServiceApiKey(enterpriseId).apiKey };
  } catch (err) {
    return c.json(
      {
        success: false,
        msg:
          "enterprise has no Dify tenant binding yet; open Dify Studio once " +
          "to provision the tenant before managing datasets",
        detail: (err as Error).message,
      },
      409,
    );
  }
}

function difyErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof DifyClientError) {
    return c.json({ success: false, msg: err.message, detail: err.body }, err.status as 400);
  }
  return c.json({ success: false, msg: (err as Error).message }, 500);
}

// ============================================================================
// Datasets
// ============================================================================

adminDatasetsRoutes.get("/datasets", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  const url = new URL(c.req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? "30") || 30);
  const keyword = url.searchParams.get("keyword") ?? undefined;

  try {
    const data = await listDatasetsServiceApi(keyOrResp.apiKey, { page, limit, keyword });
    return c.json({ success: true, data });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

adminDatasetsRoutes.post("/datasets", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        name: string;
        description?: string;
        indexing_technique?: "high_quality" | "economy";
        permission?: "only_me" | "all_team_members" | "partial_members";
      }
    | null;
  if (!body || !body.name) return c.json({ success: false, msg: "name is required" }, 400);

  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  try {
    const created = await createDataset(keyOrResp.apiKey, {
      name: body.name,
      description: body.description,
      indexing_technique: body.indexing_technique,
      permission: body.permission,
    });
    return c.json({ success: true, data: created });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

adminDatasetsRoutes.get("/datasets/:datasetId", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  try {
    const data = await getDataset(keyOrResp.apiKey, c.req.param("datasetId"));
    return c.json({ success: true, data });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

adminDatasetsRoutes.patch("/datasets/:datasetId", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        name?: string;
        description?: string;
        permission?: "only_me" | "all_team_members" | "partial_members";
      }
    | null;
  if (!body) return c.json({ success: false, msg: "body required" }, 400);

  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  try {
    const updated = await updateDataset(keyOrResp.apiKey, c.req.param("datasetId"), {
      name: body.name,
      description: body.description,
      permission: body.permission,
    });
    return c.json({ success: true, data: updated });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

adminDatasetsRoutes.delete("/datasets/:datasetId", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  try {
    await deleteDataset(keyOrResp.apiKey, c.req.param("datasetId"));
    return c.json({ success: true });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

// ============================================================================
// Documents (within a dataset)
// ============================================================================

adminDatasetsRoutes.get("/datasets/:datasetId/documents", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  const url = new URL(c.req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? "50") || 50);
  const keyword = url.searchParams.get("keyword") ?? undefined;

  try {
    const data = await listDocuments(keyOrResp.apiKey, c.req.param("datasetId"), {
      page,
      limit,
      keyword,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

/**
 * Two payload shapes, distinguished by `Content-Type`:
 *   - `multipart/form-data`: upload a file. Fields: `file` (binary),
 *     optionally `enterprise_id`, `indexing_technique`.
 *   - `application/json`: text-only document. Fields: `name`, `text`,
 *     optionally `enterprise_id`, `indexing_technique`.
 */
adminDatasetsRoutes.post("/datasets/:datasetId/documents", async (c) => {
  const datasetId = c.req.param("datasetId");
  const contentType = c.req.header("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ success: false, msg: "expected multipart/form-data" }, 400);

    const enterpriseIdRaw = form.get("enterprise_id");
    const enterpriseId = resolveOrFail(
      c,
      resolveAdminEnterpriseId(c, {
        kind: "body",
        value: typeof enterpriseIdRaw === "string" ? enterpriseIdRaw : undefined,
      }),
    );
    if (typeof enterpriseId !== "number") return enterpriseId;
    const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
    if (keyOrResp instanceof Response) return keyOrResp;

    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ success: false, msg: "file field missing or not a file" }, 400);
    }
    const indexingTechnique = (form.get("indexing_technique") as string | null) as
      | "high_quality"
      | "economy"
      | null;

    try {
      const result = await createDocumentByFile(keyOrResp.apiKey, datasetId, {
        file,
        fileName: file.name,
        indexingTechnique: indexingTechnique ?? undefined,
      });
      return c.json({ success: true, data: result });
    } catch (err) {
      return difyErrorResponse(c, err);
    }
  }

  // JSON / text-mode upload
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        name: string;
        text: string;
        indexing_technique?: "high_quality" | "economy";
      }
    | null;
  if (!body || !body.name || !body.text) {
    return c.json({ success: false, msg: "name and text are required" }, 400);
  }

  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  try {
    const result = await createDocumentByText(keyOrResp.apiKey, datasetId, {
      name: body.name,
      text: body.text,
      indexing_technique: body.indexing_technique,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

adminDatasetsRoutes.delete("/datasets/:datasetId/documents/:documentId", async (c) => {
  const enterpriseId = resolveOrFail(c, resolveFromQuery(c));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  try {
    await deleteDocument(
      keyOrResp.apiKey,
      c.req.param("datasetId"),
      c.req.param("documentId"),
    );
    return c.json({ success: true });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

// ============================================================================
// Test query (hit-testing)
// ============================================================================

adminDatasetsRoutes.post("/datasets/:datasetId/retrieve", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        enterprise_id?: number | string;
        query: string;
        retrieval_model?: Record<string, unknown>;
      }
    | null;
  if (!body || !body.query) return c.json({ success: false, msg: "query required" }, 400);

  const enterpriseId = resolveOrFail(c, resolveFromBody(c, body));
  if (typeof enterpriseId !== "number") return enterpriseId;
  const keyOrResp = loadApiKeyOrFail(c, enterpriseId);
  if (keyOrResp instanceof Response) return keyOrResp;

  try {
    const data = await retrieveDataset(keyOrResp.apiKey, c.req.param("datasetId"), {
      query: body.query,
      retrieval_model: body.retrieval_model as Parameters<typeof retrieveDataset>[2]["retrieval_model"],
    });
    return c.json({ success: true, data });
  } catch (err) {
    return difyErrorResponse(c, err);
  }
});

export { adminDatasetsRoutes };
