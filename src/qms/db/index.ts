/**
 * Database connection using postgres.js
 * PostgreSQL + TimescaleDB for production-grade QMS
 */

import postgres from "postgres";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

let _db: postgres.Sql | null = null;

/**
 * Get the current database connection
 */
export function getDb(): postgres.Sql {
  if (!_db) {
    throw new Error("[DB] Database not initialized. Call initDbConnection() first.");
  }
  return _db;
}

/**
 * Create PostgreSQL connection pool
 */
export function createDbConnection(database?: string): postgres.Sql {
  return postgres({
    host: config.database.host,
    port: config.database.port,
    database: database || config.database.name,
    user: config.database.user,
    password: config.database.password,
    max: config.database.maxConnections,
    idle_timeout: config.database.idleTimeout,
    connect_timeout: config.database.connectTimeout,

    // Debug in development
    debug: config.env === "development" ? (connection, query, parameters, types) => {
      logger.debug(`[DB] ${query}`, parameters);
    } : false,

    // Transform timestamps to JavaScript Date objects
    transform: {
      undefined: null,  // Convert undefined to NULL
    },
  });
}

/**
 * Initialize the main database connection
 */
export function initDbConnection(): void {
  if (_db) {
    return;
  }
  _db = createDbConnection();
}

/**
 * Close database connection gracefully
 */
export async function closeDatabase(): Promise<void> {
  try {
    if (_db) {
      await _db.end();
      _db = null;
    }
    logger.info("[DB] Database connection closed");
  } catch (error) {
    logger.error("[DB] Error closing database:", error);
  }
}

/**
 * Check database connection health
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const db = getDb();
    const result = await db`SELECT 1 as health`;
    return result.length > 0 && result[0]?.health === 1;
  } catch (error) {
    logger.error("[DB] Health check failed:", error);
    return false;
  }
}

/**
 * Execute raw SQL query with parameters
 * Use this for dynamic queries that can't use template literals
 */
export async function execute<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const db = getDb();
  const result = await db.unsafe(sql, (params || []) as (string | number | boolean | null | Date | Buffer)[]);
  return result as unknown as T[];
}

/**
 * Query result type helper
 */
export type QueryResult<T = Record<string, unknown>> = T[];

/**
 * Proxy-based db export for backward compatibility
 * Delegates all operations to the initialized connection
 */
export const db: postgres.Sql = function (...args: unknown[]) {
  const actualDb = getDb();
  // Template literal calls come as [strings, ...values]
  if (args.length > 0 && Array.isArray(args[0])) {
    return (actualDb as unknown as Function)(...args);
  }
  // Identifier calls like db('table_name') should return an identifier
  if (args.length === 1 && typeof args[0] === 'string') {
    return (actualDb as unknown as Function)(args[0]);
  }
  return actualDb;
} as unknown as postgres.Sql;

// Copy all methods from prototype
Object.defineProperties(db, {
  end: {
    get: () => getDb().end,
    enumerable: true,
    configurable: true,
  },
  unsafe: {
    get: () => getDb().unsafe,
    enumerable: true,
    configurable: true,
  },
  begin: {
    get: () => getDb().begin,
    enumerable: true,
    configurable: true,
  },
  reserve: {
    get: () => getDb().reserve,
    enumerable: true,
    configurable: true,
  },
});

export default db;
