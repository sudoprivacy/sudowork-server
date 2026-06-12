/**
 * Dashboard API routes
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index.js";
import { jwtAuth, requireRole } from "../middleware/auth.js";
import { calculateStats, calculateTrend, calculateSuccessRate, calculateErrorRate } from "../utils/stats.js";
import { getTenantScope } from "../utils/tenant.js";
import type { TimeRangeQuery, PerfQuery, ConversationQuery, InstallQuery } from "../types/telemetry.js";

const dashboard = new Hono();

// All dashboard endpoints require JWT auth (viewer role minimum)
dashboard.use("/*", jwtAuth);
dashboard.use("/*", requireRole("viewer", "operator", "admin"));

function toNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function scopedTenantId(c: Context, requestedTenantId?: string | null): string | null {
  return getTenantScope(c, requestedTenantId).tenantId;
}

/**
 * Get dashboard overview summary
 */
dashboard.get("/overview", async (c) => {
  const query = c.req.query() as TimeRangeQuery;
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);

  // Previous period for trend calculation
  const prevEndTime = startTime;
  const prevStartTime = new Date(startTime.getTime() - (endTime.getTime() - startTime.getTime()));

  // Conversations summary - cast bigint to integer for JavaScript compatibility
  const conversations = await db`
    SELECT
      COUNT(*)::INTEGER as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error,
      SUM(CASE WHEN status = 'user_cancel' THEN 1 ELSE 0 END)::INTEGER as user_cancel,
      AVG(duration_ms)::INTEGER as avg_duration_ms,
      AVG(tokens_used)::INTEGER as avg_tokens
    FROM telemetry_conversations
    WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
  `;

  const prevConversations = await db`
    SELECT COUNT(*)::INTEGER as total
    FROM telemetry_conversations
    WHERE timestamp >= ${prevStartTime} AND timestamp < ${prevEndTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
  `;

  // Top errors from conversations (by error_code)
  const topErrors = await db`
    SELECT
      error_code,
      COUNT(*)::INTEGER as count,
      MAX(created_at) as last_occurrence
    FROM telemetry_conversations
    WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      AND status = 'error'
      AND error_code IS NOT NULL
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 5
  `;

  // Previous period top errors for trends
  const prevTopErrors = await db`
    SELECT
      error_code,
      COUNT(*)::INTEGER as count
    FROM telemetry_conversations
    WHERE timestamp >= ${prevStartTime} AND timestamp < ${prevEndTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      AND status = 'error'
      AND error_code IS NOT NULL
    GROUP BY error_code
  `;

  const prevErrorCounts: Record<string, number> = {};
  for (const e of prevTopErrors) {
    prevErrorCounts[e.error_code] = toNumber(e.count);
  }

  // Performance metrics summary
  const perfMetrics = await db`
    SELECT metric, value_ms
    FROM telemetry_perf_raw
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
  `;

  // Group by metric and calculate stats
  const perfByMetric: Record<string, number[]> = {};
  for (const row of perfMetrics) {
    const metric = String(row.metric);
    perfByMetric[metric] ??= [];
    // Convert BIGINT string to number
    perfByMetric[metric].push(Number(row.value_ms));
  }

  const perfSummary = Object.entries(perfByMetric).map(([metric, values]) => ({
    metric,
    ...calculateStats(values),
  }));

  // Previous period perf for trends
  const prevPerfMetrics = await db`
    SELECT metric, AVG(value_ms) as avg
    FROM telemetry_perf_raw
    WHERE created_at >= ${prevStartTime} AND created_at < ${prevEndTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    GROUP BY metric
  `;

  const prevPerfByMetric: Record<string, number> = {};
  for (const row of prevPerfMetrics) {
    // Convert BIGINT string to number
    prevPerfByMetric[row.metric] = Number(row.avg);
  }

  // Installs summary
  const installs = await db`
    SELECT
      COUNT(*)::INTEGER as total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::INTEGER as failed,
      AVG(duration_ms)::INTEGER as avg_duration_ms
    FROM telemetry_install
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
  `;

  const installByVersion = await db`
    SELECT version, COUNT(*)::INTEGER as count
    FROM telemetry_install
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    GROUP BY version
    ORDER BY count DESC
    LIMIT 5
  `;

  const installByPlatform = await db`
    SELECT platform, COUNT(*)::INTEGER as count
    FROM telemetry_install
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    GROUP BY platform
    ORDER BY count DESC
    LIMIT 5
  `;

  // Crash summary
  const crashTotal = await db`
    SELECT COUNT(*)::INTEGER as total
    FROM crash_events
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
  `;

  const crashByType = await db`
    SELECT type, COUNT(*)::INTEGER as count
    FROM crash_events
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    GROUP BY type
    ORDER BY count DESC
    LIMIT 5
  `;

  const crashByPlatform = await db`
    SELECT platform, COUNT(*)::INTEGER as count
    FROM crash_events
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    GROUP BY platform
    ORDER BY count DESC
    LIMIT 5
  `;

  const crashByVersion = await db`
    SELECT version, COUNT(*)::INTEGER as count
    FROM crash_events
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    GROUP BY version
    ORDER BY count DESC
    LIMIT 5
  `;

  const crashByProcess = await db`
    SELECT process_type, COUNT(*)::INTEGER as count
    FROM crash_events
    WHERE created_at >= ${startTime} AND created_at < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    GROUP BY process_type
    ORDER BY count DESC
  `;

  // Previous period crash count for trend
  const prevCrashTotal = await db`
    SELECT COUNT(*)::INTEGER as total
    FROM crash_events
    WHERE created_at >= ${prevStartTime} AND created_at < ${prevEndTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
  `;

  const convData = conversations[0] || {};
  const prevConvData = prevConversations[0] || {};
  const instData = installs[0] || {};
  const crashData = crashTotal[0] || {};
  const prevCrashData = prevCrashTotal[0] || {};

  const topErrorsWithTrends = topErrors.map((e) => ({
    error_code: e.error_code,
    count: toNumber(e.count),
    last_occurrence: e.last_occurrence instanceof Date ? e.last_occurrence.getTime() : e.last_occurrence,
    trend: calculateTrend(toNumber(e.count), prevErrorCounts[e.error_code] || 0),
  }));

  const conversationTotal = toNumber(convData.total);
  const conversationSuccess = toNumber(convData.success);
  const conversationError = toNumber(convData.error);
  const conversationUserCancel = toNumber(convData.user_cancel);
  const prevConversationTotal = toNumber(prevConvData.total);

  return c.json({
    success: true,
    data: {
      period: {
        start: startTime.getTime(),
        end: endTime.getTime(),
      },
      conversations: {
        total: conversationTotal,
        success: conversationSuccess,
        error: conversationError,
        user_cancel: conversationUserCancel,
        success_rate: calculateSuccessRate(conversationSuccess, conversationTotal),
        avg_duration_ms: Math.round(toNumber(convData.avg_duration_ms)),
        avg_tokens: Math.round(toNumber(convData.avg_tokens)),
        trend: calculateTrend(conversationTotal, prevConversationTotal),
      },
      errors: {
        total: conversationError,
        error_rate: calculateErrorRate(conversationError, conversationTotal),
        top_errors: topErrorsWithTrends,
      },
      performance: {
        metrics: perfSummary.map((p) => ({
          ...p,
          trend: calculateTrend(p.avg, prevPerfByMetric[p.metric] || 0),
        })),
      },
      installs: {
        total: instData.total ?? 0,
        success: instData.success ?? 0,
        failed: instData.failed ?? 0,
        success_rate: calculateSuccessRate(instData.success ?? 0, instData.total ?? 0),
        avg_duration_ms: Math.round(instData.avg_duration_ms ?? 0),
        by_version: installByVersion,
        by_platform: installByPlatform,
      },
      crashes: {
        total: crashData.total ?? 0,
        trend: calculateTrend(crashData.total ?? 0, prevCrashData.total ?? 0),
        by_type: crashByType,
        by_platform: crashByPlatform,
        by_version: crashByVersion,
        by_process: crashByProcess,
      },
    },
  });
});

/**
 * Get performance trends with dimension support
 */
dashboard.get("/perf/trend", async (c) => {
  const query = c.req.query() as PerfQuery & { dimension?: string; platform?: string; arch?: string; version?: string };
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);

  const metric = query.metric;
  const dimension = query.dimension || "all"; // all, platform, version
  const platformFilter = query.platform;
  const archFilter = query.arch;
  const versionFilter = query.version;

  // Build dynamic query based on filters and dimension
  let data;

  if (dimension === "platform") {
    // Group by platform + arch
    if (metric) {
      if (platformFilter && archFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
            AND platform = ${platformFilter} AND arch = ${archFilter}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      } else if (platformFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
            AND platform = ${platformFilter}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      } else if (versionFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
            AND version = ${versionFilter}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      } else {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      }
    } else {
      if (platformFilter && archFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
            AND platform = ${platformFilter} AND arch = ${archFilter}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      } else if (platformFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
            AND platform = ${platformFilter}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      } else if (versionFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
            AND version = ${versionFilter}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      } else {
        data = await db`
          SELECT
            bucket as date,
            metric,
            platform,
            arch,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
          GROUP BY bucket, metric, platform, arch
          ORDER BY bucket ASC, platform, arch
        `;
      }
    }
  } else if (dimension === "version") {
    // Group by version
    if (metric) {
      if (platformFilter && archFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            version,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
            AND platform = ${platformFilter} AND arch = ${archFilter}
          GROUP BY bucket, metric, version
          ORDER BY bucket ASC, version
        `;
      } else if (versionFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            version,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
            AND version = ${versionFilter}
          GROUP BY bucket, metric, version
          ORDER BY bucket ASC, version
        `;
      } else {
        data = await db`
          SELECT
            bucket as date,
            metric,
            version,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
          GROUP BY bucket, metric, version
          ORDER BY bucket ASC, version
        `;
      }
    } else {
      if (platformFilter && archFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            version,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
            AND platform = ${platformFilter} AND arch = ${archFilter}
          GROUP BY bucket, metric, version
          ORDER BY bucket ASC, version
        `;
      } else if (versionFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            version,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
            AND version = ${versionFilter}
          GROUP BY bucket, metric, version
          ORDER BY bucket ASC, version
        `;
      } else {
        data = await db`
          SELECT
            bucket as date,
            metric,
            version,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
          GROUP BY bucket, metric, version
          ORDER BY bucket ASC, version
        `;
      }
    }
  } else {
    // Aggregate across all dimensions (default)
    if (metric) {
      if (platformFilter && archFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
            AND platform = ${platformFilter} AND arch = ${archFilter}
          GROUP BY bucket, metric
          ORDER BY bucket ASC
        `;
      } else if (versionFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
            AND version = ${versionFilter}
          GROUP BY bucket, metric
          ORDER BY bucket ASC
        `;
      } else {
        data = await db`
          SELECT
            bucket as date,
            metric,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND metric = ${metric}
          GROUP BY bucket, metric
          ORDER BY bucket ASC
        `;
      }
    } else {
      if (platformFilter && archFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
            AND platform = ${platformFilter} AND arch = ${archFilter}
          GROUP BY bucket, metric
          ORDER BY bucket ASC
        `;
      } else if (versionFilter) {
        data = await db`
          SELECT
            bucket as date,
            metric,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
            AND version = ${versionFilter}
          GROUP BY bucket, metric
          ORDER BY bucket ASC
        `;
      } else {
        data = await db`
          SELECT
            bucket as date,
            metric,
            AVG(p50)::INTEGER as p50,
            AVG(p90)::INTEGER as p90,
            AVG(p95)::INTEGER as p95,
            AVG(avg_value)::INTEGER as avg_value,
            SUM(count)::INTEGER as count
          FROM telemetry_perf_daily
          WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
          GROUP BY bucket, metric
          ORDER BY bucket ASC
        `;
      }
    }
  }

  const formattedData = data.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().split("T")[0]! : r.date,
    metric: r.metric,
    platform: r.platform,
    arch: r.arch,
    version: r.version,
    p50: r.p50,
    p90: r.p90,
    p95: r.p95,
    avg_value: r.avg_value,
    count: r.count,
  }));

  return c.json({
    success: true,
    data: formattedData,
  });
});

/**
 * Get available platforms and versions for filtering
 */
dashboard.get("/perf/dimensions", async (c) => {
  const query = c.req.query() as TimeRangeQuery;
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);

  const platforms = await db`
    SELECT DISTINCT platform, arch
    FROM telemetry_perf_daily
    WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY platform, arch
  `;

  const versions = await db`
    SELECT DISTINCT version
    FROM telemetry_perf_daily
    WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY version DESC
  `;

  const metrics = await db`
    SELECT DISTINCT metric
    FROM telemetry_perf_daily
    WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY metric
  `;

  // Map platform+arch to friendly names
  const platformOptions = platforms.map((p) => {
    let label = p.platform;
    if (p.platform === "win32" && p.arch === "x64") {
      label = "Windows X64";
    } else if (p.platform === "win32" && p.arch === "x86") {
      label = "Windows X86";
    } else if (p.platform === "darwin" && p.arch === "x64") {
      label = "macOS Intel";
    } else if (p.platform === "darwin" && p.arch === "arm64") {
      label = "macOS ARM";
    } else {
      label = `${p.platform} ${p.arch}`;
    }
    return {
      platform: p.platform,
      arch: p.arch,
      label,
      value: `${p.platform}|${p.arch}`,
    };
  });

  return c.json({
    success: true,
    data: {
      platforms: platformOptions,
      versions: versions.map((v) => v.version),
      metrics: metrics.map((m) => m.metric),
    },
  });
});

/**
 * Get conversation error trends (by error_code)
 */
dashboard.get("/conversations/errors/trend", async (c) => {
  const query = c.req.query() as TimeRangeQuery & { error_code?: string };
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);

  const errorCode = query.error_code;

  const data = await db`
    SELECT
      DATE_TRUNC('day', timestamp) as date,
      error_code,
      COUNT(*)::INTEGER as count
    FROM telemetry_conversations
    WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      ${errorCode ? db`AND error_code = ${errorCode}` : db``}
      AND status = 'error'
      AND error_code IS NOT NULL
    GROUP BY DATE_TRUNC('day', timestamp), error_code
    ORDER BY date ASC
  `;

  const formattedData = data.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().split("T")[0]! : r.date,
    error_code: r.error_code,
    count: r.count,
  }));

  return c.json({
    success: true,
    data: formattedData,
  });
});

/**
 * Get conversation trends with dimension support
 */
dashboard.get("/conversations/trend", async (c) => {
  const query = c.req.query() as ConversationQuery & { dimension?: string };
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);
  const dimension = query.dimension || "all";

  let data;

  if (dimension === "platform") {
    // Group by platform + arch
    data = await db`
      SELECT
        DATE_TRUNC('day', timestamp) as date,
        platform,
        arch,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error_count,
        SUM(CASE WHEN status = 'user_cancel' THEN 1 ELSE 0 END)::INTEGER as user_cancel_count,
        COUNT(*)::INTEGER as total_count,
        AVG(duration_ms)::INTEGER as avg_duration_ms,
        AVG(tokens_used)::INTEGER as avg_tokens,
        COALESCE(ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(
          SUM(CASE WHEN status IN ('success', 'error') THEN 1 ELSE 0 END),
          0
        )) * 100), 100)::INTEGER as success_rate
      FROM telemetry_conversations
      WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
        ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      GROUP BY DATE_TRUNC('day', timestamp), platform, arch
      ORDER BY date ASC, platform, arch
    `;
  } else if (dimension === "version") {
    // Group by version
    data = await db`
      SELECT
        DATE_TRUNC('day', timestamp) as date,
        version,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error_count,
        SUM(CASE WHEN status = 'user_cancel' THEN 1 ELSE 0 END)::INTEGER as user_cancel_count,
        COUNT(*)::INTEGER as total_count,
        AVG(duration_ms)::INTEGER as avg_duration_ms,
        AVG(tokens_used)::INTEGER as avg_tokens,
        COALESCE(ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(
          SUM(CASE WHEN status IN ('success', 'error') THEN 1 ELSE 0 END),
          0
        )) * 100), 100)::INTEGER as success_rate
      FROM telemetry_conversations
      WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
        ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      GROUP BY DATE_TRUNC('day', timestamp), version
      ORDER BY date ASC, version
    `;
  } else {
    // Aggregate across all dimensions (default)
    data = await db`
      SELECT
        DATE_TRUNC('day', timestamp) as date,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error_count,
        SUM(CASE WHEN status = 'user_cancel' THEN 1 ELSE 0 END)::INTEGER as user_cancel_count,
        COUNT(*)::INTEGER as total_count,
        AVG(duration_ms)::INTEGER as avg_duration_ms,
        AVG(tokens_used)::INTEGER as avg_tokens,
        COALESCE(ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(
          SUM(CASE WHEN status IN ('success', 'error') THEN 1 ELSE 0 END),
          0
        )) * 100), 100)::INTEGER as success_rate
      FROM telemetry_conversations
      WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
        ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      GROUP BY DATE_TRUNC('day', timestamp)
      ORDER BY date ASC
    `;
  }

  const formattedData = data.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().split("T")[0]! : r.date,
    platform: r.platform,
    arch: r.arch,
    version: r.version,
    success_count: r.success_count,
    error_count: r.error_count,
    user_cancel_count: r.user_cancel_count,
    total_count: r.total_count,
    avg_duration_ms: r.avg_duration_ms,
    avg_tokens: r.avg_tokens,
    success_rate: r.success_rate,
  }));

  return c.json({
    success: true,
    data: formattedData,
  });
});

/**
 * Get conversation dimensions (platforms and versions)
 */
dashboard.get("/conversations/dimensions", async (c) => {
  const query = c.req.query() as TimeRangeQuery;
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);

  const platforms = await db`
    SELECT DISTINCT platform, arch
    FROM telemetry_conversations
    WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY platform, arch
  `;

  const versions = await db`
    SELECT DISTINCT version
    FROM telemetry_conversations
    WHERE timestamp >= ${startTime} AND timestamp < ${endTime}
      ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY version DESC
  `;

  // Map platform+arch to friendly names
  const platformOptions = platforms.map((p) => {
    let label = p.platform;
    if (p.platform === "win32" && p.arch === "x64") {
      label = "Windows X64";
    } else if (p.platform === "win32" && p.arch === "x86") {
      label = "Windows X86";
    } else if (p.platform === "darwin" && p.arch === "x64") {
      label = "macOS Intel";
    } else if (p.platform === "darwin" && p.arch === "arm64") {
      label = "macOS ARM";
    } else {
      label = `${p.platform} ${p.arch}`;
    }
    return {
      platform: p.platform,
      arch: p.arch,
      label,
      value: `${p.platform}|${p.arch}`,
    };
  });

  return c.json({
    success: true,
    data: {
      platforms: platformOptions,
      versions: versions.map((v) => v.version),
    },
  });
});

/**
 * Get install trends with dimension support
 */
dashboard.get("/installs/trend", async (c) => {
  const query = c.req.query() as InstallQuery & { dimension?: string };
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);

  const version = query.version;
  const installType = query.install_type;
  const dimension = query.dimension || "all";

  let data;

  if (dimension === "platform") {
    // Group by platform + arch
    data = await db`
      SELECT
        bucket as date,
        platform,
        arch,
        install_type,
        SUM(success_count)::INTEGER as success_count,
        SUM(failed_count)::INTEGER as failed_count,
        SUM(total_count)::INTEGER as total_count,
        ROUND(AVG(success_rate))::INTEGER as success_rate
      FROM telemetry_install_daily
      WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      GROUP BY bucket, platform, arch, install_type
      ORDER BY bucket ASC, platform, arch
    `;
  } else if (dimension === "version") {
    // Group by version (already supported)
    if (installType) {
      data = await db`
        SELECT
          bucket as date,
          version,
          install_type,
          SUM(success_count)::INTEGER as success_count,
          SUM(failed_count)::INTEGER as failed_count,
          SUM(total_count)::INTEGER as total_count,
          ROUND(AVG(success_rate))::INTEGER as success_rate
        FROM telemetry_install_daily
        WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``} AND install_type = ${installType}
        GROUP BY bucket, version, install_type
        ORDER BY bucket ASC, version
      `;
    } else {
      data = await db`
        SELECT
          bucket as date,
          version,
          install_type,
          SUM(success_count)::INTEGER as success_count,
          SUM(failed_count)::INTEGER as failed_count,
          SUM(total_count)::INTEGER as total_count,
          ROUND(AVG(success_rate))::INTEGER as success_rate
        FROM telemetry_install_daily
        WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
        GROUP BY bucket, version, install_type
        ORDER BY bucket ASC, version
      `;
    }
  } else {
    // Aggregate across all dimensions (default) - include platform for summary stats
    data = await db`
      SELECT
        bucket as date,
        version,
        platform,
        arch,
        install_type,
        SUM(success_count)::INTEGER as success_count,
        SUM(failed_count)::INTEGER as failed_count,
        SUM(total_count)::INTEGER as total_count,
        ROUND(AVG(success_rate))::INTEGER as success_rate
      FROM telemetry_install_daily
      WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
      GROUP BY bucket, version, platform, arch, install_type
      ORDER BY bucket ASC
    `;
  }

  const formattedData = data.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().split("T")[0]! : r.date,
    platform: r.platform,
    arch: r.arch,
    version: r.version,
    install_type: r.install_type,
    success_count: r.success_count,
    failed_count: r.failed_count,
    total_count: r.total_count,
    success_rate: r.success_rate,
  }));

  return c.json({
    success: true,
    data: formattedData,
  });
});

/**
 * Get install dimensions (platforms and versions)
 */
dashboard.get("/installs/dimensions", async (c) => {
  const query = c.req.query() as TimeRangeQuery;
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const tenantId = scopedTenantId(c, query.tenant_id);

  const platforms = await db`
    SELECT DISTINCT platform, arch
    FROM telemetry_install_daily
    WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY platform, arch
  `;

  const versions = await db`
    SELECT DISTINCT version
    FROM telemetry_install_daily
    WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY version DESC
  `;

  const installTypes = await db`
    SELECT DISTINCT install_type
    FROM telemetry_install_daily
    WHERE bucket >= ${startTime} AND bucket < ${endTime}
            ${tenantId ? db`AND tenant_id = ${tenantId}` : db``}
    ORDER BY install_type
  `;

  // Map platform+arch to friendly names
  const platformOptions = platforms.map((p) => {
    let label = p.platform;
    if (p.platform === "win32" && p.arch === "x64") {
      label = "Windows X64";
    } else if (p.platform === "win32" && p.arch === "x86") {
      label = "Windows X86";
    } else if (p.platform === "darwin" && p.arch === "x64") {
      label = "macOS Intel";
    } else if (p.platform === "darwin" && p.arch === "arm64") {
      label = "macOS ARM";
    } else {
      label = `${p.platform} ${p.arch}`;
    }
    return {
      platform: p.platform,
      arch: p.arch,
      label,
      value: `${p.platform}|${p.arch}`,
    };
  });

  return c.json({
    success: true,
    data: {
      platforms: platformOptions,
      versions: versions.map((v) => v.version),
      install_types: installTypes.map((t) => t.install_type),
    },
  });
});

export default dashboard;
