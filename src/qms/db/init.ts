/**
 * Database initialization
 */

import { getDb, initDbConnection, createDbConnection } from "./index.js";
import { initRedis, checkRedisHealth } from "./redis.js";
import { initSchema, initCrashSchema } from "./schema.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type postgres from "postgres";

/**
 * Check if database exists
 */
async function databaseExists(client: postgres.Sql, dbName: string): Promise<boolean> {
  const result = await client`
    SELECT 1 FROM pg_database WHERE datname = ${dbName}
  `;
  return result.length > 0;
}

/**
 * Create database if it doesn't exist
 */
async function createDatabaseIfNotExists(): Promise<boolean> {
  const dbName = config.database.name;

  // Connect to default 'postgres' database to check/create our database
  const systemDb = createDbConnection("postgres");

  try {
    const exists = await databaseExists(systemDb, dbName);

    if (!exists) {
      logger.info(`[DB] Database "${dbName}" does not exist, creating...`);
      await systemDb.unsafe(`CREATE DATABASE "${dbName}"`);
      logger.info(`[DB] Database "${dbName}" created successfully`);
      return true;
    }

    logger.info(`[DB] Database "${dbName}" already exists`);
    return false;
  } finally {
    await systemDb.end();
  }
}

/**
 * Check database connection health
 */
async function checkDatabaseHealth(): Promise<boolean> {
  const db = getDb();
  try {
    const result = await db`SELECT 1 as health`;
    return result.length > 0 && result[0]?.health === 1;
  } catch (error) {
    logger.error("[DB] Health check failed:", error);
    return false;
  }
}

/**
 * Initialize database and Redis
 */
export async function initDatabase(): Promise<void> {
  logger.info("[DB] Initializing database...");

  // Create database if it doesn't exist
  await createDatabaseIfNotExists();

  // Initialize main database connection
  initDbConnection();

  // Check PostgreSQL connection
  const pgHealthy = await checkDatabaseHealth();
  if (!pgHealthy) {
    throw new Error("[DB] PostgreSQL connection failed");
  }

  logger.info("[DB] PostgreSQL connection established");

  // Initialize Redis
  try {
    await initRedis();
    const redisHealth = await checkRedisHealth();
    if (!redisHealth.connected) {
      throw new Error("[Redis] Connection failed");
    }
    logger.info(`[Redis] Connected (latency: ${redisHealth.latency}ms)`);
  } catch (error) {
    logger.error("[Redis] Initialization failed:", error);
    throw error;
  }

  // Enable TimescaleDB extension if available
  try {
    const db = getDb();
    await db`CREATE EXTENSION IF NOT EXISTS timescaledb`;
    logger.info("[DB] TimescaleDB extension enabled");
  } catch (error) {
    logger.warn("[DB] TimescaleDB extension not available, using standard PostgreSQL");
  }

  // Create base schema
  await initSchema();

  // Create crash schema
  await initCrashSchema();

  logger.info("[DB] Database initialized successfully");
}
