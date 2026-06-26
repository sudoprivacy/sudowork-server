/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Thin HTTP client for the patched Dify deployment.
 *
 * Three call families are exposed:
 *  - system.*    : management endpoints in our `sudowork` blueprint, gated by
 *                  DIFY_SYSTEM_TOKEN bearer + X-Sudowork-Tenant header. Used
 *                  to provision tenants and create/list/delete Apps.
 *  - provision() : the bootstrap endpoint, HMAC-signed body (different from
 *                  bearer because the caller has no tenant yet).
 *  - service.*   : the upstream Dify Service API (Bearer = per-tenant API
 *                  key, dispenseable by `withTenantApiKey`). Used for chat
 *                  invocation + dataset queries.
 *
 * Streaming chat is implemented as a plain `fetch` returning the underlying
 * `Response` so route handlers can pipe SSE straight to Hono without buffering.
 */

import { createHmac } from "node:crypto";

import { db } from "../db/index.js";

const DIFY_BASE_URL = (process.env.DIFY_BASE_URL || "http://localhost:5001").replace(/\/+$/, "");
const SYSTEM_TOKEN = process.env.DIFY_SYSTEM_TOKEN || "";
const SYSTEM_SECRET = process.env.DIFY_SYSTEM_SECRET || "";

export class DifyClientError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(`[Dify ${status}] ${message}`);
    this.status = status;
    this.detail = detail;
  }
}

function requireSystemToken(): string {
  if (!SYSTEM_TOKEN) {
    throw new Error("DIFY_SYSTEM_TOKEN not configured: cannot call system endpoints");
  }
  return SYSTEM_TOKEN;
}

function requireSystemSecret(): string {
  if (!SYSTEM_SECRET) {
    throw new Error("DIFY_SYSTEM_SECRET not configured: cannot call provisioning");
  }
  return SYSTEM_SECRET;
}

async function readJson(resp: Response): Promise<unknown> {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Provision a brand-new Dify Tenant for a SudoWork enterprise. Idempotency
 * is the caller's responsibility — see DifyTenantService.ensureTenant.
 */
export async function provisionTenant(args: {
  enterpriseCode: string;
  enterpriseName?: string;
}): Promise<{
  dify_tenant_id: string;
  system_account_id: string;
  service_api_key: string;
}> {
  const secret = requireSystemSecret();
  const body = JSON.stringify({
    enterprise_code: args.enterpriseCode,
    enterprise_name: args.enterpriseName || args.enterpriseCode,
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  const resp = await fetch(`${DIFY_BASE_URL}/sudowork/system/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sudowork-Signature": signature,
    },
    body,
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    throw new DifyClientError(resp.status, "tenant provisioning failed", data);
  }
  return data as { dify_tenant_id: string; system_account_id: string; service_api_key: string };
}

/**
 * System endpoints share auth shape: Bearer system token + X-Sudowork-Tenant.
 */
async function systemFetch(
  difyTenantId: string,
  path: string,
  init: { method: string; body?: unknown; actorAccountId?: string } = { method: "GET" },
): Promise<Response> {
  const token = requireSystemToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Sudowork-Tenant": difyTenantId,
  };
  if (init.actorAccountId) headers["X-Sudowork-Actor"] = init.actorAccountId;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${DIFY_BASE_URL}${path}`, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export interface CreateAppInput {
  name: string;
  description?: string;
  mode?: "chat" | "agent-chat" | "agent" | "advanced-chat" | "workflow" | "completion";
  icon?: string;
  icon_type?: string;
  icon_background?: string;
}

export const system = {
  async createApp(
    difyTenantId: string,
    input: CreateAppInput,
    actorAccountId?: string,
  ): Promise<{ app_id: string; mode: string; name: string; app_api_key: string }> {
    const resp = await systemFetch(difyTenantId, "/sudowork/system/apps", {
      method: "POST",
      body: input,
      actorAccountId,
    });
    const data = await readJson(resp);
    if (!resp.ok) throw new DifyClientError(resp.status, "create app failed", data);
    return data as { app_id: string; mode: string; name: string; app_api_key: string };
  },

  async listApps(difyTenantId: string): Promise<Array<{ id: string; name: string; mode: string }>> {
    const resp = await systemFetch(difyTenantId, "/sudowork/system/apps", { method: "GET" });
    const data = await readJson(resp);
    if (!resp.ok) throw new DifyClientError(resp.status, "list apps failed", data);
    const out = data as { apps?: Array<{ id: string; name: string; mode: string }> };
    return out.apps ?? [];
  },

  async deleteApp(difyTenantId: string, appId: string): Promise<void> {
    const resp = await systemFetch(difyTenantId, `/sudowork/system/apps/${appId}`, {
      method: "DELETE",
    });
    if (!resp.ok) {
      const data = await readJson(resp);
      throw new DifyClientError(resp.status, "delete app failed", data);
    }
  },

  /**
   * List datasets in the given tenant. Used by the admin UI to populate the
   * "attach knowledge base" dropdown. The endpoint must exist on the Dify side
   * under the sudowork system blueprint; if not, this 404s and the UI degrades
   * to an empty list (admin can still SSO into Dify Studio to manage datasets).
   */
  async listDatasets(
    difyTenantId: string,
  ): Promise<Array<{ id: string; name: string; description?: string }>> {
    const resp = await systemFetch(difyTenantId, "/sudowork/system/datasets", { method: "GET" });
    const data = await readJson(resp);
    if (!resp.ok) throw new DifyClientError(resp.status, "list datasets failed", data);
    const out = data as { datasets?: Array<{ id: string; name: string; description?: string }> };
    return out.datasets ?? [];
  },

  /**
   * Rename the Dify tenant matching `difyTenantId`. Called when an admin
   * edits `enterprises.name` in sudowork-server, so the Dify workspace
   * title in the upper-left of Studio stays in step. The Dify-side endpoint
   * (PATCH /sudowork/system/tenant) resolves the tenant from the
   * X-Sudowork-Tenant header, not the body, so we don't pass the id in JSON.
   */
  async renameTenant(difyTenantId: string, name: string): Promise<{ id: string; name: string }> {
    // systemFetch already JSON.stringifies `body` when it's not undefined and
    // sets Content-Type. Passing a pre-stringified body would double-encode.
    const resp = await systemFetch(difyTenantId, "/sudowork/system/tenant", {
      method: "PATCH",
      body: { name },
    });
    const data = await readJson(resp);
    if (!resp.ok) throw new DifyClientError(resp.status, "rename tenant failed", data);
    return data as { id: string; name: string };
  },
};

/**
 * Look up the Service API key for a Dify tenant from the binding table.
 * Throws if the enterprise has not been provisioned.
 *
 * The api_key is plaintext; security relies on (a) sudowork-server's own DB
 * being a backend secret, and (b) this value never crossing the IPC boundary
 * to the client (we only forward Dify response bytes, never the key).
 */
export function loadServiceApiKey(enterpriseId: number): { difyTenantId: string; apiKey: string } {
  const row = db
    .prepare(`SELECT dify_tenant_id, api_key FROM dify_tenant_binding WHERE enterprise_id = ?`)
    .get(enterpriseId) as { dify_tenant_id: string; api_key: string } | undefined;
  if (!row) {
    throw new DifyClientError(404, `enterprise ${enterpriseId} has no Dify tenant binding`);
  }
  return { difyTenantId: row.dify_tenant_id, apiKey: row.api_key };
}

/**
 * Defense-in-depth deadline for the full Dify chat-messages SSE stream.
 * The caller's `signal` (if any) still wins; this is a backstop so a wedged
 * Dify never leaves the client/admin staring at an indefinite spinner.
 *
 * Sized to comfortably outlive the client-side `SUDOWORK_SERVER_CALL_TIMEOUT_MS`
 * (currently 300 s in fix-sudowork/sudowork/src/process/bridge/difyBridge.ts)
 * by 30 s so the client always sees a clean timeout error before this signal
 * fires — keeps error attribution on the client (where we have UI to surface
 * a degradation prompt) rather than us silently aborting mid-stream. Bump
 * this if you bump the client deadline.
 */
const STREAM_CHAT_TIMEOUT_MS = 330000;

/**
 * Pass-through chat invocation. Returns the raw Response so the caller can
 * stream SSE bytes directly back to the client. Caller MUST consume the
 * response or risk a leaked socket.
 */
export async function streamChat(args: {
  apiKey: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(STREAM_CHAT_TIMEOUT_MS);
  const signal = args.signal
    ? AbortSignal.any([args.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...args.body, response_mode: "streaming" }),
    signal,
  });
}

/**
 * Blocking chat invocation. Used by the enhancement path: we want the full
 * answer in one shot before injecting it into the local ACP context.
 *
 * Dify returns:
 *   { answer: string, message_id, conversation_id, created_at, ... }
 */
export async function blockingChat(args: {
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<{ answer: string; raw: unknown }> {
  const resp = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...args.body, response_mode: "blocking" }),
  });
  const data = (await readJson(resp)) as { answer?: string; message?: string } | null;
  if (!resp.ok) throw new DifyClientError(resp.status, "blocking chat failed", data);
  return { answer: String(data?.answer ?? data?.message ?? ""), raw: data };
}

/**
 * Streaming workflow run. We use streaming on the sudowork-server <-> Dify
 * hop so we can surface `node_started` / `node_finished` events as progress
 * indicators on the client, even though the client doesn't render the SSE
 * directly — it consumes a transformed event stream from sudowork-server.
 */
export async function streamWorkflow(args: {
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<Response> {
  return fetch(`${DIFY_BASE_URL}/v1/workflows/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...args.body, response_mode: "streaming" }),
  });
}

/**
 * Blocking workflow run — used as a simpler fallback path for callers that
 * just want the final output and don't care about progress.
 */
export async function blockingWorkflow(args: {
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<{ outputs: Record<string, unknown>; raw: unknown }> {
  const resp = await fetch(`${DIFY_BASE_URL}/v1/workflows/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...args.body, response_mode: "blocking" }),
  });
  const data = (await readJson(resp)) as { data?: { outputs?: Record<string, unknown> } } | null;
  if (!resp.ok) throw new DifyClientError(resp.status, "blocking workflow failed", data);
  return { outputs: data?.data?.outputs ?? {}, raw: data };
}

// ============================================================================
// Service API helpers — every chat-UX operation the client needs goes through
// one of these. None of them ever leaks the api_key onward; the route layer
// transforms responses into the SudoWork envelope { success, data }.
// ============================================================================

/** Bearer header shared by every Service API call. */
function bearer(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function svcJson(
  apiKey: string,
  method: "GET" | "POST" | "DELETE" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const resp = await fetch(`${DIFY_BASE_URL}${path}`, {
    method,
    headers: bearer(apiKey),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, `${method} ${path} failed`, data);
  return data;
}

/** Build a query-string suffix from a flat record, skipping null/undefined. */
function qs(params: Record<string, string | number | undefined | null>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

export const service = {
  /** Stop a streaming chat in flight. */
  stopChat: async (args: { apiKey: string; taskId: string; user: string }): Promise<unknown> =>
    svcJson(args.apiKey, "POST", `/v1/chat-messages/${args.taskId}/stop`, { user: args.user }),

  listConversations: async (args: {
    apiKey: string;
    user: string;
    lastId?: string;
    limit?: number;
    sortBy?: "created_at" | "-created_at" | "updated_at" | "-updated_at";
  }): Promise<unknown> =>
    svcJson(
      args.apiKey,
      "GET",
      `/v1/conversations${qs({
        user: args.user,
        last_id: args.lastId,
        limit: args.limit ?? 20,
        sort_by: args.sortBy ?? "-updated_at",
      })}`,
    ),

  deleteConversation: async (args: {
    apiKey: string;
    conversationId: string;
    user: string;
  }): Promise<void> => {
    const resp = await fetch(`${DIFY_BASE_URL}/v1/conversations/${args.conversationId}`, {
      method: "DELETE",
      headers: bearer(args.apiKey),
      body: JSON.stringify({ user: args.user }),
    });
    if (!resp.ok && resp.status !== 204) {
      const data = await readJson(resp);
      throw new DifyClientError(resp.status, "delete conversation failed", data);
    }
  },

  renameConversation: async (args: {
    apiKey: string;
    conversationId: string;
    user: string;
    name?: string;
    autoGenerate?: boolean;
  }): Promise<unknown> =>
    svcJson(args.apiKey, "POST", `/v1/conversations/${args.conversationId}/name`, {
      user: args.user,
      name: args.name ?? null,
      auto_generate: args.autoGenerate ?? false,
    }),

  listMessages: async (args: {
    apiKey: string;
    conversationId: string;
    user: string;
    firstId?: string;
    limit?: number;
  }): Promise<unknown> =>
    svcJson(
      args.apiKey,
      "GET",
      `/v1/messages${qs({
        conversation_id: args.conversationId,
        user: args.user,
        first_id: args.firstId,
        limit: args.limit ?? 20,
      })}`,
    ),

  feedback: async (args: {
    apiKey: string;
    messageId: string;
    user: string;
    rating: "like" | "dislike" | null;
    content?: string;
  }): Promise<unknown> =>
    svcJson(args.apiKey, "POST", `/v1/messages/${args.messageId}/feedbacks`, {
      user: args.user,
      rating: args.rating,
      content: args.content ?? null,
    }),

  suggested: async (args: {
    apiKey: string;
    messageId: string;
    user: string;
  }): Promise<unknown> =>
    svcJson(
      args.apiKey,
      "GET",
      `/v1/messages/${args.messageId}/suggested${qs({ user: args.user })}`,
    ),

  parameters: async (args: { apiKey: string }): Promise<unknown> =>
    svcJson(args.apiKey, "GET", `/v1/parameters`),

  meta: async (args: { apiKey: string }): Promise<unknown> => svcJson(args.apiKey, "GET", `/v1/meta`),

  /**
   * Multipart upload. We forward the raw client multipart body to Dify without
   * re-encoding; the only mutation is injecting/overriding the `user` field so
   * it always reflects the authenticated SudoWork user (clients cannot spoof
   * another user's file ownership).
   */
  uploadFile: async (args: {
    apiKey: string;
    user: string;
    file: { name: string; type: string; bytes: ArrayBuffer | Uint8Array | Blob };
  }): Promise<unknown> => {
    const form = new FormData();
    const blob =
      args.file.bytes instanceof Blob
        ? args.file.bytes
        : new Blob([args.file.bytes], { type: args.file.type });
    form.append("file", blob, args.file.name);
    form.append("user", args.user);
    const resp = await fetch(`${DIFY_BASE_URL}/v1/files/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
    });
    const data = await readJson(resp);
    if (!resp.ok) throw new DifyClientError(resp.status, "file upload failed", data);
    return data;
  },

  audioToText: async (args: {
    apiKey: string;
    user: string;
    file: { name: string; type: string; bytes: ArrayBuffer | Uint8Array | Blob };
  }): Promise<unknown> => {
    const form = new FormData();
    const blob =
      args.file.bytes instanceof Blob
        ? args.file.bytes
        : new Blob([args.file.bytes], { type: args.file.type });
    form.append("file", blob, args.file.name);
    form.append("user", args.user);
    const resp = await fetch(`${DIFY_BASE_URL}/v1/audio-to-text`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
    });
    const data = await readJson(resp);
    if (!resp.ok) throw new DifyClientError(resp.status, "audio-to-text failed", data);
    return data;
  },

  /**
   * Text-to-audio returns binary; we don't read it as JSON. Caller forwards
   * the raw Response body to the client (sudowork-server route does so).
   */
  textToAudioRaw: async (args: {
    apiKey: string;
    user: string;
    messageId?: string;
    text?: string;
    voice?: string;
    streaming?: boolean;
  }): Promise<Response> =>
    fetch(`${DIFY_BASE_URL}/v1/text-to-audio`, {
      method: "POST",
      headers: bearer(args.apiKey),
      body: JSON.stringify({
        user: args.user,
        message_id: args.messageId ?? null,
        text: args.text ?? null,
        voice: args.voice ?? null,
        streaming: args.streaming ?? false,
      }),
    }),
};

// 2026-06-26: removed `queryDataset()` which hit `/v1/datasets/{id}/queries`.
// That endpoint never existed in Dify 1.x — calls 404'd silently because the
// only caller wrapped them in `.catch(() => null)` to degrade gracefully.
// The replacement is `retrieveDataset()` below, which calls the proper
// `/v1/datasets/{id}/retrieve` (a.k.a. `/hit-testing`) handler. See
// `services/EnhancementInvocationService.ragOnlyAnswer` for the migration.

// ============================================================================
// Dataset CRUD via Service API
// ============================================================================
//
// 2026-06-23 P3 RAG 挂载：admin 端的「知识库」管理菜单全部经由这些函数代理到
// Dify Service API（用 tenant-scoped api_key，type='dataset'）。**不**走 Inner
// API，因为 Service API 已完整覆盖我们的需求，从而 Dify 侧零改动。

const DS_BASE = `${DIFY_BASE_URL}/v1/datasets`;

async function difyServiceFetch(
  apiKey: string,
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.jsonBody);
  }
  // strip the helper field so fetch() doesn't choke
  const { jsonBody: _jsonBody, ...rest } = init;
  void _jsonBody;
  return fetch(`${DS_BASE}${path}`, { ...rest, headers });
}

export interface DifyDatasetSummary {
  id: string;
  name: string;
  description: string | null;
  permission: string;
  document_count?: number;
  word_count?: number;
  app_count?: number;
  indexing_technique?: string | null;
  created_at?: number;
  updated_at?: number;
}

export async function listDatasetsServiceApi(
  apiKey: string,
  args: { page?: number; limit?: number; keyword?: string } = {},
): Promise<{ data: DifyDatasetSummary[]; has_more: boolean; total: number }> {
  const params = new URLSearchParams();
  if (args.page) params.set("page", String(args.page));
  if (args.limit) params.set("limit", String(args.limit));
  if (args.keyword) params.set("keyword", args.keyword);
  const qs = params.toString();
  const resp = await difyServiceFetch(apiKey, qs ? `?${qs}` : "", { method: "GET" });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "list datasets failed", data);
  return data as { data: DifyDatasetSummary[]; has_more: boolean; total: number };
}

export async function getDataset(apiKey: string, datasetId: string): Promise<DifyDatasetSummary> {
  const resp = await difyServiceFetch(apiKey, `/${datasetId}`, { method: "GET" });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "get dataset failed", data);
  return data as DifyDatasetSummary;
}

export async function createDataset(
  apiKey: string,
  body: {
    name: string;
    description?: string;
    indexing_technique?: "high_quality" | "economy";
    permission?: "only_me" | "all_team_members" | "partial_members";
  },
): Promise<DifyDatasetSummary> {
  // 2026-06-23: default to all_team_members so SSO'd enterprise admins can see
  // the dataset in Dify Studio. The api_key minted at tenant provisioning is
  // owned by the "SudoWork System" account; with only_me, datasets we create
  // are invisible to every other Account (including the human admins). Since
  // a Dify tenant == an enterprise in our model, "all team members" is the
  // intended sharing scope.
  //
  // CAREFUL: `...body` could carry `permission: undefined` (admin route always
  // forwards the form field). Spread of `undefined` would overwrite our
  // default back to undefined, and Dify falls back to `only_me`. So spread
  // first, then apply the resolved permission last to make undefined
  // explicitly fall through to the default.
  const resp = await difyServiceFetch(apiKey, "", {
    method: "POST",
    jsonBody: { ...body, permission: body.permission ?? "all_team_members" },
  });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "create dataset failed", data);
  return data as DifyDatasetSummary;
}

export async function updateDataset(
  apiKey: string,
  datasetId: string,
  patch: {
    name?: string;
    description?: string;
    permission?: "only_me" | "all_team_members" | "partial_members";
  },
): Promise<DifyDatasetSummary> {
  const resp = await difyServiceFetch(apiKey, `/${datasetId}`, {
    method: "PATCH",
    jsonBody: patch,
  });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "update dataset failed", data);
  return data as DifyDatasetSummary;
}

export async function deleteDataset(apiKey: string, datasetId: string): Promise<void> {
  const resp = await difyServiceFetch(apiKey, `/${datasetId}`, { method: "DELETE" });
  if (!resp.ok && resp.status !== 204) {
    const data = await readJson(resp);
    throw new DifyClientError(resp.status, "delete dataset failed", data);
  }
}

export interface DifyDocumentSummary {
  id: string;
  name: string;
  data_source_type?: string;
  indexing_status?: string;
  enabled?: boolean;
  word_count?: number;
  hit_count?: number;
  created_at?: number;
  display_status?: string;
}

export async function listDocuments(
  apiKey: string,
  datasetId: string,
  args: { page?: number; limit?: number; keyword?: string } = {},
): Promise<{ data: DifyDocumentSummary[]; total: number; has_more: boolean }> {
  const params = new URLSearchParams();
  if (args.page) params.set("page", String(args.page));
  if (args.limit) params.set("limit", String(args.limit));
  if (args.keyword) params.set("keyword", args.keyword);
  const qs = params.toString();
  const resp = await difyServiceFetch(
    apiKey,
    `/${datasetId}/documents${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "list documents failed", data);
  return data as { data: DifyDocumentSummary[]; total: number; has_more: boolean };
}

export async function createDocumentByText(
  apiKey: string,
  datasetId: string,
  body: {
    name: string;
    text: string;
    indexing_technique?: "high_quality" | "economy";
    process_rule?: Record<string, unknown>;
  },
): Promise<{ document: DifyDocumentSummary; batch?: string }> {
  const resp = await difyServiceFetch(apiKey, `/${datasetId}/document/create-by-text`, {
    method: "POST",
    jsonBody: {
      indexing_technique: "economy",
      process_rule: { mode: "automatic" },
      ...body,
    },
  });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "create-by-text failed", data);
  return data as { document: DifyDocumentSummary; batch?: string };
}

/**
 * Multipart upload variant. The caller already has a Blob/File-shaped object
 * (e.g., from Hono's `formData()` parsing); we just attach it to a fresh
 * FormData and let Dify do the rest.
 */
export async function createDocumentByFile(
  apiKey: string,
  datasetId: string,
  args: {
    file: Blob;
    fileName: string;
    indexingTechnique?: "high_quality" | "economy";
    processRule?: Record<string, unknown>;
  },
): Promise<{ document: DifyDocumentSummary; batch?: string }> {
  const form = new FormData();
  const dataPayload = {
    indexing_technique: args.indexingTechnique ?? "economy",
    process_rule: args.processRule ?? { mode: "automatic" },
  };
  form.append("data", JSON.stringify(dataPayload));
  form.append("file", args.file, args.fileName);
  const resp = await fetch(`${DS_BASE}/${datasetId}/document/create-by-file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "create-by-file failed", data);
  return data as { document: DifyDocumentSummary; batch?: string };
}

export async function deleteDocument(
  apiKey: string,
  datasetId: string,
  documentId: string,
): Promise<void> {
  const resp = await difyServiceFetch(apiKey, `/${datasetId}/documents/${documentId}`, {
    method: "DELETE",
  });
  if (!resp.ok && resp.status !== 204) {
    const data = await readJson(resp);
    throw new DifyClientError(resp.status, "delete document failed", data);
  }
}

/**
 * Test query that mirrors what admin "查询测试" UI uses. Wraps
 * `/v1/datasets/{id}/retrieve` (the proper hit-testing endpoint). Returns
 * the records array directly so callers don't have to dig.
 *
 * Schema note: Dify requires `reranking_enable` and `score_threshold_enabled`
 * to be present even when irrelevant; defaults are set here so callers can
 * pass a minimal body.
 */
export async function retrieveDataset(
  apiKey: string,
  datasetId: string,
  body: {
    query: string;
    retrieval_model?: {
      search_method?: "semantic_search" | "full_text_search" | "hybrid_search" | "keyword_search";
      top_k?: number;
      score_threshold?: number;
      reranking_enable?: boolean;
      reranking_model?: { reranking_provider_name?: string; reranking_model_name?: string };
      score_threshold_enabled?: boolean;
    };
  },
): Promise<unknown> {
  const rmDefaults = {
    search_method: "semantic_search" as const,
    top_k: 5,
    reranking_enable: false,
    score_threshold_enabled: false,
  };
  const merged = { ...rmDefaults, ...(body.retrieval_model ?? {}) };
  const resp = await difyServiceFetch(apiKey, `/${datasetId}/retrieve`, {
    method: "POST",
    jsonBody: { query: body.query, retrieval_model: merged },
  });
  const data = await readJson(resp);
  if (!resp.ok) throw new DifyClientError(resp.status, "retrieve failed", data);
  return data;
}

/**
 * Convenience wrapper for routes: resolve the API key, then run `fn`.
 */
export async function withTenantApiKey<T>(
  enterpriseId: number,
  fn: (ctx: { difyTenantId: string; apiKey: string }) => Promise<T>,
): Promise<T> {
  const ctx = loadServiceApiKey(enterpriseId);
  return fn(ctx);
}

export const DIFY_BASE = DIFY_BASE_URL;
