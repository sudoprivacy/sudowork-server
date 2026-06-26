/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime: drive a single enhancement invocation for a user turn.
 *
 * The client's main process calls our `/agents/:id/enhancement/invoke` route
 * synchronously before forwarding the user's message to its local ACP. The
 * route delegates here.
 *
 * Three paths now (mutually exclusive — enforced at admin write time in
 * `EnterpriseAssistantService.setEnhancement` / `DifyAgentService.replaceDatasets`):
 *   - `dify_app_binding` present, mode = agent-chat   → call Dify Agent App
 *   - `dify_app_binding` present, mode = workflow     → call Dify Workflow App
 *   - `dify_dataset_binding` present (no app binding) → query datasets directly
 *   - none of the above                               → 404
 *
 * 2026-06-26: the dataset path is now explicitly reported as
 * `mode: 'rag-only'` by `getEnhancement` so the client probe triggers
 * `augmentUserContent` and `/enhancement/invoke` actually fires. The earlier
 * design that left it as `enabled: false` plus a server-side fall-through
 * was end-to-end dead code on the client side.
 *
 * For the streaming workflow path we forward Dify's SSE bytes upstream so
 * the client can render `node_started/node_finished` progress; for blocking
 * paths we just return JSON.
 */

import {
  blockingChat,
  blockingWorkflow,
  loadServiceApiKey,
  retrieveDataset,
  streamChat,
  streamWorkflow,
  DifyClientError,
} from "./DifyClient.js";
import { getEnhancement } from "./EnterpriseAssistantService.js";
import { listDatasets } from "./DifyAgentService.js";
import { db } from "../db/index.js";

/**
 * Read the per-app service API key (token type='app') stored on the binding.
 * Chat / workflow endpoints on Dify reject the tenant-scoped dataset token
 * with 401, so we MUST use the app-scoped key here. Returns null when the
 * binding row is missing the key (older bindings created before we added
 * the column; see manual backfill steps in the local-debug runbook).
 */
function loadAppApiKey(enterpriseId: number, assistantId: string): string | null {
  const row = db
    .prepare(
      `SELECT app_api_key FROM dify_app_binding WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .get(enterpriseId, assistantId) as { app_api_key: string | null } | undefined;
  return row?.app_api_key ?? null;
}

interface InvokeContext {
  enterpriseId: number;
  assistantId: string;
  user: string; // sudowork:{ent}:{uid}
  query: string;
  conversationId?: string;
}

export interface EnhancementBlockingResult {
  text: string;
  /**
   * `agent-chat` / `workflow`: Dify App produced the text.
   * `dataset`: pure-RAG path — `text` is concatenated passage snippets from
   *   `dify_dataset_binding`, no LLM ran. The client renders this as a
   *   knowledge_context block just like other modes.
   */
  mode: "agent-chat" | "workflow" | "dataset";
  citations?: unknown[];
  elapsedMs: number;
  raw?: unknown;
}

/**
 * Blocking path: returns once Dify has produced the full text. Used by clients
 * that don't care about workflow progress events (or for non-workflow modes).
 *
 * Routing precedence (only one branch fires per call):
 *   1. dify_app_binding present → invoke the App
 *   2. dify_dataset_binding present → query datasets ("纯知识库" path)
 *   3. neither → 404
 *
 * The two binding tables are mutually exclusive by service-layer convention
 * (enforced in `DifyAgentService.replaceDatasets` and
 * `EnterpriseAssistantService.setEnhancement`).
 */
export async function invokeBlocking(ctx: InvokeContext): Promise<EnhancementBlockingResult> {
  const enhancement = getEnhancement(ctx.enterpriseId, ctx.assistantId);
  const start = Date.now();

  if (enhancement.enabled) {
    switch (enhancement.mode) {
      case "workflow": {
        const appKey = loadAppApiKey(ctx.enterpriseId, ctx.assistantId);
        if (!appKey) {
          throw new DifyClientError(500, "binding missing app_api_key — re-create the assistant");
        }
        const result = await blockingWorkflow({
          apiKey: appKey,
          body: {
            inputs: { query: ctx.query },
            user: ctx.user,
          },
        });
        const text = flattenWorkflowOutputs(result.outputs);
        return {
          text,
          mode: "workflow",
          elapsedMs: Date.now() - start,
          raw: result.raw,
        };
      }
      case "rag-only": {
        // Pure-RAG path: getEnhancement reported `rag-only` because the
        // assistant has dataset bindings but no Dify App binding. Skip
        // app-key lookup entirely and go straight to dataset retrieval.
        const datasetIds = listDatasets(ctx.enterpriseId, ctx.assistantId);
        if (datasetIds.length === 0) {
          // Race: dataset binding was deleted between probe and invoke.
          throw new DifyClientError(
            404,
            "rag-only assistant lost its dataset bindings between probe and invoke",
          );
        }
        const { apiKey } = loadServiceApiKey(ctx.enterpriseId);
        const text = await ragOnlyAnswer(ctx, apiKey, datasetIds);
        return { text, mode: "dataset", elapsedMs: Date.now() - start };
      }
      case "agent-chat":
      default: {
        const appKey = loadAppApiKey(ctx.enterpriseId, ctx.assistantId);
        if (!appKey) {
          throw new DifyClientError(500, "binding missing app_api_key — re-create the assistant");
        }
        // Agent Chat doesn't support blocking response_mode upstream; collect
        // the streamed answer here so the blocking caller sees the same shape
        // as plain chat/completion apps.
        let answer = "";
        for await (const evt of invokeAgentChatStream(ctx, appKey, start)) {
          if (evt.kind === "result") answer = evt.text;
          else if (evt.kind === "error") {
            throw new DifyClientError(evt.status ?? 500, evt.message);
          }
        }
        return {
          text: answer,
          mode: "agent-chat",
          elapsedMs: Date.now() - start,
        };
      }
    }
  }

  // Defensive fall-through: `getEnhancement` now reports `rag-only` for
  // dataset-bound assistants, so reaching here means *neither* App nor
  // dataset binding exists. Kept as a 404 instead of silently 200-empty so
  // an admin-side data drift surfaces as a real error.
  throw new DifyClientError(
    404,
    "assistant has no Dify enhancement and no datasets attached",
  );
}

/**
 * Streaming path: returns an async iterable of structured events the route
 * layer can re-emit as SSE. Only used for `workflow` mode today; other modes
 * fall back to blocking + a single result event.
 *
 * Event shape:
 *   { kind: 'progress', step: string }
 *   { kind: 'result',   text: string, mode, elapsedMs, citations? }
 *   { kind: 'error',    message: string, status?: number }
 */
export type EnhancementEvent =
  | { kind: "progress"; step: string; nodeId?: string; nodeType?: string }
  | {
      kind: "result";
      text: string;
      mode: "agent-chat" | "workflow" | "dataset";
      elapsedMs: number;
      citations?: unknown[];
    }
  | { kind: "error"; message: string; status?: number };

export async function* invokeStreaming(
  ctx: InvokeContext,
): AsyncGenerator<EnhancementEvent, void, void> {
  const enhancement = getEnhancement(ctx.enterpriseId, ctx.assistantId);
  const start = Date.now();

  // Branch 1: Dify enhancement active (one of agent-chat / workflow / rag-only).
  if (enhancement.enabled) {
    if (enhancement.mode === "workflow") {
      const appKey = loadAppApiKey(ctx.enterpriseId, ctx.assistantId);
      if (!appKey) {
        yield {
          kind: "error",
          message: "binding missing app_api_key — re-create the assistant",
          status: 500,
        };
        return;
      }
      yield* invokeWorkflowStream(ctx, appKey, start);
      return;
    }

    if (enhancement.mode === "rag-only") {
      // Pure-RAG path is one-shot retrieval; no per-step progress to stream.
      // Emit a single `result` event after the dataset query completes so the
      // SSE consumer sees the same shape as workflow's final event.
      const datasetIds = listDatasets(ctx.enterpriseId, ctx.assistantId);
      if (datasetIds.length === 0) {
        yield {
          kind: "error",
          message: "rag-only assistant lost its dataset bindings between probe and invoke",
          status: 404,
        };
        return;
      }
      try {
        const { apiKey } = loadServiceApiKey(ctx.enterpriseId);
        const text = await ragOnlyAnswer(ctx, apiKey, datasetIds);
        yield { kind: "result", text, mode: "dataset", elapsedMs: Date.now() - start };
      } catch (err) {
        yield { kind: "error", message: (err as Error).message };
      }
      return;
    }

    // agent-chat (default)
    const appKey = loadAppApiKey(ctx.enterpriseId, ctx.assistantId);
    if (!appKey) {
      yield {
        kind: "error",
        message: "binding missing app_api_key — re-create the assistant",
        status: 500,
      };
      return;
    }
    yield* invokeAgentChatStream(ctx, appKey, start);
    return;
  }

  // Defensive: `getEnhancement` now reports `rag-only` for dataset-bound
  // assistants, so reaching here means neither App nor dataset binding
  // exists. Surface as 404 instead of silently emitting an empty result.
  yield {
    kind: "error",
    message: "assistant has no Dify enhancement and no datasets attached",
    status: 404,
  };
}

async function* invokeAgentChatStream(
  ctx: InvokeContext,
  apiKey: string,
  start: number,
): AsyncGenerator<EnhancementEvent, void, void> {
  let upstream: Response;
  try {
    upstream = await streamChat({
      apiKey,
      body: {
        query: ctx.query,
        conversation_id: ctx.conversationId ?? "",
        inputs: {},
        user: ctx.user,
      },
    });
  } catch (err) {
    yield { kind: "error", message: `upstream connect failed: ${(err as Error).message}` };
    return;
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    yield {
      kind: "error",
      message: detail || `chat upstream ${upstream.status}`,
      status: upstream.status,
    };
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let answer = "";
  let resultEmitted = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf("\n\n");

        const dataLines: string[] = [];
        for (const line of rawFrame.split("\n")) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join("\n");
        if (dataStr === "[DONE]") continue;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(dataStr);
        } catch {
          continue;
        }
        const event = typeof payload["event"] === "string" ? (payload["event"] as string) : "";

        // The chat-messages SSE emits `message` for streamed tokens and
        // `agent_message` for the agent's natural-language tokens; both
        // carry an `answer` field we accumulate. `message_end` finalizes.
        if (event === "message" || event === "agent_message") {
          const piece = typeof payload["answer"] === "string" ? (payload["answer"] as string) : "";
          answer += piece;
        } else if (event === "message_end") {
          yield {
            kind: "result",
            text: answer,
            mode: "agent-chat",
            elapsedMs: Date.now() - start,
          };
          resultEmitted = true;
        } else if (event === "error") {
          yield {
            kind: "error",
            message: ((payload["message"] as string) || "agent chat error") ?? "agent chat error",
          };
          return;
        }
      }
    }
    if (!resultEmitted) {
      // Stream ended without an explicit message_end — emit whatever we got.
      yield {
        kind: "result",
        text: answer,
        mode: "agent-chat",
        elapsedMs: Date.now() - start,
      };
    }
  } catch (err) {
    yield { kind: "error", message: (err as Error).message };
  }
}

// ============================================================================
// internals
// ============================================================================

async function* invokeWorkflowStream(
  ctx: InvokeContext,
  apiKey: string,
  start: number,
): AsyncGenerator<EnhancementEvent, void, void> {
  let upstream: Response;
  try {
    upstream = await streamWorkflow({
      apiKey,
      body: {
        inputs: { query: ctx.query },
        user: ctx.user,
      },
    });
  } catch (err) {
    yield { kind: "error", message: `upstream connect failed: ${(err as Error).message}` };
    return;
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    yield { kind: "error", message: detail || `workflow upstream ${upstream.status}`, status: upstream.status };
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let resultEmitted = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf("\n\n");

        const dataLines: string[] = [];
        for (const line of rawFrame.split("\n")) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join("\n");
        if (dataStr === "[DONE]") continue;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(dataStr);
        } catch {
          continue;
        }
        const event = typeof payload["event"] === "string" ? (payload["event"] as string) : "";

        if (event === "node_started") {
          const data = (payload["data"] as Record<string, unknown>) || {};
          const title = (data["title"] as string) || (data["node_type"] as string) || "step";
          yield {
            kind: "progress",
            step: title,
            nodeId: data["node_id"] as string | undefined,
            nodeType: data["node_type"] as string | undefined,
          };
        } else if (event === "workflow_finished") {
          const data = (payload["data"] as Record<string, unknown>) || {};
          const outputs = (data["outputs"] as Record<string, unknown>) || {};
          const text = flattenWorkflowOutputs(outputs);
          yield {
            kind: "result",
            text,
            mode: "workflow",
            elapsedMs: Date.now() - start,
          };
          resultEmitted = true;
        } else if (event === "error") {
          yield {
            kind: "error",
            message:
              ((payload["message"] as string) || (payload["data"] as { error?: string })?.error) ??
              "workflow error",
          };
        }
      }
    }
    if (!resultEmitted) {
      yield { kind: "error", message: "workflow stream ended without result" };
    }
  } catch (err) {
    yield { kind: "error", message: (err as Error).message };
  }
}

/**
 * Pure-RAG path: run dataset queries (no LLM cost) and concatenate the
 * passages. The local ACP turns them into a final answer using its own .md
 * persona and skills. `datasetIds` is passed in by the caller — both
 * `invokeBlocking` and `invokeStreaming` already had to read this list to
 * decide which branch to take, so reusing it here avoids a second lookup.
 */
async function ragOnlyAnswer(
  ctx: InvokeContext,
  apiKey: string,
  datasetIds: string[],
): Promise<string> {
  if (datasetIds.length === 0) return "";

  // Use `/v1/datasets/{id}/retrieve` — the same endpoint Dify Studio's "召回测试"
  // hit-testing UI calls. The older `/queries` route was removed upstream and
  // now 404s on current Dify builds, which silently emptied this code path
  // (the .catch below turned the 404 into `null` → empty passages → no
  // <knowledge_context> injection → user got plain LLM response).
  const calls = datasetIds.map((id) =>
    retrieveDataset(apiKey, id, {
      query: ctx.query,
      retrieval_model: {
        top_k: 5,
        score_threshold: 0.3,
        // /retrieve ignores `score_threshold` unless `score_threshold_enabled`
        // is true (see DifyClient.retrieveDataset's rmDefaults note).
        score_threshold_enabled: true,
      },
    }).catch((err) => {
      console.warn(`dataset retrieve failed for ${id}:`, err);
      return null;
    }),
  );
  const results = await Promise.all(calls);
  const passages: string[] = [];
  for (const result of results) {
    if (!result) continue;
    const records = (result as { records?: Array<{ segment?: { content?: string } }> }).records;
    if (!Array.isArray(records)) continue;
    for (const rec of records) {
      const text = rec?.segment?.content;
      if (typeof text === "string" && text.length > 0) passages.push(text.trim());
    }
  }
  return passages.join("\n\n---\n\n");
}

/**
 * Workflows can output anything; we collapse `outputs` into a single string
 * for injection. Resolution order:
 *   1. Single string key under `text` / `answer` / `result` / `output` —
 *      use verbatim. Covers Q&A / completion / summarization workflows that
 *      end with an LLM node piping to a String output variable.
 *   2. Array under `result` / `output` — assumed to be a Knowledge
 *      Retrieval node's chunks (`{ content | text | body, metadata, score }`
 *      shape). Concatenate every chunk's text content with `---` separators
 *      and drop the `metadata.dataset_id`/`_source` noise that confuses the
 *      downstream LLM. This is the common RAG-via-workflow shape: 开始 →
 *      知识检索 → 输出(result=知识检索.result Array[object]).
 *   3. Fallback: JSON-stringify the whole outputs dict. Worst case the local
 *      ACP still gets a structured blob it can reason about, just noisier.
 */
function flattenWorkflowOutputs(outputs: Record<string, unknown>): string {
  if (!outputs || typeof outputs !== "object") return "";

  // (1) single-string convenience keys
  for (const key of ["text", "answer", "result", "output"]) {
    const v = outputs[key];
    if (typeof v === "string") return v;
  }

  // (2) array-of-chunks (Knowledge Retrieval node output)
  for (const key of ["result", "output"]) {
    const v = outputs[key];
    if (!Array.isArray(v)) continue;
    const chunks: string[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      // Dify chunk shape: most retrievers expose `content`; a few legacy
      // ones use `text` or `body`. Take the first non-empty string.
      const candidates = [obj.content, obj.text, obj.body];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim().length > 0) {
          chunks.push(c.trim());
          break;
        }
      }
    }
    if (chunks.length > 0) return chunks.join("\n\n---\n\n");
  }

  // (3) fallback
  try {
    return JSON.stringify(outputs, null, 2);
  } catch {
    return String(outputs);
  }
}
