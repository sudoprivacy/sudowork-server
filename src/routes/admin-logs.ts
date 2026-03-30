/**
 * Admin logs and member management routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const adminLogRoutes = new Hono();

// ==================== Operation Logs ====================

// GET /api/v1/admin/logs - 获取操作日志
adminLogRoutes.get(
  "/logs",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const userId = c.req.query("user_id");
    const action = c.req.query("action");
    const dateFrom = c.req.query("date_from");
    const dateTo = c.req.query("date_to");
    const page = parseInt(c.req.query("page") || "1");
    const pageSize = parseInt(c.req.query("page_size") || "20");

    let query = "SELECT * FROM operation_logs WHERE 1=1";
    const params: any[] = [];

    if (userId) {
      query += " AND user_id = ?";
      params.push(parseInt(userId));
    }

    if (action) {
      query += " AND action = ?";
      params.push(action);
    }

    if (dateFrom) {
      query += " AND created_at >= datetime(?, 'unixepoch')";
      params.push(dateFrom);
    }

    if (dateTo) {
      query += " AND created_at <= datetime(?, 'unixepoch')";
      params.push(dateTo);
    }

    // 获取总数
    const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as count");
    const total = db.prepare(countQuery).get(...params) as any;

    // 分页查询
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(pageSize, (page - 1) * pageSize);

    const logs = db.prepare(query).all(...params);

    return c.json({
      success: true,
      data: {
        items: logs,
        total: total?.count || 0,
        page,
        page_size: pageSize,
      },
    });
  },
);

// ==================== Member Management (Legacy) ====================

// GET /api/v1/admin/members
adminLogRoutes.get(
  "/members",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const user = c.get("user");

    let users: any[];
    if (user.role === "SUPER_ADMIN") {
      users = db.prepare("SELECT * FROM users ORDER BY status ASC").all();
    } else {
      users = db
        .prepare(
          "SELECT * FROM users WHERE enterprise_id = ? ORDER BY status ASC",
        )
        .all(user.enterprise_id ?? 0);
    }

    return c.json({ success: true, data: users });
  },
);

// POST /api/v1/admin/approve
adminLogRoutes.post(
  "/approve",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const admin = c.get("user");
    const { userId } = await c.req.json();

    const targetUser = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as any;
    if (!targetUser) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    if (
      admin.role !== "SUPER_ADMIN" &&
      targetUser.enterprise_id !== admin.enterprise_id
    ) {
      return c.json({ success: false, msg: "无权操作该用户" }, 403);
    }

    const mockApiKey = `sk-router-mock-${Math.random().toString(36).substring(7)}`;
    db.run(
      "UPDATE users SET status = 1, api_key = ?, balance = 100 WHERE id = ?",
      [mockApiKey, userId],
    );
    db.run(
      "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
      [userId, 100, "BONUS", "审批通过赠送"],
    );
    return c.json({ success: true, msg: "审批成功" });
  },
);

// POST /api/v1/admin/reject
adminLogRoutes.post(
  "/reject",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const admin = c.get("user");
    const { userId } = await c.req.json();

    const targetUser = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as any;
    if (!targetUser) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    if (
      admin.role !== "SUPER_ADMIN" &&
      targetUser.enterprise_id !== admin.enterprise_id
    ) {
      return c.json({ success: false, msg: "无权操作该用户" }, 403);
    }

    db.run("UPDATE users SET status = 2 WHERE id = ?", [userId]);
    db.run(
      "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
      [userId, 0, "REJECT", "管理员拒绝申请"],
    );
    return c.json({ success: true, msg: "已拒绝申请" });
  },
);

// POST /api/v1/admin/delete
adminLogRoutes.post(
  "/delete",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const admin = c.get("user");
    const { userId } = await c.req.json();

    const targetUser = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as any;
    if (!targetUser) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    if (targetUser.role === "SUPER_ADMIN") {
      return c.json({ success: false, msg: "不能删除超级管理员" }, 403);
    }

    if (
      admin.role !== "SUPER_ADMIN" &&
      targetUser.enterprise_id !== admin.enterprise_id
    ) {
      return c.json({ success: false, msg: "无权操作该用户" }, 403);
    }

    db.run("DELETE FROM users WHERE id = ?", [userId]);
    db.run("DELETE FROM ledger WHERE user_id = ?", [userId]);

    return c.json({ success: true, msg: "用户已删除" });
  },
);

export { adminLogRoutes };