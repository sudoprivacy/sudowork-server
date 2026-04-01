/**
 * Database initialization functions
 */

import { db } from "./index.js";
import { hashPassword } from "../utils/password.js";
import { rechargeService } from "../services/RechargeService.js";
import { fuiouPayService } from "../services/FuiouPayService.js";

/**
 * Data cleanup - currently disabled
 */
export function cleanupData(): void {
  // Auto cleanup is disabled to avoid losing user data
  console.log("=== 数据清理已跳过 ===");
}

/**
 * Initialize default enterprise (sudo)
 */
export function initEnterprise(): void {
  const ent = db.prepare("SELECT * FROM enterprises WHERE code = 'sudo'").get();
  if (!ent) {
    db.run("INSERT INTO enterprises (name, code) VALUES (?, ?)", [
      "数牍科技",
      "sudo",
    ]);
    console.log("=== 企业已创建 ===");
    console.log("企业码：sudo");
    console.log("========================");
  }
}

/**
 * Initialize super admin user
 */
export async function initSuperAdmin(): Promise<void> {
  const SUPER_ADMIN_PHONE = process.env.SUPER_ADMIN_PHONE || "sudo";
  const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

  if (!SUPER_ADMIN_PASSWORD) {
    console.warn("[警告] SUPER_ADMIN_PASSWORD 未配置，跳过超级管理员初始化");
    return;
  }

  const existingAdmin = db
    .prepare("SELECT * FROM users WHERE phone = ?")
    .get(SUPER_ADMIN_PHONE);

  if (!existingAdmin) {
    const passwordHash = await hashPassword(SUPER_ADMIN_PASSWORD);

    db.run(
      `
      INSERT INTO users (phone, nickname, role, password_hash, status, must_change_password, balance)
      VALUES (?, '超级管理员', 'SUPER_ADMIN', ?, 1, FALSE, 0)
    `,
      [SUPER_ADMIN_PHONE, passwordHash],
    );

    console.log("\n=== 超级管理员已创建 ===");
    console.log(`登录账号：${SUPER_ADMIN_PHONE}`);
    console.log("登录密码：[已配置]");
    console.log("请妥善保管密码！\n");
  }
}

/**
 * Initialize old log cleanup job (runs every 24 hours)
 */
export function initLogCleanup(): void {
  const cleanOldLogs = () => {
    const result = db.run(
      "DELETE FROM operation_logs WHERE created_at < datetime('now', '-60 days')",
    );
    if (result.changes > 0) {
      console.log(`[日志清理] 已删除 ${result.changes} 条过期日志`);
    }
  };

  // Run cleanup every 24 hours
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
  // Run once on startup
  cleanOldLogs();
}

/**
 * Initialize order cleanup job (runs every minute)
 * Cancels expired recharge orders
 */
export function initOrderCleanup(): void {
  const cleanExpiredOrders = () => {
    const now = new Date().toISOString();
    const result = db.run(
      "UPDATE recharge_orders SET status = 5 WHERE status IN (0, 1) AND expired_at < ?",
      [now]
    );
    if (result.changes > 0) {
      console.log(`[订单清理] 已取消 ${result.changes} 个过期订单`);
    }
  };

  // Run cleanup every minute
  setInterval(cleanExpiredOrders, 60 * 1000);
  // Run once on startup
  cleanExpiredOrders();
}

/**
 * Initialize order sync job (runs every 5 minutes)
 * Syncs pending orders from Fuiou payment status
 */
export function initOrderSync(): void {
  const syncPendingOrders = async () => {
    try {
      // Initialize Fuiou service
      await fuiouPayService.initialize();

      // Sync all pending orders
      const result = await rechargeService.syncAllPendingOrders();
      if (result.total > 0) {
        console.log(`[订单同步] 同步完成: 总计=${result.total}, 成功=${result.success}, 失败=${result.failed}`);
      }
    } catch (e) {
      console.error("[订单同步] 定时任务执行失败:", e);
    }
  };

  // Run sync every 5 minutes
  setInterval(syncPendingOrders, 5 * 60 * 1000);
  // Also run on startup after 1 minute delay
  setTimeout(syncPendingOrders, 60 * 1000);
}

/**
 * Initialize all database components
 */
export async function initDatabase(): Promise<void> {
  cleanupData();

  // Migration: Add amount_usd and exchange_rate columns to recharge_orders
  try {
    const columns = db.prepare("PRAGMA table_info(recharge_orders)").all() as any[];
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('amount_usd')) {
      console.log("[Migration] Adding amount_usd column to recharge_orders...");
      db.run("ALTER TABLE recharge_orders ADD COLUMN amount_usd REAL");
    }

    if (!columnNames.includes('exchange_rate')) {
      console.log("[Migration] Adding exchange_rate column to recharge_orders...");
      db.run("ALTER TABLE recharge_orders ADD COLUMN exchange_rate REAL DEFAULT 7.3");
    }

    // Migrate existing data: if amount_usd is null, set it from amount_yuan (assuming USD=amount_yuan/7.3)
    db.run("UPDATE recharge_orders SET amount_usd = ROUND(amount_yuan / 7.3, 2) WHERE amount_usd IS NULL");
    db.run("UPDATE recharge_orders SET exchange_rate = 7.3 WHERE exchange_rate IS NULL");
  } catch (e) {
    // Table might not exist yet, ignore
  }

  initEnterprise();
  await initSuperAdmin();
  initLogCleanup();
  initOrderCleanup();
  initOrderSync();
}