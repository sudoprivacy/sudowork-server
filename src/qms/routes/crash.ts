/**
 * Crash Reporter routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { apiKeyAuth, jwtAuth, requireRole } from "../middleware/auth.js";
import { decryptMiddleware } from "../middleware/decrypt.js";
import { logger } from "../utils/logger.js";
import { getTenantIdFromOptionalJwt, getTenantScope, tenantWhereClause, withResolvedTenantId } from "../utils/tenant.js";
import {
  generateFingerprint,
  processCrashEvent,
  insertCrashEvent,
  getCrashIssues,
  getCrashIssueById,
  updateCrashIssue,
  getCrashEvents,
  getCrashEventById,
  getCrashStatsSummary,
  getCrashTrend,
  getCrashDistribution,
  aggregateCrashDailyStats,
  cleanupOldCrashEvents,
} from "../services/crashAggregation.js";
import type {
  CrashBatchRequest,
  CrashEvent,
  CrashIssueUpdateRequest,
  CrashIssueQueryOptions,
  CrashEventQueryOptions,
} from "../types/crash.js";
import type { DecryptedBatchRequest } from "../types/encryption.js";

const crash = new Hono();

function normalizeCrashEvent(event: CrashEvent, common?: Partial<CrashEvent>): CrashEvent {
  const context = event.context || {};
  const contextRecord = context as Record<string, unknown>;

  return withResolvedTenantId({
    ...event,
    org_id: event.org_id ?? common?.org_id ?? (contextRecord.org_id as string | undefined),
    user_id: event.user_id ?? common?.user_id ?? (contextRecord.user_id as string | undefined),
    tenant_id: event.tenant_id ?? common?.tenant_id ?? (contextRecord.tenant_id as string | undefined),
    login_mode: event.login_mode ?? common?.login_mode ?? (contextRecord.login_mode as "enterprise" | "personal" | undefined),
    agent_type: event.agent_type ?? common?.agent_type ?? (contextRecord.agent_type as string | undefined),
    user_nickname: event.user_nickname ?? common?.user_nickname ?? (contextRecord.user_nickname as string | undefined),
    user_phone: event.user_phone ?? common?.user_phone ?? (contextRecord.user_phone as string | undefined),
  } as unknown as Record<string, unknown>,
    common?.tenant_id,
    event as unknown as Record<string, unknown>,
    contextRecord,
    common as unknown as Record<string, unknown>,
  ) as unknown as CrashEvent;
}

function hasTenantId(event: CrashEvent): boolean {
  const tenantId = (event as { tenant_id?: unknown }).tenant_id;
  return typeof tenantId === "string" && tenantId.trim().length > 0;
}

// ============================================
// Data Upload Endpoints
// ============================================

/**
 * POST /api/v1/crash/events/batch
 * Batch upload crash/exception events (supports encrypted payload)
 */
crash.post("/events/batch", apiKeyAuth, decryptMiddleware, async (c) => {
  try {
    // Get decrypted body from middleware (or plain body if encryption disabled)
    const decryptedBody = c.get("decryptedBody") as DecryptedBatchRequest | undefined;
    const body = decryptedBody || await c.req.json<CrashBatchRequest>();
    const authTenantId = await getTenantIdFromOptionalJwt(c);
    const bodyRecord = withResolvedTenantId(
      body as unknown as Record<string, unknown>,
      authTenantId,
    ) as unknown as CrashBatchRequest & Partial<CrashEvent>;
    const { events } = bodyRecord;

    if (!events || !Array.isArray(events) || events.length === 0) {
      return c.json({ success: false, error: "No events provided" }, 400);
    }

    const normalizedEvents = events.map((rawEvent, index) => {
      const event = normalizeCrashEvent(rawEvent, bodyRecord);
      return { event, index };
    });
    const missingTenantRefs = normalizedEvents.flatMap(({ event, index }) => hasTenantId(event) ? [] : [`events[${index}]`]);
    if (missingTenantRefs.length > 0) {
      return c.json({
        success: false,
        error: {
          code: "TENANT_ID_REQUIRED",
          message: "tenant_id is required for QMS crash ingestion",
          items: missingTenantRefs,
        },
      }, 400);
    }

    let received = 0;
    const errors: string[] = [];

    for (const { event } of normalizedEvents) {
      try {
        if (!event.type || !event.timestamp || !event.version || !event.platform) {
          errors.push("Invalid event: missing required fields");
          continue;
        }

        const fingerprint = generateFingerprint(event);
        const issueId = await processCrashEvent(event, fingerprint);
        await insertCrashEvent(event, fingerprint, issueId);

        received++;
      } catch (err) {
        errors.push(`Event processing error: ${err}`);
      }
    }

    logger.info(`[Crash] Batch upload: ${received}/${events.length} events received`);

    return c.json({
      success: true,
      received,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error("[Crash] Batch upload error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * POST /api/v1/crash/events
 * Single event upload
 */
crash.post("/events", apiKeyAuth, async (c) => {
  try {
    const authTenantId = await getTenantIdFromOptionalJwt(c);
    const event = normalizeCrashEvent(
      await c.req.json<CrashEvent>(),
      { tenant_id: authTenantId } as Partial<CrashEvent>,
    );

    if (!event.type || !event.timestamp || !event.version || !event.platform) {
      return c.json({ success: false, error: "Missing required fields" }, 400);
    }
    if (!hasTenantId(event)) {
      return c.json({
        success: false,
        error: {
          code: "TENANT_ID_REQUIRED",
          message: "tenant_id is required for QMS crash ingestion",
        },
      }, 400);
    }

    const fingerprint = generateFingerprint(event);
    const issueId = await processCrashEvent(event, fingerprint);
    await insertCrashEvent(event, fingerprint, issueId);

    logger.info(`[Crash] Single event uploaded, issue #${issueId}`);

    return c.json({
      success: true,
      received: 1,
      issue_id: issueId,
    });
  } catch (error) {
    logger.error("[Crash] Single upload error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============================================
// Issue Management Endpoints
// ============================================

crash.use("/*", jwtAuth);
crash.use("/*", requireRole("viewer", "admin"));

/**
 * GET /api/v1/crash/issues
 * Get issue list
 */
crash.get("/issues", async (c) => {
  try {
    const query: CrashIssueQueryOptions = {
      status: c.req.query("status"),
      level: c.req.query("level"),
      type: c.req.query("type"),
      version: c.req.query("version"),
      tenant_id: getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined,
      limit: parseInt(c.req.query("limit") || "50"),
      offset: parseInt(c.req.query("offset") || "0"),
    };

    const issues = await getCrashIssues(query);

    // Get total count
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(query.status);
    }
    if (query.level) {
      conditions.push(`level = $${params.length + 1}`);
      params.push(query.level);
    }
    if (query.type) {
      conditions.push(`type = $${params.length + 1}`);
      params.push(query.type);
    }
    const tenantCondition = tenantWhereClause(c, params, "tenant_id", query.tenant_id);
    if (tenantCondition) {
      conditions.push(tenantCondition);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.unsafe(`
      SELECT COUNT(*) as count FROM crash_issues ${whereClause}
    `, params as (string | number | boolean | null | Date)[]);

    const total = countResult[0]?.count ?? 0;

    return c.json({
      success: true,
      data: issues,
      total,
      limit: query.limit,
      offset: query.offset,
    });
  } catch (error) {
    logger.error("[Crash] Get issues error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * GET /api/v1/crash/issues/:id
 * Get single issue detail
 */
crash.get("/issues/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));

    const issue = await getCrashIssueById(id, getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined);
    if (!issue) {
      return c.json({ success: false, error: "Issue not found" }, 404);
    }

    const events = await getCrashEvents({ issue_id: id, tenant_id: issue.tenant_id, limit: 10 });

    return c.json({
      success: true,
      data: issue,
      events,
    });
  } catch (error) {
    logger.error("[Crash] Get issue error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * PUT /api/v1/crash/issues/:id
 * Update issue status or assignment
 */
crash.put("/issues/:id", requireRole("admin"), async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const updates = await c.req.json<CrashIssueUpdateRequest>();
    const tenantId = getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined;

    const success = await updateCrashIssue(id, updates, tenantId);
    if (!success) {
      return c.json({ success: false, error: "Issue not found" }, 404);
    }

    const issue = await getCrashIssueById(id, tenantId);

    return c.json({
      success: true,
      data: issue,
    });
  } catch (error) {
    logger.error("[Crash] Update issue error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * POST /api/v1/crash/issues/:id/resolve
 * Mark issue as resolved
 */
crash.post("/issues/:id/resolve", requireRole("admin"), async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const tenantId = getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined;

    const success = await updateCrashIssue(id, { status: "resolved" }, tenantId);
    if (!success) {
      return c.json({ success: false, error: "Issue not found" }, 404);
    }

    const issue = await getCrashIssueById(id, tenantId);

    return c.json({
      success: true,
      data: issue,
      message: "Issue marked as resolved",
    });
  } catch (error) {
    logger.error("[Crash] Resolve issue error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * POST /api/v1/crash/issues/:id/ignore
 * Mark issue as ignored
 */
crash.post("/issues/:id/ignore", requireRole("admin"), async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const tenantId = getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined;

    const success = await updateCrashIssue(id, { status: "ignored" }, tenantId);
    if (!success) {
      return c.json({ success: false, error: "Issue not found" }, 404);
    }

    const issue = await getCrashIssueById(id, tenantId);

    return c.json({
      success: true,
      data: issue,
      message: "Issue marked as ignored",
    });
  } catch (error) {
    logger.error("[Crash] Ignore issue error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============================================
// Events Query Endpoints
// ============================================

/**
 * GET /api/v1/crash/events
 * Get events list
 */
crash.get("/events", async (c) => {
  try {
    const query: CrashEventQueryOptions = {
      issue_id: c.req.query("issue_id") ? parseInt(c.req.query("issue_id")!) : undefined,
      version: c.req.query("version"),
      platform: c.req.query("platform"),
      type: c.req.query("type"),
      tenant_id: getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined,
      limit: parseInt(c.req.query("limit") || "100"),
      offset: parseInt(c.req.query("offset") || "0"),
    };

    const events = await getCrashEvents(query);

    // Get total count
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.issue_id) {
      conditions.push(`issue_id = $${params.length + 1}`);
      params.push(query.issue_id);
    }
    if (query.version) {
      conditions.push(`version = $${params.length + 1}`);
      params.push(query.version);
    }
    if (query.platform) {
      conditions.push(`platform = $${params.length + 1}`);
      params.push(query.platform);
    }
    if (query.type) {
      conditions.push(`type = $${params.length + 1}`);
      params.push(query.type);
    }
    const tenantCondition = tenantWhereClause(c, params, "tenant_id", query.tenant_id);
    if (tenantCondition) {
      conditions.push(tenantCondition);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.unsafe(`
      SELECT COUNT(*) as count FROM crash_events ${whereClause}
    `, params as (string | number | boolean | null | Date)[]);

    const total = countResult[0]?.count ?? 0;

    return c.json({
      success: true,
      data: events,
      total,
      limit: query.limit,
      offset: query.offset,
    });
  } catch (error) {
    logger.error("[Crash] Get events error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * GET /api/v1/crash/events/:id
 * Get single event detail
 */
crash.get("/events/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));

    const event = await getCrashEventById(id, getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined);
    if (!event) {
      return c.json({ success: false, error: "Event not found" }, 404);
    }

    return c.json({
      success: true,
      data: event,
    });
  } catch (error) {
    logger.error("[Crash] Get event error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============================================
// Statistics Endpoints
// ============================================

/**
 * GET /api/v1/crash/stats/summary
 * Get crash statistics summary
 */
crash.get("/stats/summary", async (c) => {
  try {
    const summary = await getCrashStatsSummary(getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined);

    return c.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error("[Crash] Get stats summary error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * GET /api/v1/crash/stats/trend
 * Get crash trend data
 */
crash.get("/stats/trend", async (c) => {
  try {
    const days = parseInt(c.req.query("days") || "7");
    const trend = await getCrashTrend(days, getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined);

    return c.json({
      success: true,
      data: trend,
      days,
    });
  } catch (error) {
    logger.error("[Crash] Get trend error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * GET /api/v1/crash/stats/distribution
 * Get crash distribution
 */
crash.get("/stats/distribution", async (c) => {
  try {
    const by = (c.req.query("by") || "type") as "version" | "platform" | "type";

    if (!["version", "platform", "type"].includes(by)) {
      return c.json({ success: false, error: "Invalid 'by' parameter" }, 400);
    }

    const distribution = await getCrashDistribution(by, getTenantScope(c, c.req.query("tenant_id")).tenantId || undefined);

    return c.json({
      success: true,
      data: distribution,
      by,
    });
  } catch (error) {
    logger.error("[Crash] Get distribution error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============================================
// Admin Endpoints
// ============================================

/**
 * POST /api/v1/crash/admin/aggregate
 * Trigger manual daily aggregation
 */
crash.post("/admin/aggregate", requireRole("admin"), async (c) => {
  try {
    await aggregateCrashDailyStats();

    return c.json({
      success: true,
      message: "Daily aggregation triggered",
    });
  } catch (error) {
    logger.error("[Crash] Aggregate trigger error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * POST /api/v1/crash/admin/cleanup
 * Trigger manual cleanup
 */
crash.post("/admin/cleanup", requireRole("admin"), async (c) => {
  try {
    const retentionDays = parseInt(c.req.query("retention") || "90");
    await cleanupOldCrashEvents(retentionDays);

    return c.json({
      success: true,
      message: `Cleanup triggered, retention: ${retentionDays} days`,
    });
  } catch (error) {
    logger.error("[Crash] Cleanup trigger error:", error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});

export default crash;
