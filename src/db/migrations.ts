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
  createThirdPartyAuthTables();

  // Dify integration: per-app service api key, lives alongside the binding so
  // runtime calls to /v1/chat-messages and /v1/workflows/run can use a
  // properly-scoped 'app' type token instead of the tenant-wide 'dataset'
  // token (which Dify rejects with 401 for app endpoints).
  addColumnIfNotExists("dify_app_binding", "app_api_key", "TEXT");
}

/**
 * Add a column to a table if it doesn't already exist
 */
function addColumnIfNotExists(
  table: string,
  column: string,
  type: string,
): void {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.find((c) => c.name === column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (e) {
    // Column might already exist, ignore error
  }
}

function createIndexIfNotExists(
  indexName: string,
  table: string,
  column: string,
): void {
  try {
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table}(${column})`,
    );
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
  insertSystemConfigIfMissing("login_method", "0");
  insertSystemConfigIfMissing(
    "log_report",
    '{"enabled":0,"protocol":"","domain":""}',
  );
  insertSystemConfigIfMissing(
    "version_update",
    '{"enabled":0,"cos_domain":""}',
  );
  insertSystemConfigIfMissing(
    "product_improvement",
    '{"enabled":0,"protocol":"","domain":""}',
  );
  insertSystemConfigIfMissing(
    "third_party_auth",
    '{"enabled":1,"default_provider":"comac_cas","providers":[{"id":"comac_cas","name":"中国商飞","type":"cas","enabled":1,"cas_url":"http://cas.cvtol.com/","login_path":"/cas/login/","validate_path":"/cas/p3/serviceValidate","logout_path":"/cas/logout","logout_service_url":"","service_param":"service","service_encode_mode":"component","callback_mode":"server_callback","server_callback_url":"","app_callback_url":"sudowork://cas-callback/comac_cas/callback","enterprise_code":"sudo","auto_provision":1}]}',
  );
}

function insertSystemConfigIfMissing(key: string, value: string): void {
  const existing = db
    .prepare("SELECT key FROM system_config WHERE key = ?")
    .get(key);
  if (existing) {
    return;
  }

  const columns = db.prepare("PRAGMA table_info(system_config)").all() as {
    name: string;
  }[];
  const hasDescription = columns.some(
    (column) => column.name === "description",
  );
  const hasUpdatedAt = columns.some((column) => column.name === "updated_at");

  if (hasDescription && hasUpdatedAt) {
    db.run(
      "INSERT INTO system_config(key, value, description, updated_at) VALUES(?, ?, ?, ?)",
      [key, value, "", Math.floor(Date.now() / 1000)],
    );
    return;
  }

  db.run("INSERT INTO system_config(key, value) VALUES(?, ?)", [key, value]);
}

function createThirdPartyAuthTables(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS third_party_auth_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      enterprise_id INTEGER NOT NULL,
      raw_profile TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, external_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id)
    );
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_third_party_auth_user_id ON third_party_auth_identities(user_id)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_third_party_auth_enterprise_id ON third_party_auth_identities(enterprise_id)`,
  );
  db.run(`
    CREATE TABLE IF NOT EXISTS third_party_auth_handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT UNIQUE NOT NULL,
      provider_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      external_user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_third_party_auth_handoffs_provider ON third_party_auth_handoffs(provider_id)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_third_party_auth_handoffs_expires_at ON third_party_auth_handoffs(expires_at)`,
  );
}
