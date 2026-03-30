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
}