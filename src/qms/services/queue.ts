/**
 * Queue service for telemetry data
 * Uses Redis List as message queue with batch processing
 */

import { getRedis } from "../db/redis.js";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { PerfRawData, ConversationRawData, TurnRawData, StepRawData, InstallRawData } from "../types/telemetry.js";

// Queue keys
const QUEUE_KEYS = {
  perf: "telemetry:perf",
  conversations: "telemetry:conversations",
  turns: "telemetry:turns",
  steps: "telemetry:steps",
  installs: "telemetry:installs",
};

function textOrNull(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function eventDate(timestamp: number): Date {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Push telemetry data to Redis queue
 */
export async function pushToQueue(
  type: "perf" | "conversations" | "turns" | "steps" | "installs",
  items: PerfRawData[] | ConversationRawData[] | TurnRawData[] | StepRawData[] | InstallRawData[]
): Promise<number> {
  const redis = getRedis();
  const key = QUEUE_KEYS[type];

  // Serialize items as JSON strings
  const serialized = items.map(item => JSON.stringify(item));

  // Push to queue (LPUSH for FIFO with RPOP)
  const result = await redis.lpush(key, ...serialized);

  logger.debug(`[Queue] Pushed ${items.length} items to ${type} queue (total: ${result})`);

  return result;
}

/**
 * Pop items from queue (up to batchSize)
 */
async function popFromQueue(key: string, batchSize: number): Promise<string[]> {
  const redis = getRedis();
  const items: string[] = [];

  for (let i = 0; i < batchSize; i++) {
    const item = await redis.rpop(key);
    if (!item) break;
    items.push(item);
  }

  return items;
}

/**
 * Bulk insert perf data
 */
async function bulkInsertPerf(items: PerfRawData[]): Promise<number> {
  if (items.length === 0) return 0;

  const now = new Date();
  const rows = items.map((item) => ({
    timestamp: eventDate(item.timestamp),
    version: item.version,
    platform: item.platform,
    arch: item.arch || "unknown",
    org_id: textOrNull(item.org_id),
    user_id: textOrNull(item.user_id),
    tenant_id: textOrNull(item.tenant_id),
    login_mode: textOrNull(item.login_mode),
    agent_type: textOrNull(item.agent_type),
    user_nickname: textOrNull(item.user_nickname),
    user_phone: textOrNull(item.user_phone),
    metric: item.metric,
    value_ms: item.value_ms,
    session_id: textOrNull(item.session_id),
    created_at: now,
  }));

  await db`
    INSERT INTO telemetry_perf_raw ${db(rows,
      "timestamp", "version", "platform", "arch", "org_id", "user_id", "tenant_id",
      "login_mode", "agent_type", "user_nickname", "user_phone", "metric",
      "value_ms", "session_id", "created_at"
    )}
  `;
  return items.length;
}

/**
 * Bulk insert conversation data
 */
async function bulkInsertConversations(items: ConversationRawData[]): Promise<number> {
  if (items.length === 0) return 0;

  const now = new Date();
  const rows = items.map((item) => ({
    timestamp: eventDate(item.timestamp),
    version: item.version,
    platform: item.platform,
    arch: item.arch || "unknown",
    org_id: textOrNull(item.org_id),
    user_id: textOrNull(item.user_id),
    tenant_id: textOrNull(item.tenant_id),
    login_mode: textOrNull(item.login_mode),
    agent_type: textOrNull(item.agent_type),
    user_nickname: textOrNull(item.user_nickname),
    user_phone: textOrNull(item.user_phone),
    session_id: item.session_id,
    model_id: item.model_id,
    model_provider: textOrNull(item.model_provider),
    status: item.status,
    duration_ms: item.duration_ms,
    tokens_used: numberOrNull(item.tokens_used),
    input_tokens: numberOrNull(item.input_tokens),
    output_tokens: numberOrNull(item.output_tokens),
    error_code: textOrNull(item.error_code),
    created_at: now,
  }));

  await db`
    INSERT INTO telemetry_conversations ${db(rows,
      "timestamp", "version", "platform", "arch", "org_id", "user_id", "tenant_id",
      "login_mode", "agent_type", "user_nickname", "user_phone", "session_id",
      "model_id", "model_provider", "status", "duration_ms", "tokens_used",
      "input_tokens", "output_tokens", "error_code", "created_at"
    )}
  `;
  return items.length;
}

/**
 * Bulk insert turn data
 */
async function bulkInsertTurns(items: TurnRawData[]): Promise<number> {
  if (items.length === 0) return 0;

  const now = new Date();
  const rows = items.map((item) => ({
    timestamp: eventDate(item.timestamp),
    version: item.version,
    platform: item.platform,
    arch: item.arch || "unknown",
    org_id: textOrNull(item.org_id),
    user_id: textOrNull(item.user_id),
    tenant_id: textOrNull(item.tenant_id),
    login_mode: textOrNull(item.login_mode),
    agent_type: textOrNull(item.agent_type),
    user_nickname: textOrNull(item.user_nickname),
    user_phone: textOrNull(item.user_phone),
    turn_id: item.turn_id,
    session_id: item.session_id,
    model_id: item.model_id,
    model_provider: textOrNull(item.model_provider),
    input_tokens: numberOrNull(item.input_tokens),
    output_tokens: numberOrNull(item.output_tokens),
    total_tokens: numberOrNull(item.total_tokens),
    duration_ms: item.duration_ms,
    status: item.status,
    error_code: textOrNull(item.error_code),
    created_at: now,
  }));

  await db`
    INSERT INTO telemetry_turns ${db(rows,
      "timestamp", "version", "platform", "arch", "org_id", "user_id", "tenant_id",
      "login_mode", "agent_type", "user_nickname", "user_phone", "turn_id",
      "session_id", "model_id", "model_provider", "input_tokens", "output_tokens",
      "total_tokens", "duration_ms", "status", "error_code", "created_at"
    )}
  `;
  return items.length;
}

/**
 * Bulk insert step data
 */
async function bulkInsertSteps(items: StepRawData[]): Promise<number> {
  if (items.length === 0) return 0;

  const now = new Date();
  const rows = items.map((item) => ({
    timestamp: eventDate(item.timestamp),
    version: item.version,
    platform: item.platform,
    arch: item.arch || "unknown",
    org_id: textOrNull(item.org_id),
    user_id: textOrNull(item.user_id),
    tenant_id: textOrNull(item.tenant_id),
    login_mode: textOrNull(item.login_mode),
    agent_type: textOrNull(item.agent_type),
    user_nickname: textOrNull(item.user_nickname),
    user_phone: textOrNull(item.user_phone),
    step_id: item.step_id,
    turn_id: item.turn_id,
    session_id: item.session_id,
    step_type: item.step_type,
    tool_name: textOrNull(item.tool_name),
    tool_kind: textOrNull(item.tool_kind),
    file_path: textOrNull(item.file_path),
    permission_kind: textOrNull(item.permission_kind),
    thinking_tokens: numberOrNull(item.thinking_tokens),
    duration_ms: numberOrNull(item.duration_ms),
    status: item.status,
    created_at: now,
  }));

  await db`
    INSERT INTO telemetry_steps ${db(rows,
      "timestamp", "version", "platform", "arch", "org_id", "user_id", "tenant_id",
      "login_mode", "agent_type", "user_nickname", "user_phone", "step_id",
      "turn_id", "session_id", "step_type", "tool_name", "tool_kind", "file_path",
      "permission_kind", "thinking_tokens", "duration_ms", "status", "created_at"
    )}
  `;
  return items.length;
}

/**
 * Bulk insert install data
 */
async function bulkInsertInstalls(items: InstallRawData[]): Promise<number> {
  if (items.length === 0) return 0;

  const now = new Date();
  const rows = items.map((item) => ({
    install_id: item.install_id,
    timestamp: eventDate(item.timestamp),
    version: item.version,
    platform: item.platform,
    arch: item.arch || "unknown",
    org_id: textOrNull(item.org_id),
    user_id: textOrNull(item.user_id),
    tenant_id: textOrNull(item.tenant_id),
    login_mode: textOrNull(item.login_mode),
    agent_type: textOrNull(item.agent_type),
    user_nickname: textOrNull(item.user_nickname),
    user_phone: textOrNull(item.user_phone),
    status: item.status,
    duration_ms: item.duration_ms,
    install_type: textOrNull(item.install_type),
    previous_version: textOrNull(item.previous_version),
    error_message: textOrNull(item.error_message),
    created_at: now,
  }));

  await db`
    INSERT INTO telemetry_install ${db(rows,
      "install_id", "timestamp", "version", "platform", "arch", "org_id", "user_id",
      "tenant_id", "login_mode", "agent_type", "user_nickname", "user_phone",
      "status", "duration_ms", "install_type", "previous_version", "error_message",
      "created_at"
    )}
  `;
  return items.length;
}

/**
 * Process queue - pop and bulk insert
 */
export async function processQueue(): Promise<void> {
  const batchSize = config.queue.batchSize;
  const redis = getRedis();

  // Check queue depths
  const depths = await Promise.all([
    redis.llen(QUEUE_KEYS.perf),
    redis.llen(QUEUE_KEYS.conversations),
    redis.llen(QUEUE_KEYS.turns),
    redis.llen(QUEUE_KEYS.steps),
    redis.llen(QUEUE_KEYS.installs),
  ]);

  const totalDepth = depths.reduce((a, b) => a + b, 0);

  if (totalDepth === 0) {
    logger.debug("[Queue] No items to process");
    return;
  }

  logger.info(`[Queue] Processing queues: perf=${depths[0]}, conv=${depths[1]}, turns=${depths[2]}, steps=${depths[3]}, installs=${depths[4]}`);

  let processed = 0;

  // Process each queue type
  try {
    // Perf
    const perfItems = await popFromQueue(QUEUE_KEYS.perf, batchSize);
    if (perfItems.length > 0) {
      const data = perfItems.map(s => JSON.parse(s) as PerfRawData);
      processed += await bulkInsertPerf(data);
      logger.debug(`[Queue] Inserted ${perfItems.length} perf items`);
    }

    // Conversations
    const convItems = await popFromQueue(QUEUE_KEYS.conversations, batchSize);
    if (convItems.length > 0) {
      const data = convItems.map(s => JSON.parse(s) as ConversationRawData);
      processed += await bulkInsertConversations(data);
      logger.debug(`[Queue] Inserted ${convItems.length} conversation items`);
    }

    // Turns
    const turnItems = await popFromQueue(QUEUE_KEYS.turns, batchSize);
    if (turnItems.length > 0) {
      const data = turnItems.map(s => JSON.parse(s) as TurnRawData);
      processed += await bulkInsertTurns(data);
      logger.debug(`[Queue] Inserted ${turnItems.length} turn items`);
    }

    // Steps
    const stepItems = await popFromQueue(QUEUE_KEYS.steps, batchSize);
    if (stepItems.length > 0) {
      const data = stepItems.map(s => JSON.parse(s) as StepRawData);
      processed += await bulkInsertSteps(data);
      logger.debug(`[Queue] Inserted ${stepItems.length} step items`);
    }

    // Installs
    const installItems = await popFromQueue(QUEUE_KEYS.installs, batchSize);
    if (installItems.length > 0) {
      const data = installItems.map(s => JSON.parse(s) as InstallRawData);
      processed += await bulkInsertInstalls(data);
      logger.debug(`[Queue] Inserted ${installItems.length} install items`);
    }

    logger.info(`[Queue] Total processed: ${processed} items`);
  } catch (error) {
    logger.error("[Queue] Processing error:", error);
    throw error;
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  perf: number;
  conversations: number;
  turns: number;
  steps: number;
  installs: number;
}> {
  const redis = getRedis();

  const [perf, conversations, turns, steps, installs] = await Promise.all([
    redis.llen(QUEUE_KEYS.perf),
    redis.llen(QUEUE_KEYS.conversations),
    redis.llen(QUEUE_KEYS.turns),
    redis.llen(QUEUE_KEYS.steps),
    redis.llen(QUEUE_KEYS.installs),
  ]);

  return { perf, conversations, turns, steps, installs };
}
