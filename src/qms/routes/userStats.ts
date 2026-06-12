/**
 * User Statistics API routes
 * Provides user-level aggregation and leaderboard endpoints
 *
 * Query strategy:
 * - Historical data (before today): Query from daily aggregation tables
 * - Today's data: Query from raw tables for real-time visibility
 * - Mixed: Combine both sources
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { jwtAuth, requireRole } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { getTenantScope } from "../utils/tenant.js";
import type {
  UserConversationStats,
  UserTurnStats,
  UserStepStats,
  UserLeaderboardEntry,
  UserStatsQuery,
  UserTurnStatsQuery,
  UserStepStatsQuery,
  UserLeaderboardQuery,
} from "../types/telemetry.js";

const userStats = new Hono();

// All user stats endpoints require JWT authentication
userStats.use("/*", jwtAuth);
userStats.use("/*", requireRole("viewer", "operator", "admin"));

/**
 * Get today's date boundary (start of today in UTC)
 */
function getTodayBoundary(): { todayStart: Date; todayEnd: Date } {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const todayStart = new Date(todayStr + "T00:00:00.000Z");
  const todayEnd = now;
  return { todayStart, todayEnd };
}

type DbRow = Record<string, unknown>;
type UserDimension = {
  user_id: string;
  org_id?: string;
  tenant_id?: string;
  login_mode?: string;
  step_type?: string;
};
type LeaderboardRow = UserDimension & {
  user_nickname?: string;
  user_phone?: string;
  value: number;
};
type TenantScopedQuery = { tenant_id?: string };

function withTenantScope<T extends TenantScopedQuery>(c: Context, query: T): T {
  const tenantId = getTenantScope(c, query.tenant_id).tenantId;
  return {
    ...query,
    tenant_id: tenantId || undefined,
  };
}

function toNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function userIdentityColumn() {
  return db`COALESCE(NULLIF(user_id, ''), NULLIF(user_phone, ''))`;
}

function userIdentityFilter(userId?: string) {
  return userId ? db`AND ${userIdentityColumn()} = ${userId}` : db``;
}

function hasUserIdentityFilter() {
  return db`AND ${userIdentityColumn()} IS NOT NULL`;
}

function userDimensionKey(row: UserDimension): string {
  return JSON.stringify([
    row.user_id,
    row.org_id ?? null,
    row.tenant_id ?? null,
    row.login_mode ?? null,
    row.step_type ?? null,
  ]);
}

function normalizeConversationStats(row: DbRow): UserConversationStats {
  return {
    user_id: String(row.user_id),
    org_id: optionalString(row.org_id),
    tenant_id: optionalString(row.tenant_id),
    login_mode: optionalString(row.login_mode),
    user_nickname: optionalString(row.user_nickname),
    user_phone: optionalString(row.user_phone),
    conversation_count: toNumber(row.conversation_count),
    total_tokens: toNumber(row.total_tokens),
    input_tokens: toNumber(row.input_tokens),
    output_tokens: toNumber(row.output_tokens),
    avg_duration_ms: toNumber(row.avg_duration_ms),
    success_count: toNumber(row.success_count),
    success_rate: toNumber(row.success_rate),
    error_count: toNumber(row.error_count),
  };
}

function normalizeTurnStats(row: DbRow): UserTurnStats {
  return {
    user_id: String(row.user_id),
    org_id: optionalString(row.org_id),
    tenant_id: optionalString(row.tenant_id),
    login_mode: optionalString(row.login_mode),
    user_nickname: optionalString(row.user_nickname),
    user_phone: optionalString(row.user_phone),
    turn_count: toNumber(row.turn_count),
    total_tokens: toNumber(row.total_tokens),
    avg_tokens_per_turn: toNumber(row.avg_tokens_per_turn),
    success_rate: toNumber(row.success_rate),
  };
}

function normalizeStepStats(row: DbRow): UserStepStats {
  return {
    user_id: String(row.user_id),
    org_id: optionalString(row.org_id),
    tenant_id: optionalString(row.tenant_id),
    login_mode: optionalString(row.login_mode),
    user_nickname: optionalString(row.user_nickname),
    user_phone: optionalString(row.user_phone),
    step_type: String(row.step_type),
    step_count: toNumber(row.step_count),
    success_count: toNumber(row.success_count),
    error_count: toNumber(row.error_count),
    success_rate: toNumber(row.success_rate),
    avg_duration_ms: toNumber(row.avg_duration_ms),
  };
}

function normalizeLeaderboardRow(row: DbRow): LeaderboardRow {
  return {
    user_id: String(row.user_id),
    org_id: optionalString(row.org_id),
    tenant_id: optionalString(row.tenant_id),
    login_mode: optionalString(row.login_mode),
    user_nickname: optionalString(row.user_nickname),
    user_phone: optionalString(row.user_phone),
    value: toNumber(row.value),
  };
}

/**
 * Get user conversation statistics
 * Uses daily aggregation tables for historical data, raw tables for today
 */
userStats.get("/conversations", async (c) => {
  const query = withTenantScope(c, c.req.query() as UserStatsQuery);
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const order = query.order || "desc";
  const limit = Math.min(Number(query.limit) || 50, 100);

  const { todayStart, todayEnd } = getTodayBoundary();

  try {
    // Determine if we need to query daily tables (historical data)
    const needHistorical = startTime < todayStart;
    // Determine if we need to query raw tables (today's data)
    const needToday = endTime > todayStart;

    let combinedData: UserConversationStats[] = [];

    if (needHistorical && !needToday) {
      // Pure historical query - use daily aggregation tables
      const historicalEnd = endTime < todayStart ? endTime : new Date(todayStart.getTime() - 1);
      const dailyData = await db`
        WITH conversation_stats AS (
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(conversation_count)::INTEGER as conversation_count,
            SUM(total_tokens)::BIGINT as conversation_total_tokens,
            SUM(input_tokens)::BIGINT as conversation_input_tokens,
            SUM(output_tokens)::BIGINT as conversation_output_tokens,
            ROUND(AVG(avg_duration_ms))::INTEGER as avg_duration_ms,
            SUM(success_count)::INTEGER as success_count,
            COALESCE(ROUND((SUM(success_count)::DECIMAL / NULLIF(SUM(success_count) + SUM(error_count), 0)) * 100), 100)::INTEGER as success_rate,
            SUM(error_count)::INTEGER as error_count
          FROM telemetry_user_conversations_daily
          WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        ),
        turn_token_stats AS (
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
            COALESCE(SUM(total_input_tokens), 0)::BIGINT as input_tokens,
            COALESCE(SUM(total_output_tokens), 0)::BIGINT as output_tokens
          FROM telemetry_user_turns_daily
          WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        )
        SELECT
          c.user_id,
          c.org_id,
          c.tenant_id,
          c.login_mode,
          c.user_nickname,
          c.user_phone,
          c.conversation_count,
          CASE WHEN t.user_id IS NULL THEN c.conversation_total_tokens ELSE t.total_tokens END::BIGINT as total_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_input_tokens ELSE t.input_tokens END::BIGINT as input_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_output_tokens ELSE t.output_tokens END::BIGINT as output_tokens,
          c.avg_duration_ms,
          c.success_count,
          c.success_rate,
          c.error_count
        FROM conversation_stats c
        LEFT JOIN turn_token_stats t
          ON c.user_id = t.user_id
          AND c.org_id IS NOT DISTINCT FROM t.org_id
          AND c.tenant_id IS NOT DISTINCT FROM t.tenant_id
          AND c.login_mode IS NOT DISTINCT FROM t.login_mode
        ORDER BY conversation_count ${order === "asc" ? db`ASC` : db`DESC`}
        LIMIT ${limit}
      `;
      combinedData = Array.from(dailyData, (row) => normalizeConversationStats(row as DbRow));
    } else if (!needHistorical && needToday) {
      // Pure today query - use raw tables
      const rawStart = startTime > todayStart ? startTime : todayStart;
      const rawData = await db`
        WITH conversation_stats AS (
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COUNT(*)::INTEGER as conversation_count,
            COALESCE(SUM(tokens_used), 0)::BIGINT as conversation_total_tokens,
            COALESCE(SUM(input_tokens), 0)::BIGINT as conversation_input_tokens,
            COALESCE(SUM(output_tokens), 0)::BIGINT as conversation_output_tokens,
            AVG(duration_ms)::INTEGER as avg_duration_ms,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
            COALESCE(ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(
              SUM(CASE WHEN status IN ('success', 'error') THEN 1 ELSE 0 END),
              0
            )) * 100), 100)::INTEGER as success_rate,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error_count
          FROM telemetry_conversations
          WHERE created_at >= ${rawStart} AND created_at < ${endTime}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
        ),
        turn_token_stats AS (
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
            COALESCE(SUM(input_tokens), 0)::BIGINT as input_tokens,
            COALESCE(SUM(output_tokens), 0)::BIGINT as output_tokens
          FROM telemetry_turns
          WHERE created_at >= ${rawStart} AND created_at < ${endTime}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
        )
        SELECT
          c.user_id,
          c.org_id,
          c.tenant_id,
          c.login_mode,
          c.user_nickname,
          c.user_phone,
          c.conversation_count,
          CASE WHEN t.user_id IS NULL THEN c.conversation_total_tokens ELSE t.total_tokens END::BIGINT as total_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_input_tokens ELSE t.input_tokens END::BIGINT as input_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_output_tokens ELSE t.output_tokens END::BIGINT as output_tokens,
          c.avg_duration_ms,
          c.success_count,
          c.success_rate,
          c.error_count
        FROM conversation_stats c
        LEFT JOIN turn_token_stats t
          ON c.user_id = t.user_id
          AND c.org_id IS NOT DISTINCT FROM t.org_id
          AND c.tenant_id IS NOT DISTINCT FROM t.tenant_id
          AND c.login_mode IS NOT DISTINCT FROM t.login_mode
        ORDER BY conversation_count ${order === "asc" ? db`ASC` : db`DESC`}
        LIMIT ${limit}
      `;
      combinedData = Array.from(rawData, (row) => normalizeConversationStats(row as DbRow));
    } else if (needHistorical && needToday) {
      // Mixed query - combine daily aggregation + today's raw data
      // Query daily tables for historical data
      const dailyData = await db`
        WITH conversation_stats AS (
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(conversation_count)::INTEGER as conversation_count,
            SUM(total_tokens)::BIGINT as conversation_total_tokens,
            SUM(input_tokens)::BIGINT as conversation_input_tokens,
            SUM(output_tokens)::BIGINT as conversation_output_tokens,
            ROUND(AVG(avg_duration_ms))::INTEGER as avg_duration_ms,
            SUM(success_count)::INTEGER as success_count,
            COALESCE(ROUND((SUM(success_count)::DECIMAL / NULLIF(SUM(success_count) + SUM(error_count), 0)) * 100), 100)::INTEGER as success_rate,
            SUM(error_count)::INTEGER as error_count
          FROM telemetry_user_conversations_daily
          WHERE bucket >= ${startTime} AND bucket < ${todayStart}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        ),
        turn_token_stats AS (
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
            COALESCE(SUM(total_input_tokens), 0)::BIGINT as input_tokens,
            COALESCE(SUM(total_output_tokens), 0)::BIGINT as output_tokens
          FROM telemetry_user_turns_daily
          WHERE bucket >= ${startTime} AND bucket < ${todayStart}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        )
        SELECT
          c.user_id,
          c.org_id,
          c.tenant_id,
          c.login_mode,
          c.user_nickname,
          c.user_phone,
          c.conversation_count,
          CASE WHEN t.user_id IS NULL THEN c.conversation_total_tokens ELSE t.total_tokens END::BIGINT as total_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_input_tokens ELSE t.input_tokens END::BIGINT as input_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_output_tokens ELSE t.output_tokens END::BIGINT as output_tokens,
          c.avg_duration_ms,
          c.success_count,
          c.success_rate,
          c.error_count
        FROM conversation_stats c
        LEFT JOIN turn_token_stats t
          ON c.user_id = t.user_id
          AND c.org_id IS NOT DISTINCT FROM t.org_id
          AND c.tenant_id IS NOT DISTINCT FROM t.tenant_id
          AND c.login_mode IS NOT DISTINCT FROM t.login_mode
      `;

      // Query raw tables for today's data
      const todayData = await db`
        WITH conversation_stats AS (
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COUNT(*)::INTEGER as conversation_count,
            COALESCE(SUM(tokens_used), 0)::BIGINT as conversation_total_tokens,
            COALESCE(SUM(input_tokens), 0)::BIGINT as conversation_input_tokens,
            COALESCE(SUM(output_tokens), 0)::BIGINT as conversation_output_tokens,
            AVG(duration_ms)::INTEGER as avg_duration_ms,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
            COALESCE(ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(
              SUM(CASE WHEN status IN ('success', 'error') THEN 1 ELSE 0 END),
              0
            )) * 100), 100)::INTEGER as success_rate,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error_count
          FROM telemetry_conversations
          WHERE created_at >= ${todayStart} AND created_at < ${endTime}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
        ),
        turn_token_stats AS (
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
            COALESCE(SUM(input_tokens), 0)::BIGINT as input_tokens,
            COALESCE(SUM(output_tokens), 0)::BIGINT as output_tokens
          FROM telemetry_turns
          WHERE created_at >= ${todayStart} AND created_at < ${endTime}
            ${query.org_id ? db`AND org_id = ${query.org_id}` : db``}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
        )
        SELECT
          c.user_id,
          c.org_id,
          c.tenant_id,
          c.login_mode,
          c.user_nickname,
          c.user_phone,
          c.conversation_count,
          CASE WHEN t.user_id IS NULL THEN c.conversation_total_tokens ELSE t.total_tokens END::BIGINT as total_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_input_tokens ELSE t.input_tokens END::BIGINT as input_tokens,
          CASE WHEN t.user_id IS NULL THEN c.conversation_output_tokens ELSE t.output_tokens END::BIGINT as output_tokens,
          c.avg_duration_ms,
          c.success_count,
          c.success_rate,
          c.error_count
        FROM conversation_stats c
        LEFT JOIN turn_token_stats t
          ON c.user_id = t.user_id
          AND c.org_id IS NOT DISTINCT FROM t.org_id
          AND c.tenant_id IS NOT DISTINCT FROM t.tenant_id
          AND c.login_mode IS NOT DISTINCT FROM t.login_mode
      `;

      // Merge results
      const dailyMap = new Map<string, UserConversationStats>();
      for (const row of Array.from(dailyData, (item) => normalizeConversationStats(item as DbRow))) {
        const key = userDimensionKey(row);
        dailyMap.set(key, row);
      }

      for (const today of Array.from(todayData, (item) => normalizeConversationStats(item as DbRow))) {
        const key = userDimensionKey(today);
        const existing = dailyMap.get(key);
        if (existing) {
          existing.conversation_count += today.conversation_count;
          existing.total_tokens += today.total_tokens;
          existing.input_tokens += today.input_tokens;
          existing.output_tokens += today.output_tokens;
          existing.success_count += today.success_count;
          existing.error_count += today.error_count;
          const completedCount = existing.success_count + existing.error_count;
          existing.success_rate = completedCount === 0 ? 100 : Math.round((existing.success_count / completedCount) * 100);
          existing.avg_duration_ms = Math.round(
            (existing.avg_duration_ms * (existing.conversation_count - today.conversation_count) +
              today.avg_duration_ms * today.conversation_count) / existing.conversation_count
          );
        } else {
          dailyMap.set(key, today);
        }
      }

      combinedData = Array.from(dailyMap.values());
      // Sort after merging
      combinedData.sort((a, b) => order === "asc" ? a.conversation_count - b.conversation_count : b.conversation_count - a.conversation_count);
      combinedData = combinedData.slice(0, limit);
    }

    return c.json({
      success: true,
      data: combinedData,
    });
  } catch (error) {
    logger.error("[UserStats] Failed to get conversation stats:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUERY_ERROR", message: "Failed to query user conversation stats" },
      },
      500
    );
  }
});

/**
 * Get user turn statistics
 * Uses daily aggregation tables for historical data, raw tables for today
 */
userStats.get("/turns", async (c) => {
  const query = withTenantScope(c, c.req.query() as UserTurnStatsQuery);
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const order = query.order || "desc";
  const limit = Math.min(Number(query.limit) || 50, 100);

  const { todayStart, todayEnd } = getTodayBoundary();

  try {
    const needHistorical = startTime < todayStart;
    const needToday = endTime > todayStart;

    let combinedData: UserTurnStats[] = [];

    if (needHistorical && !needToday) {
      // Pure historical query
      const historicalEnd = endTime < todayStart ? endTime : new Date(todayStart.getTime() - 1);
      const dailyData = await db`
        SELECT
          user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          SUM(turn_count)::INTEGER as turn_count,
          SUM(total_tokens)::BIGINT as total_tokens,
          ROUND(SUM(total_tokens)::DECIMAL / NULLIF(SUM(turn_count), 0))::INTEGER as avg_tokens_per_turn,
          ROUND((SUM(success_count)::DECIMAL / SUM(turn_count)) * 100) as success_rate
        FROM telemetry_user_turns_daily
        WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
          ${query.user_id ? db`AND user_id = ${query.user_id}` : db``}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          AND user_id IS NOT NULL
        GROUP BY user_id, org_id, tenant_id, login_mode
        ORDER BY turn_count ${order === "asc" ? db`ASC` : db`DESC`}
        LIMIT ${limit}
      `;
      combinedData = Array.from(dailyData, (row) => normalizeTurnStats(row as DbRow));
    } else if (!needHistorical && needToday) {
      // Pure today query
      const rawStart = startTime > todayStart ? startTime : todayStart;
      const rawData = await db`
        SELECT
          ${userIdentityColumn()} as user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          COUNT(*)::INTEGER as turn_count,
          COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
          ROUND(AVG(COALESCE(total_tokens, 0)))::INTEGER as avg_tokens_per_turn,
          ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*)) * 100) as success_rate
        FROM telemetry_turns
        WHERE created_at >= ${rawStart} AND created_at < ${endTime}
          ${userIdentityFilter(query.user_id)}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          ${hasUserIdentityFilter()}
        GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
        ORDER BY turn_count ${order === "asc" ? db`ASC` : db`DESC`}
        LIMIT ${limit}
      `;
      combinedData = Array.from(rawData, (row) => normalizeTurnStats(row as DbRow));
    } else if (needHistorical && needToday) {
      // Mixed query
      const dailyData = await db`
        SELECT
          user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          SUM(turn_count)::INTEGER as turn_count,
          SUM(total_tokens)::BIGINT as total_tokens,
          ROUND(SUM(total_tokens)::DECIMAL / NULLIF(SUM(turn_count), 0))::INTEGER as avg_tokens_per_turn,
          ROUND((SUM(success_count)::DECIMAL / SUM(turn_count)) * 100) as success_rate
        FROM telemetry_user_turns_daily
        WHERE bucket >= ${startTime} AND bucket < ${todayStart}
          ${query.user_id ? db`AND user_id = ${query.user_id}` : db``}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          AND user_id IS NOT NULL
        GROUP BY user_id, org_id, tenant_id, login_mode
      `;

      const todayData = await db`
        SELECT
          ${userIdentityColumn()} as user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          COUNT(*)::INTEGER as turn_count,
          COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
          ROUND(AVG(COALESCE(total_tokens, 0)))::INTEGER as avg_tokens_per_turn,
          ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*)) * 100) as success_rate
        FROM telemetry_turns
        WHERE created_at >= ${todayStart} AND created_at < ${endTime}
          ${userIdentityFilter(query.user_id)}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          ${hasUserIdentityFilter()}
        GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
      `;

      // Merge
      const mergedMap = new Map<string, UserTurnStats>();
      for (const row of Array.from(dailyData, (item) => normalizeTurnStats(item as DbRow))) {
        const key = userDimensionKey(row);
        mergedMap.set(key, row);
      }

      for (const today of Array.from(todayData, (item) => normalizeTurnStats(item as DbRow))) {
        const key = userDimensionKey(today);
        const existing = mergedMap.get(key);
        if (existing) {
          existing.turn_count += today.turn_count;
          existing.total_tokens += today.total_tokens;
          existing.avg_tokens_per_turn = Math.round(existing.total_tokens / existing.turn_count);
        } else {
          mergedMap.set(key, today);
        }
      }

      combinedData = Array.from(mergedMap.values());
      combinedData.sort((a, b) => order === "asc" ? a.turn_count - b.turn_count : b.turn_count - a.turn_count);
      combinedData = combinedData.slice(0, limit);
    }

    return c.json({
      success: true,
      data: combinedData,
    });
  } catch (error) {
    logger.error("[UserStats] Failed to get turn stats:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUERY_ERROR", message: "Failed to query user turn stats" },
      },
      500
    );
  }
});

/**
 * Get user step statistics
 * Uses daily aggregation tables for historical data, raw tables for today
 */
userStats.get("/steps", async (c) => {
  const query = withTenantScope(c, c.req.query() as UserStepStatsQuery);
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const order = query.order || "desc";
  const limit = Math.min(Number(query.limit) || 50, 100);

  const { todayStart, todayEnd } = getTodayBoundary();

  try {
    const needHistorical = startTime < todayStart;
    const needToday = endTime > todayStart;

    let combinedData: UserStepStats[] = [];

    if (needHistorical && !needToday) {
      const historicalEnd = endTime < todayStart ? endTime : new Date(todayStart.getTime() - 1);
      const dailyData = await db`
        SELECT
          user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          step_type,
          SUM(step_count)::INTEGER as step_count,
          SUM(success_count)::INTEGER as success_count,
          SUM(error_count)::INTEGER as error_count,
          ROUND((SUM(success_count)::DECIMAL / SUM(step_count)) * 100) as success_rate,
          ROUND(AVG(avg_duration_ms))::INTEGER as avg_duration_ms
        FROM telemetry_user_steps_daily
        WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
          ${query.user_id ? db`AND user_id = ${query.user_id}` : db``}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.step_type ? db`AND step_type = ${query.step_type}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          AND user_id IS NOT NULL
        GROUP BY user_id, org_id, tenant_id, login_mode, step_type
        ORDER BY step_count ${order === "asc" ? db`ASC` : db`DESC`}
        LIMIT ${limit}
      `;
      combinedData = Array.from(dailyData, (row) => normalizeStepStats(row as DbRow));
    } else if (!needHistorical && needToday) {
      const rawStart = startTime > todayStart ? startTime : todayStart;
      const rawData = await db`
        SELECT
          ${userIdentityColumn()} as user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          step_type,
          COUNT(*)::INTEGER as step_count,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error_count,
          ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*)) * 100) as success_rate,
          AVG(COALESCE(duration_ms, 0))::INTEGER as avg_duration_ms
        FROM telemetry_steps
        WHERE created_at >= ${rawStart} AND created_at < ${endTime}
          ${userIdentityFilter(query.user_id)}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.step_type ? db`AND step_type = ${query.step_type}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          ${hasUserIdentityFilter()}
        GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode, step_type
        ORDER BY step_count ${order === "asc" ? db`ASC` : db`DESC`}
        LIMIT ${limit}
      `;
      combinedData = Array.from(rawData, (row) => normalizeStepStats(row as DbRow));
    } else if (needHistorical && needToday) {
      const dailyData = await db`
        SELECT
          user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          step_type,
          SUM(step_count)::INTEGER as step_count,
          SUM(success_count)::INTEGER as success_count,
          SUM(error_count)::INTEGER as error_count,
          ROUND((SUM(success_count)::DECIMAL / SUM(step_count)) * 100) as success_rate,
          ROUND(AVG(avg_duration_ms))::INTEGER as avg_duration_ms
        FROM telemetry_user_steps_daily
        WHERE bucket >= ${startTime} AND bucket < ${todayStart}
          ${query.user_id ? db`AND user_id = ${query.user_id}` : db``}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.step_type ? db`AND step_type = ${query.step_type}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          AND user_id IS NOT NULL
        GROUP BY user_id, org_id, tenant_id, login_mode, step_type
      `;

      const todayData = await db`
        SELECT
          ${userIdentityColumn()} as user_id,
          org_id,
          tenant_id,
          login_mode,
          MAX(user_nickname) as user_nickname,
          MAX(user_phone) as user_phone,
          step_type,
          COUNT(*)::INTEGER as step_count,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::INTEGER as error_count,
          ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*)) * 100) as success_rate,
          AVG(COALESCE(duration_ms, 0))::INTEGER as avg_duration_ms
        FROM telemetry_steps
        WHERE created_at >= ${todayStart} AND created_at < ${endTime}
          ${userIdentityFilter(query.user_id)}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
          ${query.step_type ? db`AND step_type = ${query.step_type}` : db``}
          ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
          ${hasUserIdentityFilter()}
        GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode, step_type
      `;

      // Merge
      const mergedMap = new Map<string, UserStepStats>();
      for (const row of Array.from(dailyData, (item) => normalizeStepStats(item as DbRow))) {
        const key = userDimensionKey(row);
        mergedMap.set(key, row);
      }

      for (const today of Array.from(todayData, (item) => normalizeStepStats(item as DbRow))) {
        const key = userDimensionKey(today);
        const existing = mergedMap.get(key);
        if (existing) {
          existing.step_count += today.step_count;
          existing.success_count += today.success_count;
          existing.error_count += today.error_count;
          existing.success_rate = Math.round((existing.success_count / existing.step_count) * 100);
        } else {
          mergedMap.set(key, today);
        }
      }

      combinedData = Array.from(mergedMap.values());
      combinedData.sort((a, b) => order === "asc" ? a.step_count - b.step_count : b.step_count - a.step_count);
      combinedData = combinedData.slice(0, limit);
    }

    return c.json({
      success: true,
      data: combinedData,
    });
  } catch (error) {
    logger.error("[UserStats] Failed to get step stats:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUERY_ERROR", message: "Failed to query user step stats" },
      },
      500
    );
  }
});

/**
 * Get user leaderboard
 * Rankings by conversations, turns, steps, or tokens
 */
userStats.get("/leaderboard/:type", async (c) => {
  const type = c.req.param("type") as "conversations" | "turns" | "steps" | "tokens";
  const query = withTenantScope(c, c.req.query() as UserLeaderboardQuery);
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const order = query.order || "desc";
  const limit = Math.min(Number(query.limit) || 10, 50);

  // Validate type
  if (!["conversations", "turns", "steps", "tokens"].includes(type)) {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_TYPE", message: "Invalid leaderboard type. Must be conversations, turns, steps, or tokens" },
      },
      400
    );
  }

  const { todayStart, todayEnd } = getTodayBoundary();

  try {
    const needHistorical = startTime < todayStart;
    const needToday = endTime > todayStart;

    // Build query based on type and time range
    // For tokens, we use turns tables (total_tokens field)
    const tableName = type === "conversations"
      ? "telemetry_user_conversations_daily"
      : type === "turns" || type === "tokens"
        ? "telemetry_user_turns_daily"
        : "telemetry_user_steps_daily";

    const rawTableName = type === "conversations"
      ? "telemetry_conversations"
      : type === "turns" || type === "tokens"
        ? "telemetry_turns"
        : "telemetry_steps";

    let rows: LeaderboardRow[] = [];

    if (needHistorical && !needToday) {
      // Pure historical
      const historicalEnd = endTime < todayStart ? endTime : new Date(todayStart.getTime() - 1);

      if (type === "conversations") {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(conversation_count)::INTEGER as value
          FROM telemetry_user_conversations_daily
          WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
          ORDER BY value ${order === "asc" ? db`ASC` : db`DESC`}
          LIMIT ${limit}
        `;
        rows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      } else if (type === "turns") {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(turn_count)::INTEGER as value
          FROM telemetry_user_turns_daily
          WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
          ORDER BY value ${order === "asc" ? db`ASC` : db`DESC`}
          LIMIT ${limit}
        `;
        rows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      } else if (type === "tokens") {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COALESCE(SUM(total_tokens), 0)::BIGINT as value
          FROM telemetry_user_turns_daily
          WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
          ORDER BY value ${order === "asc" ? db`ASC` : db`DESC`}
          LIMIT ${limit}
        `;
        rows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      } else {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(step_count)::INTEGER as value
          FROM telemetry_user_steps_daily
          WHERE bucket >= ${startTime} AND bucket <= ${historicalEnd}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
          ORDER BY value ${order === "asc" ? db`ASC` : db`DESC`}
          LIMIT ${limit}
        `;
        rows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      }
    } else if (!needHistorical && needToday) {
      // Pure today
      const rawStart = startTime > todayStart ? startTime : todayStart;

      if (type === "tokens") {
        // For tokens, sum total_tokens instead of counting rows
        const data = await db`
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COALESCE(SUM(total_tokens), 0)::BIGINT as value
          FROM telemetry_turns
          WHERE created_at >= ${rawStart} AND created_at < ${endTime}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
          ORDER BY value ${order === "asc" ? db`ASC` : db`DESC`}
          LIMIT ${limit}
        `;
        rows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      } else {
        const data = await db`
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COUNT(*)::INTEGER as value
          FROM ${db(rawTableName)}
          WHERE created_at >= ${rawStart} AND created_at < ${endTime}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
          ORDER BY value ${order === "asc" ? db`ASC` : db`DESC`}
          LIMIT ${limit}
        `;
        rows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      }
    } else if (needHistorical && needToday) {
      // Mixed - need to combine and sort
      let historicalRows: LeaderboardRow[] = [];
      let todayRows: LeaderboardRow[] = [];

      // Query historical
      if (type === "conversations") {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(conversation_count)::INTEGER as value
          FROM telemetry_user_conversations_daily
          WHERE bucket >= ${startTime} AND bucket < ${todayStart}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        `;
        historicalRows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      } else if (type === "turns") {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(turn_count)::INTEGER as value
          FROM telemetry_user_turns_daily
          WHERE bucket >= ${startTime} AND bucket < ${todayStart}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        `;
        historicalRows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      } else if (type === "tokens") {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COALESCE(SUM(total_tokens), 0)::BIGINT as value
          FROM telemetry_user_turns_daily
          WHERE bucket >= ${startTime} AND bucket < ${todayStart}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        `;
        historicalRows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      } else {
        const data = await db`
          SELECT
            user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            SUM(step_count)::INTEGER as value
          FROM telemetry_user_steps_daily
          WHERE bucket >= ${startTime} AND bucket < ${todayStart}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            AND user_id IS NOT NULL
          GROUP BY user_id, org_id, tenant_id, login_mode
        `;
        historicalRows = Array.from(data, (row) => normalizeLeaderboardRow(row as DbRow));
      }

      // Query today
      if (type === "tokens") {
        const todayData = await db`
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COALESCE(SUM(total_tokens), 0)::BIGINT as value
          FROM telemetry_turns
          WHERE created_at >= ${todayStart} AND created_at < ${endTime}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
        `;
        todayRows = Array.from(todayData, (row) => normalizeLeaderboardRow(row as DbRow));
      } else {
        const todayData = await db`
          SELECT
            ${userIdentityColumn()} as user_id,
            org_id,
            tenant_id,
            login_mode,
            MAX(user_nickname) as user_nickname,
            MAX(user_phone) as user_phone,
            COUNT(*)::INTEGER as value
          FROM ${db(rawTableName)}
          WHERE created_at >= ${todayStart} AND created_at < ${endTime}
            ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
            ${query.login_mode ? db`AND login_mode = ${query.login_mode}` : db``}
            ${hasUserIdentityFilter()}
          GROUP BY ${userIdentityColumn()}, org_id, tenant_id, login_mode
        `;
        todayRows = Array.from(todayData, (row) => normalizeLeaderboardRow(row as DbRow));
      }

      // Merge
      const mergedMap = new Map<string, LeaderboardRow>();
      for (const row of historicalRows) {
        const key = userDimensionKey(row);
        mergedMap.set(key, row);
      }

      for (const today of todayRows) {
        const key = userDimensionKey(today);
        const existing = mergedMap.get(key);
        if (existing) {
          existing.value += today.value;
        } else {
          mergedMap.set(key, today);
        }
      }

      rows = Array.from(mergedMap.values());
      rows.sort((a, b) => order === "asc" ? a.value - b.value : b.value - a.value);
      rows = rows.slice(0, limit);
    }

    const data: UserLeaderboardEntry[] = rows.map((row, index) => ({
      rank: index + 1,
      user_id: row.user_id,
      org_id: row.org_id,
      tenant_id: row.tenant_id,
      login_mode: row.login_mode,
      user_nickname: row.user_nickname,
      user_phone: row.user_phone,
      value: row.value,
    }));

    return c.json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error("[UserStats] Failed to get leaderboard:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUERY_ERROR", message: "Failed to query leaderboard" },
      },
      500
    );
  }
});

/**
 * Get single user detail statistics
 * Uses raw tables for detailed view (smaller dataset per user)
 */
userStats.get("/users/:userId", async (c) => {
  const userId = c.req.param("userId");
  const query = withTenantScope(c, c.req.query() as TenantScopedQuery & { start_time?: number; end_time?: number });
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    // Get user nickname and phone from any telemetry table
    const userInfo = await db`
      SELECT
        MAX(user_nickname) as user_nickname,
        MAX(user_phone) as user_phone
      FROM telemetry_conversations
      WHERE ${userIdentityColumn()} = ${userId}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
    `;

    // Conversation stats
    const conversationStats = await db`
      WITH conversation_stats AS (
        SELECT
          COUNT(*)::INTEGER as conversation_count,
          COALESCE(SUM(tokens_used), 0)::BIGINT as conversation_total_tokens,
          AVG(duration_ms)::INTEGER as avg_duration_ms,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::INTEGER as success_count,
          COALESCE(ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(
            SUM(CASE WHEN status IN ('success', 'error') THEN 1 ELSE 0 END),
            0
          )) * 100), 100)::INTEGER as success_rate
        FROM telemetry_conversations
        WHERE created_at >= ${startTime} AND created_at < ${endTime}
          ${userIdentityFilter(userId)}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
      ),
      turn_token_stats AS (
        SELECT COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens
        FROM telemetry_turns
        WHERE created_at >= ${startTime} AND created_at < ${endTime}
          ${userIdentityFilter(userId)}
          ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
      )
      SELECT
        c.conversation_count,
        CASE WHEN t.total_tokens = 0 THEN c.conversation_total_tokens ELSE t.total_tokens END::BIGINT as total_tokens,
        c.avg_duration_ms,
        c.success_count,
        c.success_rate
      FROM conversation_stats c
      CROSS JOIN turn_token_stats t
    `;

    // Turn stats
    const turnStats = await db`
      SELECT
        COUNT(*)::INTEGER as turn_count,
        COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens,
        ROUND(AVG(COALESCE(total_tokens, 0)))::INTEGER as avg_tokens_per_turn
      FROM telemetry_turns
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${userIdentityFilter(userId)}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
    `;

    // Step stats by type
    const stepStats = await db`
      SELECT
        step_type,
        COUNT(*)::INTEGER as count,
        ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*)) * 100) as success_rate
      FROM telemetry_steps
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${userIdentityFilter(userId)}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
      GROUP BY step_type
    `;

    // Model usage
    const modelUsage = await db`
      SELECT
        model_id,
        COUNT(*)::INTEGER as count
      FROM telemetry_turns
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${userIdentityFilter(userId)}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
      GROUP BY model_id
      ORDER BY count DESC
      LIMIT 5
    `;

    return c.json({
      success: true,
      data: {
        user_id: userId,
        user_nickname: userInfo[0]?.user_nickname || null,
        user_phone: userInfo[0]?.user_phone || null,
        conversations: conversationStats[0] ? {
          conversation_count: toNumber(conversationStats[0].conversation_count),
          total_tokens: toNumber(conversationStats[0].total_tokens),
          avg_duration_ms: toNumber(conversationStats[0].avg_duration_ms),
          success_count: toNumber(conversationStats[0].success_count),
          success_rate: toNumber(conversationStats[0].success_rate),
        } : {},
        turns: turnStats[0] ? {
          turn_count: toNumber(turnStats[0].turn_count),
          total_tokens: toNumber(turnStats[0].total_tokens),
          avg_tokens_per_turn: toNumber(turnStats[0].avg_tokens_per_turn),
        } : {},
        steps: Array.from(stepStats, (row) => ({
          step_type: String(row.step_type),
          count: toNumber(row.count),
          success_rate: toNumber(row.success_rate),
        })),
        model_usage: Array.from(modelUsage, (row) => ({
          model_id: String(row.model_id),
          count: toNumber(row.count),
        })),
      },
    });
  } catch (error) {
    logger.error("[UserStats] Failed to get user detail:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUERY_ERROR", message: "Failed to query user detail" },
      },
      500
    );
  }
});

/**
 * Get real-time statistics from raw tables
 * Provides current state without aggregation delay
 * Only counts records with a stable user identity to match aggregated user stats
 * Supports time range filtering
 */
userStats.get("/realtime", async (c) => {
  const query = withTenantScope(c, c.req.query() as TenantScopedQuery & { start_time?: number; end_time?: number });
  const endTime = query.end_time ? new Date(Number(query.end_time)) : new Date();
  const startTime = query.start_time ? new Date(Number(query.start_time)) : new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    // Total unique users from conversations table
    const userStats = await db`
      SELECT COUNT(DISTINCT ${userIdentityColumn()})::INTEGER as total_users
      FROM telemetry_conversations
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
        ${hasUserIdentityFilter()}
    `;

    // Total conversations (only with stable user identity)
    const conversationStats = await db`
      SELECT COUNT(*)::BIGINT as total_conversations
      FROM telemetry_conversations
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
        ${hasUserIdentityFilter()}
    `;

    // Total turns (only with stable user identity)
    const turnStats = await db`
      SELECT COUNT(*)::BIGINT as total_turns
      FROM telemetry_turns
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
        ${hasUserIdentityFilter()}
    `;

    // Total steps (only with stable user identity)
    const stepStats = await db`
      SELECT COUNT(*)::BIGINT as total_steps
      FROM telemetry_steps
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
        ${hasUserIdentityFilter()}
    `;

    // Total tokens (only with stable user identity)
    const tokenStats = await db`
      SELECT COALESCE(SUM(total_tokens), 0)::BIGINT as total_tokens
      FROM telemetry_turns
      WHERE created_at >= ${startTime} AND created_at < ${endTime}
        ${query.tenant_id ? db`AND tenant_id = ${query.tenant_id}` : db``}
        ${hasUserIdentityFilter()}
    `;

    return c.json({
      success: true,
      data: {
        total_users: toNumber(userStats[0]?.total_users),
        total_conversations: toNumber(conversationStats[0]?.total_conversations),
        total_turns: toNumber(turnStats[0]?.total_turns),
        total_steps: toNumber(stepStats[0]?.total_steps),
        total_tokens: toNumber(tokenStats[0]?.total_tokens),
      },
    });
  } catch (error) {
    logger.error("[UserStats] Failed to get realtime stats:", error);
    return c.json(
      {
        success: false,
        error: { code: "QUERY_ERROR", message: "Failed to query realtime stats" },
      },
      500
    );
  }
});

export default userStats;
