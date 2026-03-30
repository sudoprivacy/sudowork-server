/**
 * Database migrations - add columns if not exist
 */

import { db } from "./index.js";

/**
 * Run migrations to add new columns
 */
export function runMigrations(): void {
  addColumnIfNotExists("users", "sudorouter_user_id", "INTEGER");
  addColumnIfNotExists("users", "sudorouter_key", "TEXT");
  addColumnIfNotExists("users", "invitation_code_id", "INTEGER");
  addColumnIfNotExists("users", "quota", "INTEGER DEFAULT 0");
  addColumnIfNotExists("users", "used_quota", "INTEGER DEFAULT 0");
  addColumnIfNotExists("operation_logs", "request_data", "TEXT");
  addColumnIfNotExists("operation_logs", "response_data", "TEXT");
}

/**
 * Add a column to a table if it doesn't already exist
 */
function addColumnIfNotExists(table: string, column: string, type: string): void {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.find((c) => c.name === column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (e) {
    // Column might already exist, ignore error
  }
}