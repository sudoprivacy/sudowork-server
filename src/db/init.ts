/**
 * Database initialization functions
 */

import { db } from "./index.js";
import { hashPassword } from "../utils/password.js";

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
 * Initialize all database components
 */
export async function initDatabase(): Promise<void> {
  cleanupData();
  initEnterprise();
  await initSuperAdmin();
  initLogCleanup();
}