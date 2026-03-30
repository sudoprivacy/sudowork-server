/**
 * Admin user management routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { sudorouterService } from "../services/SudorouterService.js";
import { authMiddleware, adminMiddleware, getAuthUser } from "../middleware/auth.js";

const adminUserRoutes = new Hono();

// GET /api/v1/admin/stats - Dashboard statistics
adminUserRoutes.get("/stats", authMiddleware, adminMiddleware, async (c) => {
  const enterpriseCount = db
    .prepare("SELECT COUNT(*) as count FROM enterprises")
    .get() as any;
  // 排除 sudo 超级管理员账号
  const userCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE phone != 'sudo'")
    .get() as any;
  const approvedCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE status = 1 AND phone != 'sudo'")
    .get() as any;
  const pendingCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE status = 0 AND phone != 'sudo'")
    .get() as any;

  const totalPoints = db
    .prepare("SELECT SUM(balance) as total FROM users WHERE phone != 'sudo'")
    .get() as any;
  const totalBonus = db
    .prepare("SELECT SUM(amount) as total FROM ledger WHERE type = 'BONUS'")
    .get() as any;
  const totalConsumed = db
    .prepare("SELECT SUM(amount) as total FROM ledger WHERE type = 'CONSUME'")
    .get() as any;

  return c.json({
    success: true,
    data: {
      enterprises: enterpriseCount?.count || 0,
      users: userCount?.count || 0,
      approved: approvedCount?.count || 0,
      pending: pendingCount?.count || 0,
      points: {
        total: totalPoints?.total || 0,
        bonus: totalBonus?.total || 0,
        consumed: Math.abs(totalConsumed?.total || 0),
      },
    },
  });
});

// GET /api/v1/admin/users - User list
adminUserRoutes.get("/users", authMiddleware, adminMiddleware, async (c) => {
  const enterpriseId = c.req.query("enterprise_id");
  const status = c.req.query("status");
  const role = c.req.query("role");

  let query = `
    SELECT u.*, e.name as enterprise_name, ic.code as invitation_code
    FROM users u
    LEFT JOIN enterprises e ON u.enterprise_id = e.id
    LEFT JOIN invitation_codes ic ON u.invitation_code_id = ic.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (enterpriseId) {
    query += " AND u.enterprise_id = ?";
    params.push(enterpriseId);
  }

  if (status) {
    query += " AND u.status = ?";
    params.push(parseInt(status));
  }

  if (role) {
    query += " AND u.role = ?";
    params.push(role);
  }

  query += " ORDER BY u.created_at DESC";

  const users = db.prepare(query).all(...params) as any[];

  // 不再自动同步额度，改为手动触发（前端点击刷新按钮调用 /members/:id/sync-quota）
  // 直接返回本地数据库中的额度信息

  return c.json({
    success: true,
    data: users,
  });
});

// POST /api/v1/admin/users - Create user
adminUserRoutes.post("/users", authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as any;
  const { phone, nickname, enterprise_id, invitation_code_id } =
    await c.req.json();

  if (!phone || !enterprise_id) {
    return c.json(
      {
        success: false,
        msg: "手机号和所属企业不能为空",
      },
      400,
    );
  }

  if (!invitation_code_id) {
    return c.json(
      {
        success: false,
        msg: "请选择邀请码",
      },
      400,
    );
  }

  // Check if phone already exists
  const existing = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);

  if (existing) {
    return c.json(
      {
        success: false,
        msg: "手机号已存在",
      },
      400,
    );
  }

  // 验证邀请码
  const invitationCode = db
    .prepare("SELECT * FROM invitation_codes WHERE id = ? AND status = 0")
    .get(invitation_code_id) as any;

  if (!invitationCode) {
    return c.json(
      {
        success: false,
        msg: "邀请码不存在或已被使用",
      },
      400,
    );
  }

  if (invitationCode.enterprise_id !== parseInt(enterprise_id)) {
    return c.json(
      {
        success: false,
        msg: "邀请码不属于所选企业",
      },
      400,
    );
  }

  // 检查 sudorouter 服务是否配置
  if (!sudorouterService.isConfigured()) {
    return c.json(
      {
        success: false,
        msg: "系统未完成配置，请联系管理员",
      },
      500,
    );
  }

  // 调用 sudorouter 创建用户（带详细日志）
  const createUserResult = await sudorouterService.createUserWithLog(phone);
  if (!createUserResult.success || !createUserResult.data) {
    // 记录失败的 API 调用日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, method, path, request_data, response_data, response_status, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminUser.id,
        adminUser.phone,
        "SUDOROUTER_CREATE_USER_FAILED",
        "sudorouter_user",
        createUserResult.request.method,
        createUserResult.request.url,
        JSON.stringify(createUserResult.request.body),
        JSON.stringify(createUserResult.response.data),
        createUserResult.response.status,
        createUserResult.duration_ms,
        createUserResult.error || "创建用户失败",
      ],
    );
    return c.json(
      {
        success: false,
        msg: `创建 Sudorouter 用户失败: ${createUserResult.error || "未知错误"}`,
      },
      500,
    );
  }

  const sudorouterUser = createUserResult.data;

  // 记录创建用户成功的 API 调用日志
  db.run(
    `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      adminUser.id,
      adminUser.phone,
      "SUDOROUTER_CREATE_USER",
      "sudorouter_user",
      sudorouterUser.id,
      createUserResult.request.method,
      createUserResult.request.url,
      JSON.stringify(createUserResult.request.body),
      JSON.stringify(createUserResult.response.data),
      createUserResult.response.status,
      createUserResult.duration_ms,
    ],
  );

  // 调用 sudorouter 充值额度（500000）
  const initialQuota = sudorouterService.getInitialQuota();
  const quotaResult = await sudorouterService.updateUserQuotaWithLog(
    sudorouterUser.id,
    initialQuota,
    "新用户注册赠送额度",
  );

  // 记录充值额度 API 调用日志
  db.run(
    `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      adminUser.id,
      adminUser.phone,
      "SUDOROUTER_UPDATE_QUOTA",
      "sudorouter_quota",
      sudorouterUser.id,
      quotaResult.request.method,
      quotaResult.request.url,
      JSON.stringify(quotaResult.request.body),
      JSON.stringify(quotaResult.response.data),
      quotaResult.response.status,
      quotaResult.duration_ms,
      quotaResult.success ? null : quotaResult.error,
    ],
  );

  if (!quotaResult.success) {
    console.error(`[Admin] 用户 ${phone} 额度充值失败`);
  }

  // 调用 sudorouter 创建不限额令牌（带详细日志）
  const createTokenResult = await sudorouterService.createTokenWithLog(
    sudorouterUser.id,
    phone,
    true, // unlimited_quota
  );

  if (!createTokenResult.success || !createTokenResult.data) {
    // 记录失败的 API 调用日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, method, path, request_data, response_data, response_status, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminUser.id,
        adminUser.phone,
        "SUDOROUTER_CREATE_TOKEN_FAILED",
        "sudorouter_token",
        createTokenResult.request.method,
        createTokenResult.request.url,
        JSON.stringify(createTokenResult.request.body),
        JSON.stringify(createTokenResult.response.data),
        createTokenResult.response.status,
        createTokenResult.duration_ms,
        createTokenResult.error || "创建令牌失败",
      ],
    );
    return c.json(
      {
        success: false,
        msg: `创建 Sudorouter 令牌失败: ${createTokenResult.error || "未知错误"}`,
      },
      500,
    );
  }

  const sudorouterKey = createTokenResult.data;

  // 记录创建令牌成功的 API 调用日志
  db.run(
    `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      adminUser.id,
      adminUser.phone,
      "SUDOROUTER_CREATE_TOKEN",
      "sudorouter_token",
      sudorouterUser.id,
      createTokenResult.request.method,
      createTokenResult.request.url,
      JSON.stringify(createTokenResult.request.body),
      JSON.stringify({
        success: true,
        key_preview: sudorouterKey.substring(0, 20) + "...",
      }),
      createTokenResult.response.status,
      createTokenResult.duration_ms,
    ],
  );

  // 计算初始积分
  const initialBalance = sudorouterService.quotaToPoints(initialQuota);

  // 创建本地用户
  const result = db.run(
    `INSERT INTO users (
      phone, nickname, enterprise_id, role, status,
      sudorouter_user_id, sudorouter_key, invitation_code_id,
      quota, used_quota, balance, password_hash
    ) VALUES (?, ?, ?, 'USER', 1, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      phone,
      nickname || phone,
      enterprise_id,
      sudorouterUser.id,
      sudorouterKey,
      invitation_code_id,
      initialQuota,
      0,
      initialBalance,
    ],
  );

  const newUserId = result.lastInsertRowid;

  // 标记邀请码已使用
  db.run(
    "UPDATE invitation_codes SET status = 1, used_by_user_id = ?, used_at = datetime('now') WHERE id = ?",
    [newUserId, invitation_code_id],
  );

  // 创建初始积分流水
  db.run(
    "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
    [newUserId, initialBalance, "BONUS", "新用户注册赠送"],
  );

  // 记录用户创建操作日志（汇总）
  db.run(
    `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      adminUser.id,
      adminUser.phone,
      "USER_CREATE",
      "user",
      newUserId,
      "POST",
      "/api/v1/admin/users",
      JSON.stringify({
        phone,
        nickname,
        enterprise_id,
        invitation_code_id,
      }),
      JSON.stringify({
        id: newUserId,
        phone,
        sudorouter_user_id: sudorouterUser.id,
        initial_points: initialBalance,
        quota: initialQuota,
      }),
    ],
  );

  return c.json({
    success: true,
    msg: "用户创建成功",
    data: {
      id: newUserId,
      phone,
      sudorouter_user_id: sudorouterUser.id,
      initial_points: initialBalance,
    },
  });
});

// PUT /api/v1/admin/users/:id - Update user
adminUserRoutes.put(
  "/users/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;
    const { nickname, status, enterprise_id } = await c.req.json();

    // 获取更新前的用户信息
    const oldUser = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(id) as any;

    db.run(
      `UPDATE users SET nickname = COALESCE(?, nickname),
        status = COALESCE(?, status), enterprise_id = COALESCE(?, enterprise_id)
     WHERE id = ?`,
      [nickname, status, enterprise_id, id],
    );

    // 获取更新后的用户信息
    const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;

    // 记录操作日志（包含更新前后对比）
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminUser.id,
        adminUser.phone,
        "USER_UPDATE",
        "user",
        id,
        "PUT",
        `/api/v1/admin/users/${id}`,
        JSON.stringify({ nickname, status, enterprise_id }),
        JSON.stringify({
          before: {
            nickname: oldUser?.nickname,
            status: oldUser?.status,
            enterprise_id: oldUser?.enterprise_id,
          },
          after: {
            nickname: newUser?.nickname,
            status: newUser?.status,
            enterprise_id: newUser?.enterprise_id,
          },
        }),
      ],
    );

    return c.json({
      success: true,
      msg: "用户信息更新成功",
    });
  },
);

// POST /api/v1/admin/users/:id/role - Set user role
adminUserRoutes.post(
  "/users/:id/role",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const id = c.req.param("id") as string;
    const { role } = await c.req.json();

    if (!["USER", "ENTERPRISE_ADMIN"].includes(role)) {
      return c.json(
        {
          success: false,
          msg: "无效的角色",
        },
        400,
      );
    }

    db.run("UPDATE users SET role = ? WHERE id = ?", [role, id]);

    return c.json({
      success: true,
      msg: "角色更新成功",
    });
  },
);

// POST /api/v1/admin/users/:id/points - Adjust user points
adminUserRoutes.post(
  "/users/:id/points",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const id = c.req.param("id") as string;
    const { amount, reason, operation } = await c.req.json(); // operation: 'add' or 'subtract'

    if (!amount || amount <= 0) {
      return c.json(
        {
          success: false,
          msg: "积分数量必须大于 0",
        },
        400,
      );
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;

    if (!user) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    const actualAmount = operation === "subtract" ? -amount : amount;
    const newBalance = user.balance + actualAmount;

    if (newBalance < 0) {
      return c.json(
        {
          success: false,
          msg: "积分不足",
        },
        400,
      );
    }

    // Start transaction
    db.run("BEGIN TRANSACTION");

    try {
      // Update user balance
      db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, id]);

      // Create ledger record
      db.run(
        "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
        [
          id,
          actualAmount,
          operation === "add" ? "BONUS" : "CONSUME",
          reason || "管理员调整",
        ],
      );

      db.run("COMMIT");

      return c.json({
        success: true,
        msg: "积分调整成功",
        data: {
          newBalance,
          amount: actualAmount,
        },
      });
    } catch (error) {
      db.run("ROLLBACK");
      return c.json(
        {
          success: false,
          msg: "积分调整失败",
        },
        500,
      );
    }
  },
);

// POST /api/v1/admin/users/:id/manage - Enable/Disable user
adminUserRoutes.post(
  "/users/:id/manage",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;
    const { action } = await c.req.json(); // action: 'enable' or 'disable'

    if (!["enable", "disable"].includes(action)) {
      return c.json(
        {
          success: false,
          msg: "无效的操作，请使用 enable 或 disable",
        },
        400,
      );
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;

    if (!user) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    // 不能禁用超级管理员
    if (user.role === "SUPER_ADMIN") {
      return c.json({ success: false, msg: "不能禁用超级管理员" }, 403);
    }

    // 调用 sudorouter 管理接口
    if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
      const result = await sudorouterService.manageUser(
        user.sudorouter_user_id,
        action,
      );

      if (!result.success) {
        return c.json(
          { success: false, msg: result.message || "Sudorouter 操作失败" },
          500,
        );
      }
    }

    // 更新本地用户状态
    // status: 1=正常, 2=禁用
    const newStatus = action === "enable" ? 1 : 2;
    db.run("UPDATE users SET status = ? WHERE id = ?", [newStatus, id]);

    // 记录操作日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminUser.id,
        adminUser.phone,
        action === "enable" ? "USER_ENABLE" : "USER_DISABLE",
        "user",
        id,
        "POST",
        `/api/v1/admin/users/${id}/manage`,
        JSON.stringify({ action }),
        JSON.stringify({
          user_phone: user.phone,
          old_status: user.status,
          new_status: newStatus,
        }),
      ],
    );

    return c.json({
      success: true,
      msg: action === "enable" ? "用户已启用" : "用户已禁用",
      data: { status: newStatus },
    });
  },
);

// DELETE /api/v1/admin/users/:id - Delete user
adminUserRoutes.delete(
  "/users/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;

    // Check if user is admin
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;

    if (user?.role === "SUPER_ADMIN") {
      return c.json(
        {
          success: false,
          msg: "不能删除超级管理员",
        },
        403,
      );
    }

    // 记录操作日志（包含被删除用户的详细信息）
    if (user) {
      // 记录删除邀请码操作
      if (user.invitation_code_id) {
        const invitationCode = db
          .prepare("SELECT * FROM invitation_codes WHERE id = ?")
          .get(user.invitation_code_id) as any;
        db.run(
          `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            adminUser.id,
            adminUser.phone,
            "INVITATION_CODE_DELETE",
            "invitation_code",
            user.invitation_code_id,
            "DELETE",
            `/api/v1/admin/invitation-codes/${user.invitation_code_id}`,
            JSON.stringify({ deleted_with_user: id, user_phone: user.phone }),
            JSON.stringify({
              code: invitationCode?.code,
              enterprise_id: invitationCode?.enterprise_id,
            }),
          ],
        );
        db.run("DELETE FROM invitation_codes WHERE id = ?", [
          user.invitation_code_id,
        ]);
        console.log(
          `[Admin] 删除用户 ${id} 的邀请码: ${user.invitation_code_id}`,
        );
      }

      // 记录用户删除操作
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminUser.id,
          adminUser.phone,
          "USER_DELETE",
          "user",
          id,
          "DELETE",
          `/api/v1/admin/users/${id}`,
          JSON.stringify({ target_user_id: id }),
          JSON.stringify({
            phone: user.phone,
            nickname: user.nickname,
            sudorouter_user_id: user.sudorouter_user_id,
            sudorouter_key: user.sudorouter_key
              ? user.sudorouter_key.substring(0, 20) + "..."
              : null,
            invitation_code_id: user.invitation_code_id,
            balance: user.balance,
          }),
        ],
      );
    }

    // Delete user and ledger records
    db.run("DELETE FROM users WHERE id = ?", [id]);
    db.run("DELETE FROM ledger WHERE user_id = ?", [id]);

    return c.json({
      success: true,
      msg: "用户删除成功",
    });
  },
);

// GET /api/v1/admin/users/:id/ledger - User ledger
adminUserRoutes.get(
  "/users/:id/ledger",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const id = c.req.param("id") as string;
    const limit = parseInt(c.req.query("limit") || "20");

    const ledger = db
      .prepare(
        "SELECT * FROM ledger WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
      )
      .all(id, limit);

    return c.json({
      success: true,
      data: ledger,
    });
  },
);

export { adminUserRoutes };