/**
 * Admin invitation code management routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { generateInvitationCode } from "../utils/invitation.js";
import { authMiddleware, adminMiddleware, getAuthUser } from "../middleware/auth.js";

const adminInvitationRoutes = new Hono();

// GET /api/v1/admin/invitation-codes - 获取邀请码列表
adminInvitationRoutes.get(
  "/invitation-codes",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const status = c.req.query("status");
    const enterpriseId = c.req.query("enterprise_id");
    const page = parseInt(c.req.query("page") || "1");
    const pageSize = parseInt(c.req.query("page_size") || "20");

    let query = `
      SELECT ic.*, u.phone as used_by_phone, u.nickname as used_by_nickname, e.name as enterprise_name
      FROM invitation_codes ic
      LEFT JOIN users u ON ic.used_by_user_id = u.id
      LEFT JOIN enterprises e ON ic.enterprise_id = e.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status !== undefined && status !== "") {
      query += " AND ic.status = ?";
      params.push(parseInt(status));
    }

    if (enterpriseId !== undefined && enterpriseId !== "") {
      query += " AND ic.enterprise_id = ?";
      params.push(parseInt(enterpriseId));
    }

    query += " ORDER BY ic.created_at DESC LIMIT ? OFFSET ?";
    params.push(pageSize, (page - 1) * pageSize);

    const codes = db.prepare(query).all(...params);

    // 获取总数
    let countQuery = "SELECT COUNT(*) as count FROM invitation_codes WHERE 1=1";
    const countParams: any[] = [];
    if (status !== undefined && status !== "") {
      countQuery += " AND status = ?";
      countParams.push(parseInt(status));
    }
    if (enterpriseId !== undefined && enterpriseId !== "") {
      countQuery += " AND enterprise_id = ?";
      countParams.push(parseInt(enterpriseId));
    }
    const total = db.prepare(countQuery).get(...countParams) as any;

    return c.json({
      success: true,
      data: {
        items: codes,
        total: total?.count || 0,
        page,
        page_size: pageSize,
      },
    });
  },
);

// POST /api/v1/admin/invitation-codes - 批量创建邀请码
adminInvitationRoutes.post(
  "/invitation-codes",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const { count, enterprise_id } = await c.req.json();
    const createCount = Math.min(Math.max(count || 1, 1), 100); // 最多一次创建100个

    // 验证企业是否存在
    const enterprise = db
      .prepare("SELECT id FROM enterprises WHERE id = ?")
      .get(enterprise_id) as any;
    if (!enterprise) {
      return c.json({ success: false, msg: "企业不存在" }, 400);
    }

    const codes: string[] = [];

    for (let i = 0; i < createCount; i++) {
      let code: string;
      let attempts = 0;

      // 确保生成唯一的邀请码
      do {
        code = generateInvitationCode();
        attempts++;
        if (attempts > 100) {
          break;
        }
      } while (
        db.prepare("SELECT id FROM invitation_codes WHERE code = ?").get(code)
      );

      try {
        db.run(
          "INSERT INTO invitation_codes (code, enterprise_id) VALUES (?, ?)",
          [code, enterprise_id],
        );
        codes.push(code);
      } catch (e) {
        console.error("创建邀请码失败:", e);
      }
    }

    // 记录操作日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminUser.id,
        adminUser.phone,
        "INVITATION_CODE_CREATE",
        "invitation_code",
        enterprise_id,
        "POST",
        "/api/v1/admin/invitation-codes",
        JSON.stringify({ count: createCount, enterprise_id }),
        JSON.stringify({ codes, count: codes.length }),
      ],
    );

    return c.json({
      success: true,
      data: {
        codes,
        count: codes.length,
      },
      msg: `成功创建 ${codes.length} 个邀请码`,
    });
  },
);

// DELETE /api/v1/admin/invitation-codes/:id - 删除邀请码
adminInvitationRoutes.delete(
  "/invitation-codes/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;

    // 检查邀请码状态
    const code = db
      .prepare("SELECT * FROM invitation_codes WHERE id = ?")
      .get(id) as any;

    if (!code) {
      return c.json({ success: false, msg: "邀请码不存在" }, 404);
    }

    if (code.status === 1) {
      return c.json({ success: false, msg: "邀请码已被使用，无法删除" }, 400);
    }

    db.run("DELETE FROM invitation_codes WHERE id = ?", [id]);

    // 记录操作日志（包含被删除邀请码的详细信息）
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminUser.id,
        adminUser.phone,
        "INVITATION_CODE_DELETE",
        "invitation_code",
        id,
        "DELETE",
        `/api/v1/admin/invitation-codes/${id}`,
        JSON.stringify({ target_code_id: id }),
        JSON.stringify({
          code: code.code,
          enterprise_id: code.enterprise_id,
          status: code.status,
        }),
      ],
    );

    return c.json({
      success: true,
      msg: "邀请码删除成功",
    });
  },
);

// GET /api/v1/admin/invitation-codes/available - 获取可用邀请码
adminInvitationRoutes.get(
  "/invitation-codes/available",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const enterpriseId = c.req.query("enterprise_id");

    if (!enterpriseId) {
      return c.json({ success: false, msg: "请指定企业ID" }, 400);
    }

    const codes = db
      .prepare(
        "SELECT id, code FROM invitation_codes WHERE enterprise_id = ? AND status = 0 ORDER BY created_at DESC",
      )
      .all(parseInt(enterpriseId));

    return c.json({
      success: true,
      data: codes,
    });
  },
);

export { adminInvitationRoutes };