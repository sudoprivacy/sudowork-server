/**
 * Alert API routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { jwtAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { notificationService } from "../services/notification.js";
import { v4 as uuidv4 } from "uuid";
import type {
  AlertConfig,
  CreateAlertConfigInput,
  UpdateAlertConfigInput,
  AlertHistory,
  AlertHistoryQuery,
  AlertChannel,
} from "../types/alert.js";

const alerts = new Hono();

// All alert endpoints require JWT auth
alerts.use("/*", jwtAuth);

/**
 * List alert configurations
 */
alerts.get("/configs", requireRole("admin"), async (c) => {
  const configs = await db`
    SELECT * FROM alert_config ORDER BY created_at DESC
  `;

  // Parse channels JSON
  const result = configs.map((config) => ({
    ...config,
    channels: JSON.parse(config.channels as unknown as string),
    enabled: Boolean(config.enabled),
  }));

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * Get single alert config
 */
alerts.get("/configs/:id", requireRole("admin"), async (c) => {
  const id = c.req.param("id") as string;

  const configs = await db`SELECT * FROM alert_config WHERE id = ${id}`;

  if (configs.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Alert config not found" },
      },
      404
    );
  }

  const config = configs[0]!;

  return c.json({
    success: true,
    data: {
      ...config,
      channels: JSON.parse(config.channels as unknown as string),
      enabled: Boolean(config.enabled),
    },
  });
});

/**
 * Create alert configuration
 */
alerts.post("/configs", requireRole("admin"), async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.json<CreateAlertConfigInput>();
  const now = new Date();
  const id = uuidv4();

  await db`
    INSERT INTO alert_config (id, name, type, metric, threshold, comparison, level, channels, enabled, cooldown_minutes, description, created_at, updated_at)
    VALUES (${id}, ${body.name}, ${body.type}, ${body.metric}, ${body.threshold}, ${body.comparison}, ${body.level}, ${JSON.stringify(body.channels)}, ${body.enabled ?? false}, ${body.cooldown_minutes ?? 30}, ${body.description ?? null}, ${now}, ${now})
  `;

  // Audit log
  await db`
    INSERT INTO audit_logs (user_id, action, resource, resource_id, detail, created_at)
    VALUES (${userId}, 'alert_create', 'alert_config', ${id}, ${body.name}, ${now})
  `;

  logger.info("Alert config created: " + id);

  return c.json({
    success: true,
    data: {
      id,
      ...body,
      enabled: body.enabled ?? false,
      cooldown_minutes: body.cooldown_minutes ?? 30,
      created_at: now.getTime(),
      updated_at: now.getTime(),
    },
  });
});

/**
 * Update alert configuration
 */
alerts.put("/configs/:id", requireRole("admin"), async (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id") as string;
  const body = await c.req.json<UpdateAlertConfigInput>();
  const now = new Date();

  const existing = await db`SELECT * FROM alert_config WHERE id = ${id}`;

  if (existing.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Alert config not found" },
      },
      404
    );
  }

  const updateFields: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (body.name !== undefined) {
    updateFields.push(`name = $${paramIndex++}`);
    params.push(body.name);
  }
  if (body.threshold !== undefined) {
    updateFields.push(`threshold = $${paramIndex++}`);
    params.push(body.threshold);
  }
  if (body.comparison !== undefined) {
    updateFields.push(`comparison = $${paramIndex++}`);
    params.push(body.comparison);
  }
  if (body.level !== undefined) {
    updateFields.push(`level = $${paramIndex++}`);
    params.push(body.level);
  }
  if (body.channels !== undefined) {
    updateFields.push(`channels = $${paramIndex++}`);
    params.push(JSON.stringify(body.channels));
  }
  if (body.enabled !== undefined) {
    updateFields.push(`enabled = $${paramIndex++}`);
    params.push(body.enabled);
  }
  if (body.cooldown_minutes !== undefined) {
    updateFields.push(`cooldown_minutes = $${paramIndex++}`);
    params.push(body.cooldown_minutes);
  }
  if (body.description !== undefined) {
    updateFields.push(`description = $${paramIndex++}`);
    params.push(body.description);
  }

  if (updateFields.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NO_UPDATE", message: "No fields to update" },
      },
      400
    );
  }

  updateFields.push(`updated_at = $${paramIndex++}`);
  params.push(now);
  params.push(id);

  await db.unsafe(`
    UPDATE alert_config SET ${updateFields.join(", ")} WHERE id = $${paramIndex}
  `, params as (string | number | boolean | null | Date)[]);

  // Audit log
  await db`
    INSERT INTO audit_logs (user_id, action, resource, resource_id, detail, created_at)
    VALUES (${userId}, 'alert_update', 'alert_config', ${id}, ${JSON.stringify(body)}, ${now})
  `;

  logger.info("Alert config updated: " + id);

  return c.json({
    success: true,
    data: { id, ...body, updated_at: now.getTime() },
  });
});

/**
 * Delete alert configuration
 */
alerts.delete("/configs/:id", requireRole("admin"), async (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id") as string;
  const now = new Date();

  const existing = await db`SELECT * FROM alert_config WHERE id = ${id}`;

  if (existing.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Alert config not found" },
      },
      404
    );
  }

  await db`DELETE FROM alert_config WHERE id = ${id}`;

  // Audit log
  await db`
    INSERT INTO audit_logs (user_id, action, resource, resource_id, detail, created_at)
    VALUES (${userId}, 'alert_delete', 'alert_config', ${id}, ${existing[0]!.name}, ${now})
  `;

  logger.info("Alert config deleted: " + id);

  return c.json({
    success: true,
    data: { id },
  });
});

/**
 * List alert history
 */
alerts.get("/history", requireRole("admin"), async (c) => {
  const query = c.req.query() as AlertHistoryQuery;
  const limit = query.limit || 50;
  const offset = query.offset || 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.config_id) {
    conditions.push(`config_id = $${params.length + 1}`);
    params.push(query.config_id);
  }
  if (query.type) {
    conditions.push(`type = $${params.length + 1}`);
    params.push(query.type);
  }
  if (query.level) {
    conditions.push(`level = $${params.length + 1}`);
    params.push(query.level);
  }
  if (query.success !== undefined) {
    conditions.push(`success = $${params.length + 1}`);
    params.push(query.success);
  }
  if (query.acknowledged !== undefined) {
    conditions.push(`acknowledged = $${params.length + 1}`);
    params.push(query.acknowledged);
  }
  if (query.start_time) {
    conditions.push(`sent_at >= $${params.length + 1}`);
    params.push(new Date(query.start_time));
  }
  if (query.end_time) {
    conditions.push(`sent_at < $${params.length + 1}`);
    params.push(new Date(query.end_time));
  }

  params.push(limit, offset);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const history = await db.unsafe(`
    SELECT * FROM alert_history
    ${whereClause}
    ORDER BY sent_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params as (string | number | boolean | null | Date)[]);

  // Parse channels JSON
  const result = history.map((h) => ({
    ...h,
    channels: JSON.parse(h.channels),
    success: Boolean(h.success),
    acknowledged: Boolean(h.acknowledged),
    sent_at: h.sent_at instanceof Date ? h.sent_at.getTime() : h.sent_at,
    acknowledged_at: h.acknowledged_at instanceof Date ? h.acknowledged_at.getTime() : h.acknowledged_at,
  }));

  return c.json({
    success: true,
    data: {
      data: result,
      total: history.length,
      limit,
      offset,
    },
  });
});

/**
 * Acknowledge an alert
 */
alerts.post("/history/:id/acknowledge", requireRole("admin"), async (c) => {
  const userId = c.get("userId") as string;
  const idParam = c.req.param("id") as string;
  const id = parseInt(idParam, 10);
  const now = new Date();

  const existing = await db`SELECT * FROM alert_history WHERE id = ${id}`;

  if (existing.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Alert history not found" },
      },
      404
    );
  }

  if (existing[0]!.acknowledged) {
    return c.json(
      {
        success: false,
        error: { code: "ALREADY_ACKNOWLEDGED", message: "Alert already acknowledged" },
      },
      400
    );
  }

  await db`
    UPDATE alert_history SET acknowledged = TRUE, acknowledged_at = ${now}, acknowledged_by = ${userId} WHERE id = ${id}
  `;

  return c.json({
    success: true,
    data: { id, acknowledged_at: now.getTime(), acknowledged_by: userId },
  });
});

/**
 * Test alert configuration
 */
alerts.post("/configs/:id/test", requireRole("admin"), async (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id") as string;
  const now = new Date();

  const configs = await db`SELECT * FROM alert_config WHERE id = ${id}`;

  if (configs.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Alert config not found" },
      },
      404
    );
  }

  const config = configs[0]!;

  // Audit log
  await db`
    INSERT INTO audit_logs (user_id, action, resource, resource_id, detail, created_at)
    VALUES (${userId}, 'alert_test', 'alert_config', ${id}, ${config.name}, ${now})
  `;

  logger.info("Alert test triggered: " + id);

  // Send test notification
  const channels = JSON.parse(config.channels as unknown as string) as AlertChannel[];
  const testPayload = {
    title: `[TEST] ${config.name}`,
    message: `这是一条测试告警消息。当前阈值: ${config.threshold} (${config.comparison})`,
    level: config.level,
    type: config.type,
    detail: config.description || "测试告警",
    timestamp: now.getTime(),
  };

  const results = await notificationService.sendAlert(testPayload, channels);

  // Record test in history
  await db`
    INSERT INTO alert_history (config_id, type, title, detail, level, channels, sent_at, success, error_message)
    VALUES (${config.id}, 'test', ${testPayload.title}, ${testPayload.message}, ${config.level}, ${JSON.stringify(channels)}, ${now}, ${results.every((r) => r.success)}, ${results.find((r) => r.error)?.error || null})
  `;

  const success = results.every((r) => r.success);

  return c.json({
    success: true,
    data: {
      message: success ? "Test alert sent successfully" : "Test alert partially sent",
      results: results.map((r) => ({
        channel: r.channel,
        success: r.success,
        error: r.error,
      })),
    },
  });
});

export default alerts;
