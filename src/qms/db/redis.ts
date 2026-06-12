/**
 * Redis client for queue and session storage
 */

import Redis from "ioredis";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

let redis: Redis | null = null;

/**
 * Initialize Redis connection
 */
export async function initRedis(): Promise<Redis> {
  if (redis) {
    return redis;
  }

  redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    keyPrefix: config.redis.keyPrefix,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

  redis.on("connect", () => {
    logger.info(`[Redis] Connected to ${config.redis.host}:${config.redis.port}`);
  });

  redis.on("error", (err) => {
    logger.error("[Redis] Connection error:", err.message);
  });

  redis.on("close", () => {
    logger.warn("[Redis] Connection closed");
  });

  // Wait for connection
  await redis.ping();

  return redis;
}

/**
 * Get Redis client (throws if not initialized)
 */
export function getRedis(): Redis {
  if (!redis) {
    throw new Error("Redis not initialized. Call initRedis() first.");
  }
  return redis;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info("[Redis] Connection closed gracefully");
  }
}

/**
 * Check Redis health
 */
export async function checkRedisHealth(): Promise<{ connected: boolean; latency?: number }> {
  if (!redis) {
    return { connected: false };
  }

  try {
    const start = Date.now();
    await redis.ping();
    return { connected: true, latency: Date.now() - start };
  } catch {
    return { connected: false };
  }
}

// Export singleton instance getter
export { redis };
