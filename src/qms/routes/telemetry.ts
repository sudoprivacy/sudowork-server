/**
 * Telemetry API routes
 * Uses Redis queue for async batch insertion
 */

import { Hono } from "hono";
import { apiKeyAuth } from "../middleware/auth.js";
import { decryptMiddleware } from "../middleware/decrypt.js";
import { pushToQueue, getQueueStats } from "../services/queue.js";
import { logger } from "../utils/logger.js";
import { getTenantIdFromOptionalJwt, withResolvedTenantId } from "../utils/tenant.js";
import type {
  TelemetryBatchRequest,
  PerfRawData,
  ConversationRawData,
  TurnRawData,
  StepRawData,
  InstallRawData,
} from "../types/telemetry.js";
import type { DecryptedBatchRequest } from "../types/encryption.js";

const telemetry = new Hono();

type TelemetryCommonFields = Pick<
  TelemetryBatchRequest,
  "org_id" | "user_id" | "tenant_id" | "login_mode" | "agent_type" | "user_nickname" | "user_phone"
>;

function mergeCommonFields<T extends Record<string, unknown>>(
  item: T,
  common: TelemetryCommonFields,
  authTenantId?: string,
): T {
  return withResolvedTenantId({
    ...item,
    org_id: item.org_id ?? common.org_id,
    user_id: item.user_id ?? common.user_id,
    tenant_id: item.tenant_id ?? common.tenant_id,
    login_mode: item.login_mode ?? common.login_mode,
    agent_type: item.agent_type ?? common.agent_type,
    user_nickname: item.user_nickname ?? common.user_nickname,
    user_phone: item.user_phone ?? common.user_phone,
  }, authTenantId, common);
}

// All telemetry endpoints require API key authentication
telemetry.use("/*", apiKeyAuth);

// Decrypt middleware for hybrid encryption support
telemetry.post("/batch", decryptMiddleware, async (c) => {
  // Get decrypted body from middleware (or plain body if encryption disabled)
  const decryptedBody = c.get("decryptedBody") as DecryptedBatchRequest | undefined;
  const body = (decryptedBody || await c.req.json<TelemetryBatchRequest>()) as TelemetryBatchRequest;
  const authTenantId = await getTenantIdFromOptionalJwt(c);
  const now = Date.now();

  const results = {
    perf: 0,
    conversations: 0,
    turns: 0,
    steps: 0,
    installs: 0,
  };

  // Push to Redis queues (async, non-blocking)
  try {
    // Handle events array format (from newer clients)
    if (body.events && Array.isArray(body.events)) {
      const perfEvents: PerfRawData[] = [];
      const conversationEvents: ConversationRawData[] = [];
      const turnEvents: TurnRawData[] = [];
      const stepEvents: StepRawData[] = [];
      const installEvents: InstallRawData[] = [];

      for (const event of body.events) {
        // Event format: { type, timestamp, version, platform, arch, org_id, user_id, tenant_id, login_mode, agent_type, data }
        // Need to merge top-level fields into data to match expected format
        const evt = event as {
          type: string;
          timestamp?: number;
          version?: string;
          platform?: string;
          arch?: string;
          org_id?: string;
          user_id?: string;
          tenant_id?: string;
          login_mode?: string;
          agent_type?: string;
          data?: Record<string, unknown>;
        };

        if (!evt.data) continue;

        // Merge common fields from event level into data
        const mergedData = {
          ...evt.data,
          timestamp: evt.timestamp ?? evt.data.timestamp,
          version: evt.version ?? evt.data.version,
          platform: evt.platform ?? evt.data.platform,
          arch: evt.arch ?? evt.data.arch,
          org_id: evt.org_id ?? evt.data.org_id ?? body.org_id,
          user_id: evt.user_id ?? evt.data.user_id ?? body.user_id,
          tenant_id: evt.tenant_id ?? evt.data.tenant_id ?? body.tenant_id,
          login_mode: evt.login_mode ?? evt.data.login_mode ?? body.login_mode,
          agent_type: evt.agent_type ?? evt.data.agent_type ?? body.agent_type,
          user_nickname: (evt as { user_nickname?: string }).user_nickname ?? evt.data.user_nickname ?? body.user_nickname,
          user_phone: (evt as { user_phone?: string }).user_phone ?? evt.data.user_phone ?? body.user_phone,
        };
        const normalizedData = withResolvedTenantId(
          mergedData,
          authTenantId,
          evt,
          evt.data,
          body as unknown as Record<string, unknown>,
        );

        if (evt.type === "perf") {
          perfEvents.push(normalizedData as PerfRawData);
        } else if (evt.type === "conversation") {
          conversationEvents.push(normalizedData as ConversationRawData);
        } else if (evt.type === "turn") {
          turnEvents.push(normalizedData as TurnRawData);
        } else if (evt.type === "step") {
          stepEvents.push(normalizedData as StepRawData);
        } else if (evt.type === "install") {
          installEvents.push(normalizedData as InstallRawData);
        }
      }

      if (perfEvents.length > 0) {
        await pushToQueue("perf", perfEvents);
        results.perf = perfEvents.length;
      }
      if (conversationEvents.length > 0) {
        await pushToQueue("conversations", conversationEvents);
        results.conversations = conversationEvents.length;
      }
      if (turnEvents.length > 0) {
        await pushToQueue("turns", turnEvents);
        results.turns = turnEvents.length;
      }
      if (stepEvents.length > 0) {
        await pushToQueue("steps", stepEvents);
        results.steps = stepEvents.length;
      }
      if (installEvents.length > 0) {
        await pushToQueue("installs", installEvents);
        results.installs = installEvents.length;
      }
    } else {
      // Handle legacy format (perf: [], conversations: [], etc.)
      const common: TelemetryCommonFields = {
        org_id: body.org_id,
        user_id: body.user_id,
        tenant_id: body.tenant_id,
        login_mode: body.login_mode,
        agent_type: body.agent_type,
        user_nickname: body.user_nickname,
        user_phone: body.user_phone,
      };

      if (body.perf && body.perf.length > 0) {
        const items = body.perf.map((item) => mergeCommonFields(item as unknown as Record<string, unknown>, common, authTenantId) as unknown as PerfRawData);
        await pushToQueue("perf", items);
        results.perf = items.length;
      }

      if (body.conversations && body.conversations.length > 0) {
        const items = body.conversations.map((item) => mergeCommonFields(item as unknown as Record<string, unknown>, common, authTenantId) as unknown as ConversationRawData);
        await pushToQueue("conversations", items);
        results.conversations = items.length;
      }

      if (body.turns && body.turns.length > 0) {
        const items = body.turns.map((item) => mergeCommonFields(item as unknown as Record<string, unknown>, common, authTenantId) as unknown as TurnRawData);
        await pushToQueue("turns", items);
        results.turns = items.length;
      }

      if (body.steps && body.steps.length > 0) {
        const items = body.steps.map((item) => mergeCommonFields(item as unknown as Record<string, unknown>, common, authTenantId) as unknown as StepRawData);
        await pushToQueue("steps", items);
        results.steps = items.length;
      }

      if (body.installs && body.installs.length > 0) {
        const items = body.installs.map((item) => mergeCommonFields(item as unknown as Record<string, unknown>, common, authTenantId) as unknown as InstallRawData);
        await pushToQueue("installs", items);
        results.installs = items.length;
      }
    }

    logger.info("Telemetry batch queued:", results);
  } catch (error) {
    logger.error("Failed to push to queue:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUEUE_ERROR", message: "Failed to queue telemetry data" },
      },
      500
    );
  }

  return c.json({
    success: true,
    data: {
      received: results,
      timestamp: now,
      queued: true, // Indicate data is queued for async processing
    },
  });
});

/**
 * Get queue statistics (for monitoring)
 */
telemetry.get("/queue/stats", async (c) => {
  const stats = await getQueueStats();

  return c.json({
    success: true,
    data: stats,
  });
});

/**
 * Single performance event upload (still uses queue)
 */
telemetry.post("/perf", async (c) => {
  const authTenantId = await getTenantIdFromOptionalJwt(c);
  const body = withResolvedTenantId(await c.req.json<PerfRawData>() as unknown as Record<string, unknown>, authTenantId) as unknown as PerfRawData;

  try {
    await pushToQueue("perf", [body]);
    logger.debug("Perf event queued");
  } catch (error) {
    logger.error("Failed to queue perf event:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUEUE_ERROR", message: "Failed to queue perf event" },
      },
      500
    );
  }

  return c.json({
    success: true,
    data: { timestamp: Date.now(), queued: true },
  });
});

/**
 * Single conversation event upload (still uses queue)
 */
telemetry.post("/conversation", async (c) => {
  const authTenantId = await getTenantIdFromOptionalJwt(c);
  const body = withResolvedTenantId(await c.req.json<ConversationRawData>() as unknown as Record<string, unknown>, authTenantId) as unknown as ConversationRawData;

  try {
    await pushToQueue("conversations", [body]);
    logger.debug("Conversation event queued");
  } catch (error) {
    logger.error("Failed to queue conversation event:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUEUE_ERROR", message: "Failed to queue conversation event" },
      },
      500
    );
  }

  return c.json({
    success: true,
    data: { timestamp: Date.now(), queued: true },
  });
});

/**
 * Single install event upload (still uses queue)
 */
telemetry.post("/install", async (c) => {
  const authTenantId = await getTenantIdFromOptionalJwt(c);
  const body = withResolvedTenantId(await c.req.json<InstallRawData>() as unknown as Record<string, unknown>, authTenantId) as unknown as InstallRawData;

  try {
    await pushToQueue("installs", [body]);
    logger.debug("Install event queued");
  } catch (error) {
    logger.error("Failed to queue install event:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUEUE_ERROR", message: "Failed to queue install event" },
      },
      500
    );
  }

  return c.json({
    success: true,
    data: { timestamp: Date.now(), queued: true },
  });
});

export default telemetry;
