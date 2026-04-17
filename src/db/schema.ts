/**
 * Database schema definitions
 */

import { db } from "./index.js";

/**
 * Initialize database schema (create tables if not exist)
 */
export function initSchema(): void {
  // Enterprises table
  db.run(`
    CREATE TABLE IF NOT EXISTS enterprises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      code TEXT UNIQUE,
      credit_pool REAL DEFAULT 10000
    );
  `);

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      nickname TEXT,
      role TEXT CHECK(role IN ('ADMIN', 'USER', 'SUPER_ADMIN', 'ENTERPRISE_ADMIN')),
      status INTEGER DEFAULT 0, -- 0: PENDING, 1: APPROVED, 2: LOCKED
      enterprise_id INTEGER,
      api_key TEXT,
      balance REAL DEFAULT 0,
      password_hash TEXT,
      must_change_password BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(enterprise_id) REFERENCES enterprises(id)
    );
  `);

  // Ledger table
  db.run(`
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      amount REAL,
      type TEXT,
      memo TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Invitation codes table
  db.run(`
    CREATE TABLE IF NOT EXISTS invitation_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      enterprise_id INTEGER NOT NULL,
      status INTEGER DEFAULT 0,
      used_by_user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_at DATETIME,
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id),
      FOREIGN KEY (used_by_user_id) REFERENCES users(id)
    );
  `);

  // Operation logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_phone TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      resource_id INTEGER,
      method TEXT,
      path TEXT,
      params TEXT,
      request_data TEXT,
      response_data TEXT,
      response_status INTEGER,
      ip_address TEXT,
      user_agent TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_invitation_codes_status ON invitation_codes(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_operation_logs_user_id ON operation_logs(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_operation_logs_action ON operation_logs(action)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at)`);

  // ============================================
  // Recharge System Tables (富友支付充值系统)
  // ============================================

  // Recharge orders table (充值订单表)
  db.run(`
    CREATE TABLE IF NOT EXISTS recharge_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      -- Order info
      order_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      user_phone TEXT,
      enterprise_id INTEGER,

      -- Amount info
      amount_usd REAL NOT NULL,           -- 美元金额
      amount_yuan REAL NOT NULL,          -- 人民币金额（汇率转换后）
      amount_cents INTEGER NOT NULL,      -- 人民币金额（分）
      exchange_rate REAL DEFAULT 7.3,     -- 使用的汇率
      quota_amount INTEGER NOT NULL,
      points_amount INTEGER NOT NULL,
      bonus_points INTEGER DEFAULT 0,

      -- Payment info
      payment_method TEXT NOT NULL,
      order_date TEXT,

      -- Fuiou response
      fuiou_order_info TEXT,

      -- Status tracking
      status INTEGER DEFAULT 0,

      -- Callback info
      callback_data TEXT,
      callback_time DATETIME,
      callback_amount_cents INTEGER,

      -- Timestamps
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expired_at DATETIME,

      -- Remark
      remark TEXT,

      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id)
    );
  `);

  // Recharge records table (充值记录表)
  db.run(`
    CREATE TABLE IF NOT EXISTS recharge_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,

      -- Quota changes
      quota_before INTEGER,
      quota_after INTEGER,
      quota_delta INTEGER NOT NULL,

      -- Points changes
      balance_before REAL,
      balance_after REAL,
      balance_delta REAL NOT NULL,

      -- Sudorouter sync
      sudorouter_user_id INTEGER,
      sudorouter_success BOOLEAN,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (order_id) REFERENCES recharge_orders(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Admin recharge records table (后台充值记录表)
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_recharge_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      admin_id INTEGER NOT NULL,

      -- Recharge info
      points INTEGER NOT NULL,
      quota INTEGER NOT NULL,
      reason TEXT,
      payment_reference TEXT,

      -- Sudorouter sync
      sudorouter_user_id INTEGER,
      sudorouter_success BOOLEAN DEFAULT TRUE,
      sudorouter_error TEXT,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (admin_id) REFERENCES users(id)
    );
  `);

  // Refund records table (退款记录表)
  db.run(`
    CREATE TABLE IF NOT EXISTS refund_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refund_no TEXT UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      order_no TEXT NOT NULL,
      user_id INTEGER NOT NULL,

      -- Refund amount
      refund_amount_yuan REAL NOT NULL,
      refund_quota INTEGER NOT NULL,
      refund_points INTEGER NOT NULL,

      -- Refund reason
      refund_reason TEXT,
      refund_type TEXT,

      -- Status
      status INTEGER DEFAULT 0,

      -- Fuiou info
      fuiou_refund_no TEXT,
      fuiou_response TEXT,

      -- Timestamps
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,

      FOREIGN KEY (order_id) REFERENCES recharge_orders(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Create indexes for recharge tables
  db.run(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_user_id ON recharge_orders(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_status ON recharge_orders(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_order_no ON recharge_orders(order_no)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recharge_orders_created_at ON recharge_orders(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recharge_records_order_id ON recharge_records(order_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recharge_records_user_id ON recharge_records(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_admin_recharge_records_user_id ON admin_recharge_records(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_admin_recharge_records_admin_id ON admin_recharge_records(admin_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_admin_recharge_records_created_at ON admin_recharge_records(created_at)`);

  // ============================================
  // Config Items System Tables (配置项管理系统)
  // ============================================

  // Config items table (配置项表)
  db.run(`
    CREATE TABLE IF NOT EXISTS config_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      status INTEGER DEFAULT 1,
      created_by_id INTEGER,
      created_by_name TEXT,
      updated_by_id INTEGER,
      updated_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Config entries table (配置项键值表)
  db.run(`
    CREATE TABLE IF NOT EXISTS config_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_item_id INTEGER NOT NULL,
      config_key TEXT NOT NULL,
      config_desc TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (config_item_id) REFERENCES config_items(id)
    );
  `);

  // Config enterprise relation table (配置项-企业关联表)
  db.run(`
    CREATE TABLE IF NOT EXISTS config_enterprise_rel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_item_id INTEGER NOT NULL,
      enterprise_id INTEGER NOT NULL,
      FOREIGN KEY (config_item_id) REFERENCES config_items(id),
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id)
    );
  `);

  // Create indexes for config items tables
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_config_items_name ON config_items(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_config_items_status ON config_items(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_config_items_updated_at ON config_items(updated_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_config_entries_config_item_id ON config_entries(config_item_id)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_config_entries_item_key ON config_entries(config_item_id, config_key)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_config_enterprise_rel_item_enterprise ON config_enterprise_rel(config_item_id, enterprise_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_config_enterprise_rel_enterprise_id ON config_enterprise_rel(enterprise_id)`);
}