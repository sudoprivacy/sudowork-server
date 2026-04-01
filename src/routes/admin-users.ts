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
  const createUserResult = await sudorouterService.createUserWithLog(phone,nickname);
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
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;
    const { amount, reason, operation, sync_sudorouter } = await c.req.json(); // operation: 'add' or 'subtract'

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

    // Calculate quota change
    const quotaDelta = sudorouterService.pointsToQuota(Math.abs(actualAmount));

    // Start transaction
    db.run("BEGIN EXCLUSIVE TRANSACTION");

    try {
      // 1. Sync sudorouter if user is bound and sync is requested
      let sudorouterSuccess = true;
      let sudorouterError: string | null = null;

      if (
        user.sudorouter_user_id &&
        sync_sudorouter !== false &&
        sudorouterService.isConfigured()
      ) {
        const quotaResult = await sudorouterService.updateUserQuotaWithLog(
          user.sudorouter_user_id,
          operation === "subtract" ? -quotaDelta : quotaDelta,
          reason || `管理员${operation === "subtract" ? "扣减" : "充值"}积分`,
        );

        sudorouterSuccess = quotaResult.success;
        sudorouterError = quotaResult.error || null;

        // Log sudorouter API call
        db.run(
          `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            adminUser.id,
            adminUser.phone,
            "SUDOROUTER_QUOTA_UPDATE",
            "sudorouter_quota",
            user.sudorouter_user_id,
            quotaResult.request.method,
            quotaResult.request.url,
            JSON.stringify(quotaResult.request.body),
            JSON.stringify(quotaResult.response.data),
            quotaResult.response.status,
            quotaResult.duration_ms,
            sudorouterSuccess ? null : sudorouterError,
          ],
        );
      }

      // 2. Update local user data
      const newQuota =
        operation === "subtract"
          ? Math.max(0, (user.quota || 0) - quotaDelta)
          : (user.quota || 0) + quotaDelta;

      db.run("UPDATE users SET balance = ?, quota = ? WHERE id = ?", [
        newBalance,
        newQuota,
        id,
      ]);

      // 3. Write ledger record
      const ledgerType =
        operation === "subtract"
          ? user.sudorouter_user_id && !sudorouterSuccess
            ? "ADMIN_DEDUCT_PENDING"
            : "CONSUME"
          : user.sudorouter_user_id && !sudorouterSuccess
            ? "ADMIN_RECHARGE_PENDING"
            : "BONUS";

      db.run(
        "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
        [id, actualAmount, ledgerType, reason || `管理员${operation === "subtract" ? "扣减" : "充值"}`],
      );

      // 4. Log operation
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminUser.id,
          adminUser.phone,
          "ADMIN_POINTS_ADJUST",
          "user",
          id,
          "POST",
          `/api/v1/admin/users/${id}/points`,
          JSON.stringify({ amount, operation, reason }),
          JSON.stringify({ newBalance, newQuota, sudorouterSynced: sudorouterSuccess }),
        ],
      );

      db.run("COMMIT");

      return c.json({
        success: true,
        msg: sudorouterSuccess
          ? "积分调整成功"
          : "积分调整成功，但 sudorouter 同步失败，请检查",
        data: {
          newBalance,
          newQuota,
          amount: actualAmount,
          sudorouter_synced: sudorouterSuccess,
          sudorouter_error: sudorouterError,
        },
      });
    } catch (error) {
      db.run("ROLLBACK");
      console.error("[Admin] Points adjustment failed:", error);
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

// POST /api/v1/admin/users/:id/recharge - Admin recharge (后台充值积分)
adminUserRoutes.post(
  "/users/:id/recharge",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;
    const { points, reason, payment_reference } = await c.req.json();

    // Validate
    if (!points || points <= 0) {
      return c.json({ success: false, msg: "充值积分必须大于 0" }, 400);
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (!user) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    if (!user.sudorouter_user_id) {
      return c.json({ success: false, msg: "用户未绑定 sudorouter 账号" }, 400);
    }

    // Calculate quota
    const quotaDelta = sudorouterService.pointsToQuota(points);

    // Begin transaction
    db.run("BEGIN EXCLUSIVE TRANSACTION");

    try {
      // 1. Update sudorouter quota
      const quotaResult = await sudorouterService.updateUserQuotaWithLog(
        user.sudorouter_user_id,
        quotaDelta,
        reason || "后台充值",
      );

      if (!quotaResult.success) {
        db.run("ROLLBACK");
        return c.json(
          {
            success: false,
            msg: `sudorouter 额度更新失败: ${quotaResult.error}`,
          },
          500,
        );
      }

      // 2. Update local user data
      const newQuota = (user.quota || 0) + quotaDelta;
      const newBalance = user.balance + points;

      db.run("UPDATE users SET balance = ?, quota = ? WHERE id = ?", [
        newBalance,
        newQuota,
        id,
      ]);

      // 3. Write admin recharge record
      db.run(
        `INSERT INTO admin_recharge_records (
          user_id, admin_id, points, quota, reason,
          payment_reference, sudorouter_user_id, sudorouter_success
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          adminUser.id,
          points,
          quotaDelta,
          reason,
          payment_reference,
          user.sudorouter_user_id,
          true,
        ],
      );

      // 4. Write ledger
      // 活动赠送记录为 BONUS 类型，其他为 ADMIN_RECHARGE
      const ledgerType = reason === "活动赠送" ? "BONUS" : "ADMIN_RECHARGE";
      db.run(
        "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
        [id, points, ledgerType, reason || "后台充值"],
      );

      // 5. Log operation
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminUser.id,
          adminUser.phone,
          "ADMIN_RECHARGE",
          "user",
          id,
          "POST",
          `/api/v1/admin/users/${id}/recharge`,
          JSON.stringify({ points, reason, payment_reference }),
          JSON.stringify({ points, quota: quotaDelta, newBalance, newQuota }),
        ],
      );

      db.run("COMMIT");

      return c.json({
        success: true,
        msg: "充值成功",
        data: { points, quota: quotaDelta, newBalance, newQuota },
      });
    } catch (error) {
      db.run("ROLLBACK");
      console.error("[Admin] Recharge failed:", error);
      return c.json({ success: false, msg: "充值失败" }, 500);
    }
  },
);

// POST /api/v1/admin/users/:id/sync-quota - Sync user quota (同步用户额度)
adminUserRoutes.post(
  "/users/:id/sync-quota",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (!user) {
      return c.json({ success: false, msg: "用户不存在" }, 404);
    }

    if (!user.sudorouter_user_id) {
      return c.json({ success: false, msg: "用户未绑定 sudorouter" }, 400);
    }

    // Get latest quota from sudorouter
    const sudorouterUser = await sudorouterService.getUser(user.sudorouter_user_id);
    if (!sudorouterUser) {
      return c.json(
        { success: false, msg: "获取 sudorouter 用户信息失败" },
        500,
      );
    }

    const quota = sudorouterUser.quota || 0;
    const usedQuota = sudorouterUser.used_quota || 0;
    const balance = sudorouterService.quotaToPoints(quota);

    // Update local data
    db.run(
      "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
      [quota, usedQuota, balance, id],
    );

    // Log operation
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminUser.id,
        adminUser.phone,
        "USER_SYNC_QUOTA",
        "user",
        id,
        "POST",
        `/api/v1/admin/users/${id}/sync-quota`,
        JSON.stringify({ sudorouter_user_id: user.sudorouter_user_id }),
        JSON.stringify({ quota, used_quota: usedQuota, balance }),
      ],
    );

    return c.json({
      success: true,
      msg: "额度同步成功",
      data: {
        quota,
        used_quota: usedQuota,
        balance,
        total_points: sudorouterService.quotaToPoints(quota + usedQuota),
      },
    });
  },
);

// POST /api/v1/admin/recharge/orders/:id/retry - Retry failed order (重试失败订单)
adminUserRoutes.post(
  "/recharge/orders/:id/retry",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const orderId = c.req.param("id") as string;

    // Import recharge service
    const { rechargeService } = await import("../services/RechargeService.js");

    const result = await rechargeService.retryFailedOrder(
      parseInt(orderId),
      adminUser.id,
    );

    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }

    return c.json({
      success: true,
      msg: "订单重试成功",
    });
  },
);

// GET /api/v1/admin/recharge/orders - Get recharge orders list
adminUserRoutes.get(
  "/recharge/orders",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const status = c.req.query("status");
    const page = parseInt(c.req.query("page") || "1");
    const pageSize = parseInt(c.req.query("pageSize") || "20");
    const offset = (page - 1) * pageSize;

    let query = `
      SELECT ro.*, u.phone as user_phone, u.nickname as user_nickname
      FROM recharge_orders ro
      LEFT JOIN users u ON ro.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status !== undefined && status !== "") {
      query += " AND ro.status = ?";
      params.push(parseInt(status));
    }

    query += " ORDER BY ro.created_at DESC LIMIT ? OFFSET ?";
    params.push(pageSize, offset);

    const orders = db.prepare(query).all(...params) as any[];

    // Get total count
    let countQuery = "SELECT COUNT(*) as count FROM recharge_orders WHERE 1=1";
    const countParams: any[] = [];

    if (status !== undefined && status !== "") {
      countQuery += " AND status = ?";
      countParams.push(parseInt(status));
    }

    const total = db.prepare(countQuery).get(...countParams) as any;

    const statusText = ["待支付", "支付中", "支付成功", "支付失败", "已退款", "已取消"];

    return c.json({
      success: true,
      data: {
        list: orders.map((o) => ({
          id: o.id,
          order_no: o.order_no,
          user_id: o.user_id,
          user_phone: o.user_phone,
          user_nickname: o.user_nickname,
          amount_usd: o.amount_usd,
          amount_cny: o.amount_yuan,
          exchange_rate: o.exchange_rate,
          points: o.points_amount,
          bonus_points: o.bonus_points,
          payment_method: o.payment_method,
          status: o.status,
          status_text: statusText[o.status] || "未知",
          created_at: o.created_at,
          callback_time: o.callback_time,
          remark: o.remark,
        })),
        total: total.count,
        page,
        pageSize,
      },
    });
  },
);

// GET /api/v1/admin/recharge/orders/:orderNo - Get order detail
adminUserRoutes.get(
  "/recharge/orders/:orderNo",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const orderNo = c.req.param("orderNo");
    if (!orderNo) {
      return c.json({ success: false, msg: "订单号不能为空" }, 400);
    }

    const order = db
      .prepare(
        `SELECT ro.*, u.phone as user_phone, u.nickname as user_nickname
         FROM recharge_orders ro
         LEFT JOIN users u ON ro.user_id = u.id
         WHERE ro.order_no = ?`
      )
      .get(orderNo) as any;

    if (!order) {
      return c.json({ success: false, msg: "订单不存在" }, 404);
    }

    const statusText = ["待支付", "支付中", "支付成功", "支付失败", "已退款", "已取消"];

    return c.json({
      success: true,
      data: {
        order_no: order.order_no,
        user_id: order.user_id,
        user_phone: order.user_phone,
        user_nickname: order.user_nickname,
        amount_usd: order.amount_usd,
        amount_cny: order.amount_yuan,
        exchange_rate: order.exchange_rate,
        points: order.points_amount,
        bonus_points: order.bonus_points,
        quota: order.quota_amount,
        payment_method: order.payment_method,
        status: order.status,
        status_text: statusText[order.status] || "未知",
        created_at: order.created_at,
        callback_time: order.callback_time,
        expired_at: order.expired_at,
        remark: order.remark,
        fuiou_order_info: order.fuiou_order_info,
      },
    });
  },
);

// POST /api/v1/admin/recharge/simulate-payment/:orderNo - Simulate payment success (test mode only)
adminUserRoutes.post(
  "/recharge/simulate-payment/:orderNo",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const orderNo = c.req.param("orderNo");
    if (!orderNo) {
      return c.json({ success: false, msg: "订单号不能为空" }, 400);
    }

    const { rechargeService } = await import("../services/RechargeService.js");
    const result = await rechargeService.simulatePaymentSuccess(orderNo);

    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }

    return c.json({
      success: true,
      msg: "模拟支付成功",
      data: { order_no: result.order_no },
    });
  },
);

// POST /api/v1/admin/recharge/orders/:orderNo/refund - Refund order
adminUserRoutes.post(
  "/recharge/orders/:orderNo/refund",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const orderNo = c.req.param("orderNo");
    if (!orderNo) {
      return c.json({ success: false, msg: "订单号不能为空" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const reason = body.reason || "用户申请退款";

    const adminUser = (await getAuthUser(c)) as any;
    const { rechargeService } = await import("../services/RechargeService.js");

    const result = await rechargeService.refundOrder(orderNo, reason, adminUser.id);

    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }

    return c.json({
      success: true,
      msg: "退款成功",
      data: {
        refund_no: result.refund_no,
        refund_amount: result.refund_amount,
      },
    });
  },
);

// GET /api/v1/admin/recharge/refund-calc/:orderNo - Calculate refund amount
adminUserRoutes.get(
  "/recharge/refund-calc/:orderNo",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const orderNo = c.req.param("orderNo");
    if (!orderNo) {
      return c.json({ success: false, msg: "订单号不能为空" }, 400);
    }

    const { rechargeService } = await import("../services/RechargeService.js");
    const calc = rechargeService.calculateRefund(orderNo);

    if (!calc.success) {
      return c.json({ success: false, msg: calc.error }, 400);
    }

    return c.json({
      success: true,
      data: {
        order_points: calc.orderPoints,
        user_balance: calc.userBalance,
        used_points: calc.usedPoints,
        refund_amount: calc.refundAmount,
        refund_amount_yuan: (calc.refundAmount / 100).toFixed(2),
        deduct_points: calc.deductPoints,
        original_amount: calc.originalAmount,
        original_amount_yuan: (calc.originalAmount / 100).toFixed(2),
      },
    });
  },
);

// GET /api/v1/admin/recharge/stats - Recharge statistics
adminUserRoutes.get(
  "/recharge/stats",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    // 总体统计
    const totalStats = db
      .prepare(
        `SELECT
          COUNT(*) as total_orders,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as total_amount_usd,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as total_amount_cny,
          COALESCE(SUM(CASE WHEN status = 2 THEN points_amount ELSE 0 END), 0) as total_points,
          COALESCE(SUM(CASE WHEN status = 2 THEN bonus_points ELSE 0 END), 0) as total_bonus,
          COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0) as success_count,
          COALESCE(SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END), 0) as failed_count,
          COALESCE(SUM(CASE WHEN status IN (0, 1) THEN 1 ELSE 0 END), 0) as pending_count
        FROM recharge_orders`
      )
      .get() as any;

    // 今日统计
    const today = new Date().toISOString().slice(0, 10);
    const todayStats = db
      .prepare(
        `SELECT
          COUNT(*) as today_orders,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as today_amount_usd,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as today_amount_cny,
          COALESCE(SUM(CASE WHEN status = 2 THEN points_amount ELSE 0 END), 0) as today_points
        FROM recharge_orders
        WHERE date(created_at) = ?`
      )
      .get(today) as any;

    // 按支付方式统计
    const paymentStats = db
      .prepare(
        `SELECT
          payment_method,
          COUNT(*) as count,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as amount_usd,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as amount_cny
        FROM recharge_orders
        WHERE status = 2
        GROUP BY payment_method`
      )
      .all() as any[];

    // 按日期统计最近7天
    const dailyStats = db
      .prepare(
        `SELECT
          date(created_at) as date,
          COUNT(*) as orders,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as amount_usd,
          COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as amount_cny
        FROM recharge_orders
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY date(created_at)
        ORDER BY date DESC`
      )
      .all() as any[];

    return c.json({
      success: true,
      data: {
        total: {
          orders: totalStats.total_orders || 0,
          amount_usd: totalStats.total_amount_usd || 0,
          amount_cny: totalStats.total_amount_cny || 0,
          points: totalStats.total_points || 0,
          bonus: totalStats.total_bonus || 0,
          success_count: totalStats.success_count || 0,
          failed_count: totalStats.failed_count || 0,
          pending_count: totalStats.pending_count || 0,
        },
        today: {
          orders: todayStats.today_orders || 0,
          amount_usd: todayStats.today_amount_usd || 0,
          amount_cny: todayStats.today_amount_cny || 0,
          points: todayStats.today_points || 0,
        },
        by_payment: {
          ALIPAY: paymentStats.find((p) => p.payment_method === "ALIPAY") || {
            count: 0,
            amount_usd: 0,
            amount_cny: 0,
          },
          WECHAT: paymentStats.find((p) => p.payment_method === "WECHAT") || {
            count: 0,
            amount_usd: 0,
            amount_cny: 0,
          },
        },
        daily: dailyStats,
      },
    });
  }
);

// GET /api/v1/admin/recharge-records - Get all recharge records (client + admin)
adminUserRoutes.get(
  "/recharge-records",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const page = parseInt(c.req.query("page") || "1");
    const pageSize = parseInt(c.req.query("pageSize") || "20");
    const offset = (page - 1) * pageSize;

    // Client recharge records (from recharge_records via recharge_orders)
    const clientRecords = db
      .prepare(
        `SELECT
          rr.id,
          'CLIENT' as type,
          ro.order_no,
          u.phone as user_phone,
          u.nickname as user_nickname,
          rr.balance_delta as points,
          rr.quota_delta as quota,
          ro.amount_yuan as amount_cny,
          ro.payment_method,
          ro.created_at,
          rr.created_at as processed_at
        FROM recharge_records rr
        JOIN recharge_orders ro ON rr.order_id = ro.id
        LEFT JOIN users u ON rr.user_id = u.id
        WHERE ro.status = 2
        ORDER BY rr.created_at DESC`
      )
      .all() as any[];

    // Admin recharge records
    const adminRecords = db
      .prepare(
        `SELECT
          arr.id,
          'ADMIN' as type,
          NULL as order_no,
          u.phone as user_phone,
          u.nickname as user_nickname,
          arr.points,
          arr.quota,
          NULL as amount_cny,
          NULL as payment_method,
          arr.created_at,
          arr.created_at as processed_at,
          a.nickname as admin_nickname,
          arr.reason,
          arr.payment_reference
        FROM admin_recharge_records arr
        LEFT JOIN users u ON arr.user_id = u.id
        LEFT JOIN users a ON arr.admin_id = a.id
        ORDER BY arr.created_at DESC`
      )
      .all() as any[];

    // Combine and sort by date
    const allRecords = [...clientRecords, ...adminRecords]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Paginate
    const total = allRecords.length;
    const list = allRecords.slice(offset, offset + pageSize);

    // Format response
    const formattedList = list.map((r) => ({
      id: r.id,
      type: r.type,
      order_no: r.order_no,
      user_phone: r.user_phone,
      user_nickname: r.user_nickname,
      points: r.points,
      quota: r.quota,
      amount_cny: r.amount_cny,
      payment_method: r.payment_method,
      admin_nickname: r.admin_nickname || null,
      reason: r.reason || null,
      created_at: r.created_at,
    }));

    return c.json({
      success: true,
      data: {
        list: formattedList,
        total,
        page,
        pageSize,
      },
    });
  }
);

// POST /api/v1/admin/recharge/sync - Sync all pending orders
adminUserRoutes.post(
  "/recharge/sync",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const { rechargeService } = await import("../services/RechargeService.js");
    const result = await rechargeService.syncAllPendingOrders();

    return c.json({
      success: true,
      data: result,
    });
  }
);

// POST /api/v1/admin/recharge/orders/:orderNo/sync - Sync single order status
adminUserRoutes.post(
  "/recharge/orders/:orderNo/sync",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const orderNo = c.req.param("orderNo");
    if (!orderNo) {
      return c.json({ success: false, msg: "订单号不能为空" }, 400);
    }

    const { rechargeService } = await import("../services/RechargeService.js");
    const result = await rechargeService.syncOrderStatus(orderNo);

    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }

    return c.json({
      success: true,
      data: { order_no: orderNo, status: result.status },
    });
  }
);

export { adminUserRoutes };