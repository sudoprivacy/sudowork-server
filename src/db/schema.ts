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
      credit_pool REAL DEFAULT 10000,
      logo TEXT,
      app_name TEXT,
      top_name TEXT,
      about_name TEXT,
      app_company_name TEXT,
      login_desp TEXT
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
      login_type INTEGER NOT NULL DEFAULT 0, -- 0: 手机验证码, 1: 用户名密码
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
      initial_quota_usd REAL,
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
      icon TEXT,
      pinyin TEXT,
      url_pattern TEXT,
      scheme TEXT,
      bearer_prefix TEXT,
      visible_to_all INTEGER DEFAULT 0,
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
      name TEXT NOT NULL DEFAULT '',
      config_desc TEXT,
      required INTEGER DEFAULT 1,
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

  // ============================================
  // System Config Table (系统配置 KV)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ============================================
  // Dify 整合相关表 (Dify Integration)
  // ============================================

  // 企业 → Dify Tenant 绑定
  // 每个企业最多一行; api_key 为 Dify Service API key 明文。
  // 不加密的原因：sudowork-server SQLite 自身已是后端机密文件，再加 AES 只增加运维复杂度
  // （额外的 KMS 备份/轮换），不会增强真正的安全边界。防止外泄靠把 api_key 永远不暴露给客户端。
  db.run(`
    CREATE TABLE IF NOT EXISTS dify_tenant_binding (
      enterprise_id INTEGER PRIMARY KEY,
      dify_tenant_id TEXT NOT NULL UNIQUE,
      dify_system_account_id TEXT,
      api_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id)
    );
  `);

  // 助手 ↔ Dify App 绑定
  // app_api_key 是 Dify api_tokens 表里 type=app 的 token；只能用来调
  // /v1/chat-messages 和 /v1/workflows/run。在 createAgent 时直接 INSERT 一行
  // 进 Dify 的 api_tokens 表（通过系统端点），把 token 回填到这里。
  // 与 dify_tenant_binding.api_key (type=dataset) 不同，那条仅用于
  // /v1/datasets/{id}/queries（RAG-only 模式）。
  db.run(`
    CREATE TABLE IF NOT EXISTS dify_app_binding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enterprise_id INTEGER NOT NULL,
      assistant_id TEXT NOT NULL,
      dify_tenant_id TEXT NOT NULL,
      dify_app_id TEXT NOT NULL,
      app_api_key TEXT,
      -- dify_app_mode：Dify App 的原生模式，1:1 反映 Dify 侧的 mode。
      --   值域：'chat' | 'agent-chat' | 'agent' | 'workflow' | 'advanced-chat' | 'completion'
      --
      -- 2026-06-22 P2.5.1：原"增强子模式" 'rag-only' 已废弃。纯 RAG 助手不再写本表，
      -- 改写 dify_dataset_binding。详见 2026-06-17-dify-integration-design.md
      -- 「知识增强：两个维度」。历史 'rag-only' 行由迁移脚本清理。
      dify_app_mode TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(enterprise_id, assistant_id),
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id)
    );
  `);

  // 助手可见性 ACL
  // subject_type='all' 时 subject_id 为 NULL — 表示企业内全员可见
  db.run(`
    CREATE TABLE IF NOT EXISTS assistant_acl (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enterprise_id INTEGER NOT NULL,
      assistant_id TEXT NOT NULL,
      subject_type TEXT NOT NULL CHECK(subject_type IN ('user','department','role','all')),
      subject_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id)
    );
  `);

  // 助手 → 数据集绑定（一对多）
  db.run(`
    CREATE TABLE IF NOT EXISTS dify_dataset_binding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enterprise_id INTEGER NOT NULL,
      assistant_id TEXT NOT NULL,
      dify_tenant_id TEXT NOT NULL,
      dify_dataset_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(enterprise_id, assistant_id, dify_dataset_id),
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id)
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_dify_app_binding_app_id ON dify_app_binding(dify_app_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_assistant_acl_assistant_id ON assistant_acl(assistant_id)`);
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_acl_unique
       ON assistant_acl(enterprise_id, assistant_id, subject_type, COALESCE(subject_id, ''))`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_dify_dataset_binding_assistant
       ON dify_dataset_binding(enterprise_id, assistant_id)`,
  );
}
