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
  addColumnIfNotExists("invitation_codes", "initial_quota_usd", "REAL");
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

  // 登录方式可配置:users.login_type 列 + system_config 表
  addColumnIfNotExists("users", "login_type", "INTEGER NOT NULL DEFAULT 0");
  createSystemConfigTable();
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

/**
 * Create system_config table (KV) and seed default login_method.
 * Idempotent: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE (UNIQUE on key).
 */
function createSystemConfigTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.run(`INSERT OR IGNORE INTO system_config(key, value) VALUES('login_method', '0')`);
  db.run(`INSERT OR IGNORE INTO system_config(key, value) VALUES('log_report', '{"enabled":0,"protocol":"","domain":""}')`);
  db.run(`INSERT OR IGNORE INTO system_config(key, value) VALUES('version_update', '{"enabled":0,"cos_domain":""}')`);
  db.run(`INSERT OR IGNORE INTO system_config(key, value) VALUES('product_improvement', '{"enabled":0,"protocol":"","domain":""}')`);
}
