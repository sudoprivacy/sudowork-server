/**
 * System management API routes
 */

import { Hono } from "hono";
import { db, checkDatabaseHealth } from "../db/index.js";
import { jwtAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initSchema, isTimescaleDBAvailable, createContinuousAggregates } from "../db/schema.js";
import { aggregationService } from "../services/aggregation.js";
import { notificationService } from "../services/notification.js";
import { getSchedulerInstance } from "../tasks/index.js";
import { aggregateCrashDailyStats } from "../services/crashAggregation.js";
import { ERROR_CODE_DEFINITIONS } from "../constants/error-codes.js";
import type { SystemConfig, SystemStats, HealthStatus } from "../types/system.js";

const system = new Hono();

// All system endpoints require JWT auth
system.use("/*", jwtAuth);

/**
 * Health check endpoint (public)
 */
system.get("/health", async (c) => {
  // Check database connection
  const dbHealthy = await checkDatabaseHealth();

  const status: HealthStatus = {
    status: dbHealthy ? "healthy" : "unhealthy",
    version: "1.0.0",
    uptime: Math.floor(process.uptime()),
    checks: {
      database: dbHealthy,
    },
  };

  return c.json(status, dbHealthy ? 200 : 503);
});

/**
 * Get aggregation mode info (admin only)
 */
system.get("/aggregation-info", requireRole("admin"), async (c) => {
  const info = await aggregationService.getAggregationInfo();

  return c.json({
    success: true,
    data: {
      timescaledb_available: isTimescaleDBAvailable(),
      mode: info.mode,
      using_continuous_aggregates: info.usingContinuousAggregates,
    },
  });
});

/**
 * Reinitialize database schema (admin only)
 * Useful when tables are missing or schema is corrupted
 */
system.post("/init-schema", requireRole("admin"), async (c) => {
  logger.info("[System] Reinitializing database schema...");

  try {
    await initSchema();

    logger.info("[System] Database schema reinitialized successfully");

    return c.json({
      success: true,
      message: "Database schema reinitialized successfully",
      timescaledb_available: isTimescaleDBAvailable(),
    });
  } catch (error) {
    logger.error("[System] Schema initialization failed:", error);

    return c.json(
      {
        success: false,
        error: {
          code: "SCHEMA_INIT_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
});

/**
 * Switch to TimescaleDB continuous aggregates (admin only)
 * Drops regular tables and creates continuous aggregate materialized views
 */
system.post("/switch-to-continuous-aggregates", requireRole("admin"), async (c) => {
  logger.info("[System] Switching to TimescaleDB continuous aggregates...");

  try {
    // Check TimescaleDB is available
    if (!isTimescaleDBAvailable()) {
      return c.json(
        {
          success: false,
          error: {
            code: "TIMESCALEDB_NOT_AVAILABLE",
            message: "TimescaleDB extension is not installed",
          },
        },
        400
      );
    }

    // Check if continuous aggregates already exist
    const caggCheck = await db`
      SELECT view_name FROM timescaledb_information.continuous_aggregates
      WHERE view_name LIKE 'telemetry_%_daily'
    `;

    if (caggCheck.length > 0) {
      const viewNames = caggCheck.map((r) => r.view_name as string).join(", ");
      return c.json(
        {
          success: false,
          error: {
            code: "CONTINUOUS_AGGREGATES_EXIST",
            message: "Continuous aggregates already exist: " + viewNames,
          },
        },
        400
      );
    }

    // Drop existing regular tables
    logger.info("[System] Dropping existing regular tables...");

    await db`DROP TABLE IF EXISTS telemetry_perf_daily CASCADE`;
    await db`DROP TABLE IF EXISTS telemetry_conversations_daily CASCADE`;
    await db`DROP TABLE IF EXISTS telemetry_conversation_errors_daily CASCADE`;
    await db`DROP TABLE IF EXISTS telemetry_turns_daily CASCADE`;
    await db`DROP TABLE IF EXISTS telemetry_steps_daily CASCADE`;
    await db`DROP TABLE IF EXISTS telemetry_install_daily CASCADE`;

    logger.info("[System] Regular tables dropped");

    // Create continuous aggregates
    await createContinuousAggregates();

    logger.info("[System] Successfully switched to continuous aggregates");

    return c.json({
      success: true,
      message: "Successfully switched to TimescaleDB continuous aggregates",
    });
  } catch (error) {
    logger.error("[System] Switch to continuous aggregates failed:", error);

    return c.json(
      {
        success: false,
        error: {
          code: "SWITCH_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      },
      500
    );
  }
});

/**
 * Get system stats (admin only)
 */
system.get("/stats", requireRole("admin"), async (c) => {
  // Get memory stats
  const memoryUsage = process.memoryUsage();

  // Get database stats
  const dbStats = {
    size: 0,
    tables: [] as { name: string; count: number }[],
  };

  try {
    // Get table counts
    const tables = [
      "telemetry_perf_raw",
      "telemetry_conversations",
      "telemetry_install",
      "telemetry_perf_daily",
      "telemetry_conversations_daily",
      "telemetry_conversation_errors_daily",
      "telemetry_install_daily",
      "crash_events",
      "crash_issues",
      "crash_daily_stats",
      "alert_config",
      "alert_history",
      "audit_logs",
      "system_config",
    ];

    for (const table of tables) {
      const result = await db.unsafe(`SELECT COUNT(*) as count FROM ${table}`);
      dbStats.tables.push({ name: table, count: result[0]?.count ?? 0 });
    }
  } catch {
    // Ignore errors
  }

  const stats: SystemStats = {
    uptime: Math.floor(process.uptime()),
    version: "1.0.0",
    node_version: process.version,
    platform: process.platform,
    memory_usage: {
      rss: memoryUsage.rss,
      heap_total: memoryUsage.heapTotal,
      heap_used: memoryUsage.heapUsed,
      external: memoryUsage.external,
    },
    database: dbStats,
  };

  return c.json({
    success: true,
    data: stats,
  });
});

/**
 * Get system configuration (admin only)
 */
system.get("/config", requireRole("admin"), async (c) => {
  const configs = await db`
    SELECT * FROM system_config ORDER BY key
  `;

  return c.json({
    success: true,
    data: configs,
  });
});

/**
 * Get single config value
 */
system.get("/config/:key", requireRole("admin"), async (c) => {
  const key = c.req.param("key") as string;

  const configs = await db`
    SELECT * FROM system_config WHERE key = ${key}
  `;

  if (configs.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Config not found" },
      },
      404
    );
  }

  return c.json({
    success: true,
    data: configs[0],
  });
});

/**
 * Update config value
 */
system.put("/config/:key", requireRole("admin"), async (c) => {
  const userId = c.get("userId") as string;
  const key = c.req.param("key") as string;
  const body = await c.req.json<{ value: string }>();
  const now = new Date();

  const existing = await db`
    SELECT * FROM system_config WHERE key = ${key}
  `;

  if (existing.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Config not found" },
      },
      404
    );
  }

  await db`
    UPDATE system_config SET value = ${body.value}, updated_at = ${now} WHERE key = ${key}
  `;

  // Audit log
  await db`
    INSERT INTO audit_logs (user_id, action, resource, resource_id, detail, created_at)
    VALUES (${userId}, 'config_update', 'system_config', ${key}, ${`${existing[0]!.value} -> ${body.value}`}, ${now})
  `;

  logger.info("Config updated: " + key + " = " + body.value);

  return c.json({
    success: true,
    data: {
      key,
      value: body.value,
      description: existing[0]!.description,
      updated_at: now.getTime(),
    },
  });
});

/**
 * Get environment info (admin only)
 */
system.get("/env", requireRole("admin"), (c) => {
  // Return safe environment info
  const envInfo = {
    NODE_ENV: config.env,
    PORT: config.port,
    HOST: config.host,
    LOG_LEVEL: config.logLevel,
    // Don't expose secrets
  };

  return c.json({
    success: true,
    data: envInfo,
  });
});

/**
 * Get notification config (admin only)
 */
system.get("/notifications", requireRole("admin"), async (c) => {
  // Get config from database, fallback to env
  const dbConfigs = await db`
    SELECT key, value FROM system_config
    WHERE key LIKE 'notification_%'
  `;

  const getConfigValue = (key: string, fallback?: string): string => {
    const dbConfig = dbConfigs.find(c => c.key === key);
    return dbConfig?.value || fallback || "";
  };

  return c.json({
    success: true,
    data: {
      lark: {
        webhookUrl: getConfigValue("notification_lark_webhook", config.notifications.lark.webhookUrl),
      },
      email: {
        smtpHost: getConfigValue("notification_email_smtp_host", config.notifications.email.smtpHost),
        smtpPort: parseInt(getConfigValue("notification_email_smtp_port", String(config.notifications.email.smtpPort))) || 587,
        smtpUser: getConfigValue("notification_email_smtp_user", config.notifications.email.smtpUser),
        smtpPass: getConfigValue("notification_email_smtp_pass", config.notifications.email.smtpPass),
        from: getConfigValue("notification_email_from", config.notifications.email.from),
        to: getConfigValue("notification_email_to", config.notifications.email.to),
      },
    },
  });
});

/**
 * Update notification config (admin only)
 */
system.put("/notifications", requireRole("admin"), async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.json<{
    lark?: { webhookUrl?: string };
    email?: {
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPass?: string;
      from?: string;
      to?: string;
    };
  }>();
  const now = new Date();

  const updates: { key: string; value: string; description: string }[] = [];

  if (body.lark?.webhookUrl !== undefined) {
    updates.push({
      key: "notification_lark_webhook",
      value: body.lark.webhookUrl,
      description: "飞书 Webhook URL",
    });
  }

  if (body.email) {
    if (body.email.smtpHost !== undefined) {
      updates.push({
        key: "notification_email_smtp_host",
        value: body.email.smtpHost,
        description: "SMTP 服务器地址",
      });
    }
    if (body.email.smtpPort !== undefined) {
      updates.push({
        key: "notification_email_smtp_port",
        value: String(body.email.smtpPort),
        description: "SMTP 服务器端口",
      });
    }
    if (body.email.smtpUser !== undefined) {
      updates.push({
        key: "notification_email_smtp_user",
        value: body.email.smtpUser,
        description: "SMTP 用户名",
      });
    }
    if (body.email.smtpPass !== undefined) {
      updates.push({
        key: "notification_email_smtp_pass",
        value: body.email.smtpPass,
        description: "SMTP 密码",
      });
    }
    if (body.email.from !== undefined) {
      updates.push({
        key: "notification_email_from",
        value: body.email.from,
        description: "邮件发送者地址",
      });
    }
    if (body.email.to !== undefined) {
      updates.push({
        key: "notification_email_to",
        value: body.email.to,
        description: "邮件接收者地址",
      });
    }
  }

  for (const update of updates) {
    const existing = await db`
      SELECT value FROM system_config WHERE key = ${update.key}
    `;

    if (existing.length === 0) {
      await db`
        INSERT INTO system_config (key, value, description, updated_at)
        VALUES (${update.key}, ${update.value}, ${update.description}, ${now})
      `;
    } else {
      await db`
        UPDATE system_config SET value = ${update.value}, updated_at = ${now}
        WHERE key = ${update.key}
      `;
    }

    // Audit log
    await db`
      INSERT INTO audit_logs (user_id, action, resource, resource_id, detail, created_at)
      VALUES (${userId}, 'config_update', 'notification', ${update.key}, ${`${existing[0]?.value || ''} -> ${update.value}`}, ${now})
    `;
  }

  logger.info("[System] Notification config updated:", updates.map(u => u.key).join(", "));

  return c.json({
    success: true,
    message: "通知配置已更新",
  });
});

/**
 * Test notification (admin only)
 */
system.post("/notifications/test/:channel", requireRole("admin"), async (c) => {
  const channel = c.req.param("channel") as "lark" | "email";

  if (channel !== "lark" && channel !== "email") {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_CHANNEL", message: "只支持 lark 和 email 通道" },
      },
      400
    );
  }

  // Get current config from database
  const dbConfigs = await db`
    SELECT key, value FROM system_config
    WHERE key LIKE 'notification_%'
  `;

  const getConfigValue = (key: string, fallback?: string): string => {
    const dbConfig = dbConfigs.find(c => c.key === key);
    return dbConfig?.value || fallback || "";
  };

  // Build config for test
  const testConfig = {
    lark: {
      webhookUrl: getConfigValue("notification_lark_webhook", config.notifications.lark.webhookUrl),
    },
    email: {
      smtpHost: getConfigValue("notification_email_smtp_host", config.notifications.email.smtpHost),
      smtpPort: parseInt(getConfigValue("notification_email_smtp_port", String(config.notifications.email.smtpPort))) || 587,
      smtpUser: getConfigValue("notification_email_smtp_user", config.notifications.email.smtpUser),
      smtpPass: getConfigValue("notification_email_smtp_pass", config.notifications.email.smtpPass),
      from: getConfigValue("notification_email_from", config.notifications.email.from),
      to: getConfigValue("notification_email_to", config.notifications.email.to),
    },
  };

  try {
    const result = await notificationService.testNotification(channel, testConfig);

    if (result.success) {
      logger.info(`[System] Test notification sent to ${channel}`);
      return c.json({
        success: true,
        message: `测试通知已发送到 ${channel === "lark" ? "飞书" : "邮件"}`,
      });
    } else {
      logger.error(`[System] Test notification failed for ${channel}:`, result.error);
      return c.json(
        {
          success: false,
          error: { code: "TEST_FAILED", message: result.error || "发送失败" },
        },
        400
      );
    }
  } catch (error) {
    logger.error(`[System] Test notification error for ${channel}:`, error);
    return c.json(
      {
        success: false,
        error: { code: "TEST_ERROR", message: error instanceof Error ? error.message : "发送异常" },
      },
      500
    );
  }
});

/**
 * Get scheduled task status (admin only)
 */
system.get("/tasks", requireRole("admin"), async (c) => {
  const scheduler = getSchedulerInstance();

  if (!scheduler) {
    return c.json(
      {
        success: false,
        error: { code: "SCHEDULER_NOT_INITIALIZED", message: "调度器未初始化" },
      },
      500
    );
  }

  const tasks = scheduler.getTaskStatus();

  return c.json({
    success: true,
    data: tasks.map((t) => ({
      name: t.name,
      last_run: t.lastRun,
      next_run: t.nextRun,
      running: t.running,
      last_error: t.lastError,
    })),
  });
});

/**
 * Run aggregation tasks immediately (admin only)
 * Triggers all aggregation-related tasks to run right now
 */
system.post("/aggregation/run", requireRole("admin"), async (c) => {
  const scheduler = getSchedulerInstance();

  if (!scheduler) {
    return c.json(
      {
        success: false,
        error: { code: "SCHEDULER_NOT_INITIALIZED", message: "调度器未初始化" },
      },
      500
    );
  }

  logger.info("[System] Manual aggregation triggered by admin");

  try {
    // Run all aggregation tasks
    const results: { task: string; success: boolean; error?: string }[] = [];

    // 1. Telemetry aggregation (perf, errors, conversations, installs)
    try {
      await aggregationService.refreshContinuousAggregates();
      results.push({ task: "telemetry_aggregation", success: true });
    } catch (error) {
      results.push({
        task: "telemetry_aggregation",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // 2. Crash aggregation
    try {
      await aggregateCrashDailyStats();
      results.push({ task: "crash_aggregation", success: true });
    } catch (error) {
      results.push({
        task: "crash_aggregation",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Update scheduler's last run time for these tasks
    scheduler.runTask("aggregation-refresh");
    scheduler.runTask("crash-aggregation");

    const allSuccess = results.every((r) => r.success);

    return c.json({
      success: allSuccess,
      data: {
        results,
        timestamp: Date.now(),
      },
      message: allSuccess ? "聚合任务执行完成" : "部分聚合任务执行失败",
    });
  } catch (error) {
    logger.error("[System] Manual aggregation failed:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "AGGREGATION_FAILED",
          message: error instanceof Error ? error.message : "聚合任务执行失败",
        },
      },
      500
    );
  }
});

/**
 * Get raw table data statistics (admin only)
 * Shows how many records exist in each raw telemetry table
 */
system.get("/raw-stats", requireRole("admin"), async (c) => {
  try {
    const tables = [
      { name: "telemetry_perf_raw", label: "性能原始数据", timeColumn: "created_at" },
      { name: "telemetry_conversations", label: "对话原始数据", timeColumn: "created_at" },
      { name: "telemetry_install", label: "安装原始数据", timeColumn: "created_at" },
      { name: "crash_events", label: "崩溃原始数据", timeColumn: "created_at" },
    ];

    const stats: { table: string; label: string; count: number; earliest: string | null; latest: string | null }[] = [];

    for (const table of tables) {
      const countResult = await db.unsafe(`SELECT COUNT(*) as count FROM ${table.name}`);
      const timeResult = await db.unsafe(`
        SELECT
          MIN(${table.timeColumn}) as earliest,
          MAX(${table.timeColumn}) as latest
        FROM ${table.name}
      `);

      stats.push({
        table: table.name,
        label: table.label,
        count: countResult[0]?.count ?? 0,
        earliest: timeResult[0]?.earliest ? new Date(timeResult[0].earliest).toISOString() : null,
        latest: timeResult[0]?.latest ? new Date(timeResult[0].latest).toISOString() : null,
      });
    }

    // Also show daily aggregation table stats
    const dailyTables = [
      { name: "telemetry_perf_daily", label: "性能聚合数据", timeColumn: "bucket" },
      { name: "telemetry_conversations_daily", label: "对话聚合数据", timeColumn: "bucket" },
      { name: "telemetry_conversation_errors_daily", label: "对话错误聚合数据", timeColumn: "bucket" },
      { name: "telemetry_install_daily", label: "安装聚合数据", timeColumn: "bucket" },
      { name: "crash_daily_stats", label: "崩溃聚合数据", timeColumn: "bucket" },
    ];

    for (const table of dailyTables) {
      const countResult = await db.unsafe(`SELECT COUNT(*) as count FROM ${table.name}`);
      const bucketResult = await db.unsafe(`
        SELECT
          MIN(${table.timeColumn}) as earliest,
          MAX(${table.timeColumn}) as latest
        FROM ${table.name}
      `);

      stats.push({
        table: table.name,
        label: table.label,
        count: countResult[0]?.count ?? 0,
        earliest: bucketResult[0]?.earliest ? new Date(bucketResult[0].earliest).toISOString() : null,
        latest: bucketResult[0]?.latest ? new Date(bucketResult[0].latest).toISOString() : null,
      });
    }

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("[System] Failed to get raw stats:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "STATS_FAILED",
          message: error instanceof Error ? error.message : "获取统计数据失败",
        },
      },
      500
    );
  }
});

/**
 * Backfill aggregation data for historical days (admin only)
 * Useful when you have historical raw data but aggregation tables are empty
 */
system.post("/aggregation/backfill", requireRole("admin"), async (c) => {
  const body = await c.req.json<{ days?: number }>();
  const days = body.days || 7; // Default to 7 days

  if (days < 1 || days > 30) {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_DAYS", message: "天数必须在1-30之间" },
      },
      400
    );
  }

  logger.info(`[System] Backfill aggregation for ${days} days triggered by admin`);

  try {
    // Run aggregation from 1 to N days ago
    await aggregationService.runAggregationForRange(1, days);
    await aggregateCrashDailyStats();

    return c.json({
      success: true,
      message: `历史数据回填完成，已聚合最近 ${days} 天的数据`,
    });
  } catch (error) {
    logger.error("[System] Backfill aggregation failed:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "BACKFILL_FAILED",
          message: error instanceof Error ? error.message : "历史数据回填失败",
        },
      },
      500
    );
  }
});

/**
 * Get error code definitions (viewer+)
 * Returns the complete error code definition table
 */
system.get("/error-codes", async (c) => {
  return c.json({
    success: true,
    data: ERROR_CODE_DEFINITIONS,
  });
});

export default system;
