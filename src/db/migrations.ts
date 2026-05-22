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
  addColumnIfNotExists("config_items", "icon", "TEXT");
  addColumnIfNotExists("config_entries", "name", "TEXT NOT NULL DEFAULT ''");
  addColumnIfNotExists("config_entries", "required", "INTEGER DEFAULT 1");
  addColumnIfNotExists("config_items", "pinyin", "TEXT");
  addColumnIfNotExists("config_items", "url_pattern", "TEXT");
  addColumnIfNotExists("config_items", "scheme", "TEXT");
  addColumnIfNotExists("config_items", "bearer_prefix", "TEXT");
  addColumnIfNotExists("config_items", "visible_to_all", "INTEGER DEFAULT 0");
  // Enterprise new fields
  addColumnIfNotExists("enterprises", "logo", "TEXT");
  addColumnIfNotExists("enterprises", "app_name", "TEXT");
  addColumnIfNotExists("enterprises", "top_name", "TEXT");
  addColumnIfNotExists("enterprises", "about_name", "TEXT");
  addColumnIfNotExists("enterprises", "app_company_name", "TEXT");
  addColumnIfNotExists("enterprises", "login_desp", "TEXT");

  createIndexIfNotExists("idx_config_items_pinyin", "config_items", "pinyin");
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

function createIndexIfNotExists(indexName: string, table: string, column: string): void {
  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table}(${column})`);
  } catch (e) {
    // Index might already exist, ignore error
  }
}
