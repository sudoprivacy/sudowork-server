/**
 * Admin logs and member management routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { sudorouterService } from "../services/SudorouterService.js";
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

// POST /api/v1/admin/members/:id/sync-quota - 手动同步单个用户额度
adminLogRoutes.post(
  "/members/:id/sync-quota",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const admin = c.get("user");
    const userId = c.req.param("id");

    const targetUser = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as any;

    if (!targetUser) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    // 权限检查
    if (
      admin.role !== "SUPER_ADMIN" &&
      targetUser.enterprise_id !== admin.enterprise_id
    ) {
      return c.json({ success: false, msg: "无权操作该用户" }, 403);
    }

    // 检查是否绑定 sudorouter
    if (!targetUser.sudorouter_user_id) {
      return c.json({ success: false, msg: "用户未绑定 sudorouter" }, 400);
    }

    // 检查 sudorouter 服务
    if (!sudorouterService.isConfigured()) {
      return c.json({ success: false, msg: "sudorouter 服务未配置" }, 500);
    }

    // 从 sudorouter 获取最新额度
    const sudorouterUser = await sudorouterService.getUser(
      targetUser.sudorouter_user_id,
    );

    if (!sudorouterUser) {
      return c.json({ success: false, msg: "获取 sudorouter 用户信息失败" }, 500);
    }

    const quota = sudorouterUser.quota || 0;
    const usedQuota = sudorouterUser.used_quota || 0;
    const balance = sudorouterService.quotaToPoints(quota);

    // 更新本地数据库
    db.run(
      "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
      [quota, usedQuota, balance, userId],
    );

    // 记录操作日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        admin.id,
        admin.phone,
        "MEMBER_SYNC_QUOTA",
        "user",
        userId,
        "POST",
        `/api/v1/admin/members/${userId}/sync-quota`,
        JSON.stringify({ target_user_id: userId }),
        JSON.stringify({ quota, used_quota: usedQuota, balance }),
      ],
    );

    return c.json({
      success: true,
      msg: "额度同步成功",
      data: {
        id: userId,
        quota,
        used_quota: usedQuota,
        balance,
      },
    });
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