/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-user runtime routes for Dify-backed agents.
 *
 * Every route in this file:
 *   1. requires a SudoWork user JWT (authMiddleware);
 *   2. resolves the assistant via DifyAgentService and refuses 403 unless the
 *      caller is allowed by assistant_acl;
 *   3. looks up the per-enterprise Dify Service API key (never exposed past
 *      the process boundary) and uses it to talk to Dify;
 *   4. returns a SudoWork-shaped envelope { success, data } or, in the case
 *      of streaming endpoints, forwards the upstream bytes verbatim.
 *
 * This is the entire "client ↔ Dify" surface. The Electron client has zero
 * code that knows the Dify hostname, the API key, or the upstream URL.
 */

import { Hono } from "hono";

import { authMiddleware } from "../middleware/auth.js";
import { requireDifyConfigured } from "../middleware/dify-feature.js";
import { db } from "../db/index.js";
import {
  findAgent,
  listVisibleAgents,
  userCanSeeAgent,
} from "../services/DifyAgentService.js";
import {
  DifyClientError,
  loadServiceApiKey,
  service as difyService,
  streamChat,
  DIFY_BASE,
} from "../services/DifyClient.js";
import { getEnhancement } from "../services/EnterpriseAssistantService.js";
import {
  invokeBlocking,
  invokeStreaming,
} from "../services/EnhancementInvocationService.js";
import * as sudohub from "../services/SudohubClient.js";

const agentsRoutes = new Hono();

agentsRoutes.use("*", authMiddleware);
agentsRoutes.use("*", requireDifyConfigured);

/**
 * Build the EndUser identifier passed in the `user` field of Dify Service API
 * requests. Dify upserts an EndUser keyed on this string so every SudoWork
 * user gets their own conversation history & token-usage attribution while
 * still consuming zero Account seats.
 */
function endUserId(user: { id: number; enterprise_id?: number | null }): string {
  const ent = user.enterprise_id ?? 0;
  return `sudowork:${ent}:${user.id}`;
}

interface RuntimeContext {
  apiKey: string;
  user: string;
}

/**
 * Resolve the per-call context for a runtime request.
 *
 * Steps in order so failures map cleanly to status codes:
 *   - 400 if user has no enterprise;
 *   - 403 if the assistant exists but is not visible to the caller;
 *   - 404 if the assistant_id is unknown or the binding is missing;
 *   - 502 if the api_key lookup itself fails for an infra reason.
 */
function buildRuntimeContext(
  c: Parameters<typeof agentsRoutes.get>[1] extends infer H
    ? H extends (ctx: infer Ctx, ...rest: unknown[]) => unknown
      ? Ctx
      : never
    : never,
  assistantId: string,
):
  | { ok: true; ctx: RuntimeContext }
  | { ok: false; status: number; msg: string } {
  // The hono context type isn't fully inferred here; cast to any locally.
  const ctxAny = c as any;
  const userPayload = ctxAny.get("user");
  if (userPayload.enterprise_id == null) {
    return { ok: false, status: 400, msg: "user has no enterprise" };
  }
  const summary = {
    id: userPayload.id,
    role: userPayload.role,
    enterpriseId: userPayload.enterprise_id,
  };
  if (!userCanSeeAgent(summary, assistantId)) {
    return { ok: false, status: 403, msg: "agent not visible to user" };
  }
  const agent = findAgent(userPayload.enterprise_id, assistantId);
  if (!agent) {
    return { ok: false, status: 404, msg: "agent binding missing" };
  }
  try {
    const { apiKey } = loadServiceApiKey(userPayload.enterprise_id);
    return { ok: true, ctx: { apiKey, user: endUserId(userPayload) } };
  } catch (err) {
    const status = err instanceof DifyClientError ? err.status : 502;
    return { ok: false, status, msg: (err as Error).message };
  }
}

function failure(c: any, status: number, msg: string) {
  return c.json({ success: false, msg }, status);
}

function wrapClientError(c: any, err: unknown) {
  if (err instanceof DifyClientError) {
    return c.json(
      { success: false, msg: err.message, status: err.status, detail: err.detail },
      // Hono wants a strict status union; runtime values map fine.
      (err.status as 400) || 502,
    );
  }
  return c.json({ success: false, msg: (err as Error).message }, 502);
}

// ============================================================================
// Visibility / list
// ============================================================================

/**
 * `/visible` is the client's unified discovery endpoint. It returns every
 * sudohub-listed assistant the user is allowed to see, annotated with
 * enhancement metadata when applicable.
 *
 * Filtering pipeline:
 *   1. Pull tenant-scoped assistants from sudohub.
 *   2. For each, check sudowork-server `assistant_acl`:
 *        - no rows → default enterprise-wide visible
 *        - rows → user must satisfy at least one (`user` or `all` subject)
 *   3. Annotate with `enhancement` from `dify_app_binding`.
 *
 * The client uses the result to filter its locally-installed assistant list
 * and to know which assistants to wrap with pre-injection at chat time.
 */
agentsRoutes.get("/visible", async (c) => {
  const user = c.get("user");
  if (user.enterprise_id == null) {
    return c.json({ success: true, data: [] });
  }

  // Resolve enterprise.code for sudohub tenant_id parameter.
  const enterpriseRow = db
    .prepare(`SELECT code FROM enterprises WHERE id = ?`)
    .get(user.enterprise_id) as { code: string } | undefined;
  if (!enterpriseRow) {
    return c.json({ success: true, data: [] });
  }

  // 1. sudohub list
  //   sudohub cursor returns { success, data: { assistants, has_more, next_cursor } };
  //   legacy / hypothetical flat `data: []` is also accepted.
  let sudohubAssistants: Array<Record<string, unknown>> = [];
  try {
    const body = (await sudohub.listAssistants({
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

  // 2. ACL rows (group by assistant_id)
  const aclRows = db
    .prepare(
      `SELECT assistant_id, subject_type, subject_id FROM assistant_acl WHERE enterprise_id = ?`,
    )
    .all(user.enterprise_id) as Array<{
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
  const isAdmin = user.role === "SUPER_ADMIN" || user.role === "ENTERPRISE_ADMIN";
  function passesAcl(assistantId: string): boolean {
    const rules = aclByAssistant.get(assistantId);
    if (!rules || rules.length === 0) return true; // no ACL = visible to all enterprise users
    if (isAdmin) return true;
    return rules.some(
      (r) =>
        r.subject_type === "all" ||
        (r.subject_type === "user" && r.subject_id === String(user.id)),
    );
  }

  // 3. enhancement bindings
  const bindingRows = db
    .prepare(
      `SELECT assistant_id, dify_app_id, dify_app_mode, dify_tenant_id
         FROM dify_app_binding WHERE enterprise_id = ?`,
    )
    .all(user.enterprise_id) as Array<{
    assistant_id: string;
    dify_app_id: string;
    dify_app_mode: string;
    dify_tenant_id: string;
  }>;
  const bindingByAssistant = new Map(bindingRows.map((r) => [r.assistant_id, r]));

  // 4. merge
  const out = sudohubAssistants
    .filter((a) => typeof a.id === "string" && passesAcl(a.id as string))
    .map((a) => {
      const id = a.id as string;
      const binding = bindingByAssistant.get(id);
      return {
        assistant_id: id,
        // verbatim sudohub fields the client may use for display
        name: a.name,
        display_name: (a as { display_name?: string }).display_name,
        description: a.description,
        avatar: a.avatar,
        categories: a.categories,
        profession: a.profession,
        // enhancement annotation
        enhancement: binding
          ? {
              enabled: true,
              mode: binding.dify_app_mode,
              dify_app_id: binding.dify_app_id,
              dify_tenant_id: binding.dify_tenant_id,
            }
          : { enabled: false },
      };
    });

  return c.json({ success: true, data: out });
});

/**
 * Legacy/internal: the binding-only view (no sudohub join). Useful for admin
 * tooling and as a fallback when sudohub is unreachable.
 */
agentsRoutes.get("/visible/bindings", async (c) => {
  const user = c.get("user");
  if (user.enterprise_id == null) return c.json({ success: true, data: [] });
  const agents = listVisibleAgents({
    id: user.id,
    role: user.role,
    enterpriseId: user.enterprise_id,
  });
  return c.json({
    success: true,
    data: agents.map((a) => ({
      assistant_id: a.assistantId,
      runtime: "dify" as const,
      dify_app_id: a.difyAppId,
      dify_app_mode: a.difyAppMode,
      dify_tenant_id: a.difyTenantId,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    })),
  });
});

// ============================================================================
// Chat (streaming) + stop
// ============================================================================

interface ChatPayload {
  query: string;
  conversation_id?: string;
  inputs?: Record<string, unknown>;
  files?: unknown[];
  auto_generate_name?: boolean;
}

// ============================================================================
// Enhancement (pre-injection): the client calls these to enrich a single
// user turn with the assistant's Dify-side capabilities before handing the
// message off to the local ACP backend.
// ============================================================================

/**
 * Lightweight probe — the client can call this at chat session startup to
 * decide whether to wire up pre-injection at all. Returns a stable shape
 * even for non-enhanced assistants.
 */
agentsRoutes.get("/:assistantId/enhancement", async (c) => {
  const user = c.get("user");
  if (user.enterprise_id == null) {
    return failure(c, 400, "user has no enterprise");
  }
  const info = getEnhancement(user.enterprise_id, c.req.param("assistantId"));
  return c.json({
    success: true,
    data: {
      enabled: info.enabled,
      mode: info.mode,
    },
  });
});

/**
 * Blocking enhancement call. Dispatched for the agent-chat / dataset / workflow
 * paths (workflow can also use blocking but loses progress events). Path
 * selection happens inside `EnhancementInvocationService.invokeBlocking`
 * based on `(dify_app_binding, dify_dataset_binding)` — see design doc
 * "知识增强：两个维度".
 */
agentsRoutes.post("/:assistantId/enhancement/invoke", async (c) => {
  const user = c.get("user");
  if (user.enterprise_id == null) {
    return failure(c, 400, "user has no enterprise");
  }
  const assistantId = c.req.param("assistantId");
  // We don't gate enhancement on userCanSeeAgent today because plain sudohub
  // assistants might be enhanced later; visibility is enforced by /visible
  // and the client should only call this for assistants it knows are visible.
  // Cheap guard: enhancement must exist.
  const body = (await c.req.json().catch(() => null)) as
    | { query: string; conversation_id?: string }
    | null;
  if (!body || typeof body.query !== "string" || body.query.length === 0) {
    return failure(c, 400, "query is required");
  }
  try {
    const result = await invokeBlocking({
      enterpriseId: user.enterprise_id,
      assistantId,
      user: endUserId(user),
      query: body.query,
      conversationId: body.conversation_id,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

/**
 * Streaming enhancement call — used for `workflow` mode so the client can
 * render `node_started` progress as it happens. The final `result` event
 * carries the text to inject into the local ACP context.
 *
 * SSE event types emitted:
 *   - event: progress  data: { step, nodeId?, nodeType? }
 *   - event: result    data: { text, mode, elapsedMs, citations? }
 *   - event: error     data: { message, status? }
 */
agentsRoutes.post("/:assistantId/enhancement/invoke-stream", async (c) => {
  const user = c.get("user");
  if (user.enterprise_id == null) {
    return failure(c, 400, "user has no enterprise");
  }
  const body = (await c.req.json().catch(() => null)) as
    | { query: string; conversation_id?: string }
    | null;
  if (!body || typeof body.query !== "string" || body.query.length === 0) {
    return failure(c, 400, "query is required");
  }
  const assistantId = c.req.param("assistantId");
  const userTag = endUserId(user);
  const ctx = {
    enterpriseId: user.enterprise_id,
    assistantId,
    user: userTag,
    query: body.query,
    conversationId: body.conversation_id,
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      function emit(event: string, payload: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
        );
      }
      try {
        for await (const evt of invokeStreaming(ctx)) {
          emit(evt.kind, evt);
        }
      } catch (err) {
        emit("error", { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Dify-Upstream": DIFY_BASE,
    },
  });
});

agentsRoutes.post("/:assistantId/chat", async (c) => {
  const assistantId = c.req.param("assistantId");
  const built = buildRuntimeContext(c, assistantId);
  if (!built.ok) return failure(c, built.status, built.msg);

  const body = (await c.req.json().catch(() => null)) as ChatPayload | null;
  if (!body || typeof body.query !== "string" || body.query.length === 0) {
    return failure(c, 400, "query is required");
  }

  let upstream: Response;
  try {
    upstream = await streamChat({
      apiKey: built.ctx.apiKey,
      body: {
        query: body.query,
        conversation_id: body.conversation_id ?? "",
        inputs: body.inputs ?? {},
        files: body.files ?? [],
        user: built.ctx.user,
        auto_generate_name: body.auto_generate_name ?? true,
      },
    });
  } catch (err) {
    return failure(c, 502, `upstream connect failed: ${(err as Error).message}`);
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return c.json(
      { success: false, status: upstream.status, msg: errText || "dify upstream error" },
      (upstream.status as 400) || 502,
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Dify-Upstream": DIFY_BASE,
    },
  });
});

agentsRoutes.post("/:assistantId/chat/:taskId/stop", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  try {
    const data = await difyService.stopChat({
      apiKey: built.ctx.apiKey,
      taskId: c.req.param("taskId"),
      user: built.ctx.user,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

// ============================================================================
// Conversations
// ============================================================================

agentsRoutes.get("/:assistantId/conversations", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  try {
    const data = await difyService.listConversations({
      apiKey: built.ctx.apiKey,
      user: built.ctx.user,
      lastId: c.req.query("last_id") || undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      sortBy:
        (c.req.query("sort_by") as
          | "created_at"
          | "-created_at"
          | "updated_at"
          | "-updated_at"
          | undefined) || undefined,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

agentsRoutes.patch("/:assistantId/conversations/:conversationId", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  const body = (await c.req.json().catch(() => null)) as
    | { name?: string; auto_generate?: boolean }
    | null;
  try {
    const data = await difyService.renameConversation({
      apiKey: built.ctx.apiKey,
      conversationId: c.req.param("conversationId"),
      user: built.ctx.user,
      name: body?.name,
      autoGenerate: body?.auto_generate,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

agentsRoutes.delete("/:assistantId/conversations/:conversationId", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  try {
    await difyService.deleteConversation({
      apiKey: built.ctx.apiKey,
      conversationId: c.req.param("conversationId"),
      user: built.ctx.user,
    });
    return c.json({ success: true });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

// ============================================================================
// Messages + feedback + suggested
// ============================================================================

agentsRoutes.get("/:assistantId/conversations/:conversationId/messages", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  try {
    const data = await difyService.listMessages({
      apiKey: built.ctx.apiKey,
      conversationId: c.req.param("conversationId"),
      user: built.ctx.user,
      firstId: c.req.query("first_id") || undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

agentsRoutes.post("/:assistantId/messages/:messageId/feedback", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  const body = (await c.req.json().catch(() => null)) as
    | { rating?: "like" | "dislike" | null; content?: string }
    | null;
  if (!body) return failure(c, 400, "body is required");
  try {
    const data = await difyService.feedback({
      apiKey: built.ctx.apiKey,
      messageId: c.req.param("messageId"),
      user: built.ctx.user,
      rating: body.rating ?? null,
      content: body.content,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

agentsRoutes.get("/:assistantId/messages/:messageId/suggested", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  try {
    const data = await difyService.suggested({
      apiKey: built.ctx.apiKey,
      messageId: c.req.param("messageId"),
      user: built.ctx.user,
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

// ============================================================================
// App-level meta (parameters, meta)
// ============================================================================

agentsRoutes.get("/:assistantId/parameters", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  try {
    const data = await difyService.parameters({ apiKey: built.ctx.apiKey });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

agentsRoutes.get("/:assistantId/meta", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  try {
    const data = await difyService.meta({ apiKey: built.ctx.apiKey });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

// ============================================================================
// File upload (multipart) + audio
// ============================================================================

agentsRoutes.post("/:assistantId/files", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);

  const formData = await c.req.formData().catch(() => null);
  if (!formData) return failure(c, 400, "expected multipart/form-data");
  const file = formData.get("file");
  if (!(file instanceof File)) return failure(c, 400, "field 'file' is required");

  try {
    const data = await difyService.uploadFile({
      apiKey: built.ctx.apiKey,
      user: built.ctx.user,
      file: { name: file.name, type: file.type || "application/octet-stream", bytes: file },
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

agentsRoutes.post("/:assistantId/audio-to-text", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return failure(c, 400, "expected multipart/form-data");
  const file = formData.get("file");
  if (!(file instanceof File)) return failure(c, 400, "field 'file' is required");
  try {
    const data = await difyService.audioToText({
      apiKey: built.ctx.apiKey,
      user: built.ctx.user,
      file: { name: file.name, type: file.type || "audio/mpeg", bytes: file },
    });
    return c.json({ success: true, data });
  } catch (err) {
    return wrapClientError(c, err);
  }
});

agentsRoutes.post("/:assistantId/text-to-audio", async (c) => {
  const built = buildRuntimeContext(c, c.req.param("assistantId"));
  if (!built.ok) return failure(c, built.status, built.msg);
  const body = (await c.req.json().catch(() => null)) as
    | { message_id?: string; text?: string; voice?: string; streaming?: boolean }
    | null;
  if (!body || (!body.message_id && !body.text)) {
    return failure(c, 400, "message_id or text is required");
  }
  let upstream: Response;
  try {
    upstream = await difyService.textToAudioRaw({
      apiKey: built.ctx.apiKey,
      user: built.ctx.user,
      messageId: body.message_id,
      text: body.text,
      voice: body.voice,
      streaming: body.streaming,
    });
  } catch (err) {
    return wrapClientError(c, err);
  }
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return c.json(
      { success: false, status: upstream.status, msg: errText || "text-to-audio failed" },
      (upstream.status as 400) || 502,
    );
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg",
      "Cache-Control": "no-cache, no-transform",
    },
  });
});

export { agentsRoutes };
