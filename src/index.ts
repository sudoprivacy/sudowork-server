import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { verify } from "hono/jwt";
import { sign } from "hono/jwt";
import { Database } from "bun:sqlite";
import { smsService } from "./services/SmsService";
import { sudorouterService } from "./services/SudorouterService";
import type { ApiCallResult } from "./services/SudorouterService";
import { hashPassword, verifyPassword } from "./utils/password";
import {
  authMiddleware,
  adminMiddleware,
  superAdminMiddleware,
  getAuthUser,
} from "./middleware/auth";
import { rateLimiter, rateLimitPresets } from "./middleware/rateLimiter";
import { serveStatic } from "hono/bun";
import { redis } from "./redis.js";

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

const db = new Database(process.env.DB_PATH || "/app/data/sudowork.db");
const SECRET = process.env.JWT_SECRET || "sudowork-secret-key";

// Serve static files from admin-dist
app.use("/assets/*", serveStatic({ root: "./admin-dist" }));
app.use("/favicon.svg", serveStatic({ root: "./admin-dist" }));
app.use("/icons.svg", serveStatic({ root: "./admin-dist" }));

// Serve index.html for root path
app.get("/", async (c) => {
  const file = Bun.file("./admin-dist/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html" },
  });
});

// --- Routes ---

// POST /api/v1/admin/login - Admin login
app.post("/api/v1/admin/login", rateLimiter(rateLimitPresets.login), async (c) => {
  const { phone, password } = await c.req.json();

  if (!phone || !password) {
    return c.json(
      {
        success: false,
        msg: "账号或密码不能为空",
      },
      400,
    );
  }

  // Query admin (allow phone='sudo' or phone number)
  const admin = db
    .prepare(
      `
    SELECT * FROM users 
    WHERE phone = ? 
    AND role IN ('SUPER_ADMIN', 'ENTERPRISE_ADMIN')
  `,
    )
    .get(phone);

  if (!admin) {
    return c.json(
      {
        success: false,
        msg: "账号不存在",
      },
      404,
    );
  }

  // Verify password
  const validPassword = await verifyPassword(
    password,
    (admin as any).password_hash,
  );
  if (!validPassword) {
    return c.json(
      {
        success: false,
        msg: "密码错误",
      },
      401,
    );
  }

  // Generate JWT Token
  const token = await sign(
    {
      id: (admin as any).id,
      phone: (admin as any).phone,
      role: (admin as any).role,
      enterprise_id: (admin as any).enterprise_id,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    },
    SECRET,
  );

  return c.json({
    success: true,
    data: {
      token,
      user: {
        id: (admin as any).id,
        phone: (admin as any).phone,
        nickname: (admin as any).nickname,
        role: (admin as any).role,
        avatar: null,
      },
    },
  });
});

// POST /api/v1/admin/change-password - Change password
app.post("/api/v1/admin/change-password", authMiddleware, async (c) => {
  const payload = c.get("user");

  const { oldPassword, newPassword } = await c.req.json();

  if (!oldPassword || !newPassword) {
    return c.json(
      {
        success: false,
        msg: "旧密码和新密码不能为空",
      },
      400,
    );
  }

  // Password strength validation
  if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(newPassword)) {
    return c.json(
      {
        success: false,
        msg: "密码必须至少 8 位，包含字母和数字",
      },
      400,
    );
  }

  // Get current user
  const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);

  if (!admin) {
    return c.json({ success: false, msg: "用户不存在" }, 404);
  }

  // Verify old password
  const validPassword = await verifyPassword(
    oldPassword,
    (admin as any).password_hash,
  );
  if (!validPassword) {
    return c.json(
      {
        success: false,
        msg: "旧密码错误",
      },
      401,
    );
  }

  // Update password
  const newPasswordHash = await hashPassword(newPassword);
  db.run(
    `
    UPDATE users 
    SET password_hash = ?, must_change_password = FALSE 
    WHERE id = ?
  `,
    [newPasswordHash, payload.id],
  );

  return c.json({
    success: true,
    msg: "密码修改成功",
  });
});

// GET /api/v1/admin/stats - Dashboard statistics
app.get("/api/v1/admin/stats", authMiddleware, adminMiddleware, async (c) => {
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

// GET /api/v1/admin/enterprises - Enterprise list
app.get(
  "/api/v1/admin/enterprises",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const enterprises = db
      .prepare("SELECT * FROM enterprises ORDER BY id DESC")
      .all();

    // Get user count for each enterprise
    const enterprisesWithCount = (enterprises as any[]).map((ent) => {
      const userCount = db
        .prepare("SELECT COUNT(*) as count FROM users WHERE enterprise_id = ?")
        .get(ent.id) as any;
      return {
        ...ent,
        userCount: userCount?.count || 0,
      };
    });

    return c.json({
      success: true,
      data: enterprisesWithCount,
    });
  },
);

// POST /api/v1/admin/enterprises - Create enterprise
app.post(
  "/api/v1/admin/enterprises",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const { name, code, credit_pool } = await c.req.json();

    if (!name || !code) {
      return c.json(
        {
          success: false,
          msg: "企业名称和企业码不能为空",
        },
        400,
      );
    }

    // Check if code already exists
    const existing = db
      .prepare("SELECT * FROM enterprises WHERE code = ?")
      .get(code);

    if (existing) {
      return c.json(
        {
          success: false,
          msg: "企业码已存在",
        },
        400,
      );
    }

    db.run(
      "INSERT INTO enterprises (name, code, credit_pool) VALUES (?, ?, ?)",
      [name, code, credit_pool || 10000],
    );

    return c.json({
      success: true,
      msg: "企业创建成功",
    });
  },
);

// PUT /api/v1/admin/enterprises/:id - Update enterprise
app.put(
  "/api/v1/admin/enterprises/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const id = c.req.param("id") as string;
    const { name, credit_pool } = await c.req.json();

    if (!name) {
      return c.json(
        {
          success: false,
          msg: "企业名称不能为空",
        },
        400,
      );
    }

    db.run(
      "UPDATE enterprises SET name = ?, credit_pool = ? WHERE id = ?",
      [name, credit_pool ?? 10000, id],
    );

    return c.json({
      success: true,
      msg: "企业更新成功",
    });
  },
);

// DELETE /api/v1/admin/enterprises/:id - Delete enterprise
app.delete(
  "/api/v1/admin/enterprises/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const id = c.req.param("id") as string;

    // Check if enterprise has users
    const userCount = db
      .prepare("SELECT COUNT(*) as count FROM users WHERE enterprise_id = ?")
      .get(id) as any;

    if (userCount?.count > 0) {
      return c.json(
        {
          success: false,
          msg: "企业下还有用户，无法删除",
        },
        400,
      );
    }

    db.run("DELETE FROM enterprises WHERE id = ?", [id]);

    return c.json({
      success: true,
      msg: "企业删除成功",
    });
  },
);

// ==================== 邀请码管理接口 ====================

// 生成6位数字+字母邀请码
function generateInvitationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除易混淆的 I, O, 0, 1
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/v1/admin/invitation-codes - 获取邀请码列表
app.get(
  "/api/v1/admin/invitation-codes",
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
app.post(
  "/api/v1/admin/invitation-codes",
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
        JSON.stringify({ codes, count: codes.length })
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
app.delete(
  "/api/v1/admin/invitation-codes/:id",
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
        JSON.stringify({ code: code.code, enterprise_id: code.enterprise_id, status: code.status })
      ],
    );

    return c.json({
      success: true,
      msg: "邀请码删除成功",
    });
  },
);

// GET /api/v1/admin/invitation-codes/available - 获取可用邀请码
app.get(
  "/api/v1/admin/invitation-codes/available",
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

// ==================== 用户管理接口 ====================
app.get("/api/v1/admin/users", authMiddleware, adminMiddleware, async (c) => {
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

  // 同步每个用户的额度信息（从 sudorouter）
  if (sudorouterService.isConfigured()) {
    for (const user of users) {
      if (user.sudorouter_user_id) {
        try {
          const sudorouterUser = await sudorouterService.getUser(user.sudorouter_user_id);
          if (sudorouterUser) {
            const quota = sudorouterUser.quota || 0;
            const usedQuota = sudorouterUser.used_quota || 0;
            const remainingPoints = sudorouterService.quotaToPoints(quota);
            const usedPoints = sudorouterService.quotaToPoints(usedQuota);

            // 更新本地用户额度
            db.run(
              "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
              [quota, usedQuota, remainingPoints, user.id],
            );

            // 更新返回数据
            user.quota = quota;
            user.used_quota = usedQuota;
            user.balance = remainingPoints;
          }
        } catch (error) {
          console.error(`[Admin] 同步用户 ${user.id} 额度失败:`, error);
        }
      }
    }
  }

  return c.json({
    success: true,
    data: users,
  });
});

// POST /api/v1/admin/users - Create user
app.post("/api/v1/admin/users", authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as any;
  const { phone, nickname, enterprise_id, invitation_code_id } = await c.req.json();

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
        createUserResult.error || "创建用户失败"
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
      createUserResult.duration_ms
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
      quotaResult.success ? null : quotaResult.error
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
        createTokenResult.error || "创建令牌失败"
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
      JSON.stringify({ success: true, key_preview: sudorouterKey.substring(0, 20) + "..." }),
      createTokenResult.response.status,
      createTokenResult.duration_ms
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
      JSON.stringify({ phone, nickname, enterprise_id, invitation_code_id }),
      JSON.stringify({
        id: newUserId,
        phone,
        sudorouter_user_id: sudorouterUser.id,
        initial_points: initialBalance,
        quota: initialQuota
      })
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
app.put(
  "/api/v1/admin/users/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as any;
    const id = c.req.param("id") as string;
    const { nickname, status, enterprise_id } = await c.req.json();

    // 获取更新前的用户信息
    const oldUser = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;

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
            enterprise_id: oldUser?.enterprise_id
          },
          after: {
            nickname: newUser?.nickname,
            status: newUser?.status,
            enterprise_id: newUser?.enterprise_id
          }
        })
      ],
    );

    return c.json({
      success: true,
      msg: "用户信息更新成功",
    });
  },
);

// POST /api/v1/admin/users/:id/role - Set user role
app.post(
  "/api/v1/admin/users/:id/role",
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
app.post(
  "/api/v1/admin/users/:id/points",
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
app.post(
  "/api/v1/admin/users/:id/manage",
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
        action
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
          new_status: newStatus
        })
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
app.delete(
  "/api/v1/admin/users/:id",
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
        const invitationCode = db.prepare("SELECT * FROM invitation_codes WHERE id = ?").get(user.invitation_code_id) as any;
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
            JSON.stringify({ code: invitationCode?.code, enterprise_id: invitationCode?.enterprise_id })
          ],
        );
        db.run("DELETE FROM invitation_codes WHERE id = ?", [user.invitation_code_id]);
        console.log(`[Admin] 删除用户 ${id} 的邀请码: ${user.invitation_code_id}`);
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
            sudorouter_key: user.sudorouter_key ? user.sudorouter_key.substring(0, 20) + "..." : null,
            invitation_code_id: user.invitation_code_id,
            balance: user.balance
          })
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
app.get(
  "/api/v1/admin/users/:id/ledger",
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

// POST /api/v1/auth/send-code - Send SMS verification code
db.run(`
  CREATE TABLE IF NOT EXISTS enterprises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    code TEXT UNIQUE,
    credit_pool REAL DEFAULT 10000
  );
`);

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

// 邀请码表
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

// 操作日志表
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

// 创建索引
db.run(`CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_invitation_codes_status ON invitation_codes(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_operation_logs_user_id ON operation_logs(user_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_operation_logs_action ON operation_logs(action)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at)`);

// 为 users 表添加新字段
const addColumnIfNotExists = (table: string, column: string, type: string) => {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.find((c) => c.name === column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (e) {
    // Column might already exist
  }
};

addColumnIfNotExists("users", "sudorouter_user_id", "INTEGER");
addColumnIfNotExists("users", "sudorouter_key", "TEXT");
addColumnIfNotExists("users", "invitation_code_id", "INTEGER");
addColumnIfNotExists("users", "quota", "INTEGER DEFAULT 0");
addColumnIfNotExists("users", "used_quota", "INTEGER DEFAULT 0");
addColumnIfNotExists("operation_logs", "request_data", "TEXT");
addColumnIfNotExists("operation_logs", "response_data", "TEXT");

// 数据清理：只保留 sudo 企业（已禁用，不再自动清理）
const cleanupData = () => {
  // 已禁用自动清理，避免丢失用户数据
  console.log("=== 数据清理已跳过 ===");
};
cleanupData();

// 初始化 sudo 企业
const initEnterprise = () => {
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
};
initEnterprise();

// Initialize super admin
const initSuperAdmin = async () => {
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
};

await initSuperAdmin();

// Helper function to validate phone number format
function isValidPhone(phone: string): boolean {
  // Support two formats:
  // 1. Simple format: 11 digits, starting with 1 (e.g., 13800138000)
  // 2. E.164 format: +[country code][phone number] (e.g., +8613800138000)

  if (phone.length === 11) {
    return phone[0] === "1" && /^\d{11}$/.test(phone);
  } else if (phone.length >= 13 && phone[0] === "+") {
    if (!phone.startsWith("+86")) return false;
    const phoneNumber = phone.slice(3);
    return (
      phoneNumber.length === 11 &&
      phoneNumber[0] === "1" &&
      /^\d{11}$/.test(phoneNumber)
    );
  }
  return false;
}

// --- Routes ---

// POST /api/v1/auth/send-code - Send SMS verification code (仅手机号级别限制，在 SmsService 中实现)
app.post("/api/v1/auth/send-code", async (c) => {
  const { phone } = await c.req.json();

  if (!phone) {
    return c.json(
      {
        success: false,
        msg: "手机号不能为空",
      },
      400,
    );
  }

  // Validate phone format
  if (!isValidPhone(phone)) {
    return c.json(
      {
        success: false,
        msg: "手机号格式不正确",
      },
      400,
    );
  }

  const result = await smsService.sendCode(phone);

  if (result.success) {
    return c.json({
      success: true,
      msg: "验证码已发送",
      expire: result.expire,
      next_send_in: result.nextSendIn,
      daily_remaining: result.dailyRemaining,
    });
  }

  return c.json(
    {
      success: false,
      msg: result.message,
      next_send_in: result.nextSendIn,
    },
    result.message?.includes("频繁") ? 429 : 500,
  );
});

// POST /api/v1/auth/login - Login with SMS code (invitation_code optional for two-stage login)
app.post("/api/v1/auth/login", rateLimiter(rateLimitPresets.login), async (c) => {
  const { phone, code, invitation_code, enterprise_code } = await c.req.json();

  // 参数验证 - invitation_code 改为可选
  if (!phone || !code) {
    return c.json(
      {
        success: false,
        msg: "参数不完整",
      },
      400,
    );
  }

  // 验证手机号格式
  if (!isValidPhone(phone)) {
    return c.json(
      {
        success: false,
        msg: "手机号格式不正确",
      },
      400,
    );
  }

  // 验证短信验证码格式
  if (!/^\d{6}$/.test(code)) {
    return c.json(
      {
        success: false,
        msg: "验证码格式不正确",
      },
      400,
    );
  }

  // 验证短信验证码
  const verifyResult = await smsService.verifyCode(phone, code);
  if (!verifyResult.success) {
    return c.json(
      {
        success: false,
        msg: verifyResult.message,
      },
      400,
    );
  }

  // 获取默认企业
  const enterprise = db
    .prepare("SELECT * FROM enterprises WHERE code = 'sudo'")
    .get() as any;

  if (!enterprise) {
    return c.json(
      {
        success: false,
        msg: "系统配置错误",
      },
      500,
    );
  }

  // 查询用户是否存在
  let user = db
    .prepare("SELECT * FROM users WHERE phone = ?")
    .get(phone) as any;

  if (user) {
    // 检查用户是否被禁用 (status: 2=禁用)
    if (user.status === 2) {
      return c.json(
        {
          success: false,
          msg: "该账户已被禁用，请联系管理员",
        },
        403,
      );
    }

    // 用户已存在，直接登录（不再验证邀请码）
    // 从 sudorouter 同步用户额度（并行获取用户信息和模型列表）
    let totalPoints = 0;
    let usedPoints = 0;
    let remainingPoints = 0;
    const bonusPoints = sudorouterService.getInitialPoints(); // 赠送积分

    // 并行调用：获取用户信息 + 获取可用模型
    const [getUserResult, models] = user.sudorouter_user_id && sudorouterService.isConfigured()
      ? await Promise.all([
          sudorouterService.getUserWithLog(user.sudorouter_user_id),
          sudorouterService.getAvailableModels()
        ])
      : [null, await sudorouterService.getAvailableModels()];

    if (getUserResult) {
      try {
        if (getUserResult.success && getUserResult.data) {
          const sudorouterUserInfo = getUserResult.data;
          totalPoints = sudorouterService.quotaToPoints(sudorouterUserInfo.quota || 0);
          usedPoints = sudorouterService.quotaToPoints(sudorouterUserInfo.used_quota || 0);
          remainingPoints = totalPoints - usedPoints;

          // 更新本地数据库
          db.run(
            "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
            [sudorouterUserInfo.quota, sudorouterUserInfo.used_quota, remainingPoints, user.id]
          );

          // 记录 Sudorouter API 调用日志
          db.run(
            `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              user.id, phone, "SUDOROUTER_GET_USER", "sudorouter_api", user.sudorouter_user_id,
              getUserResult.request.method, getUserResult.request.url,
              JSON.stringify({ user_id: user.sudorouter_user_id }),
              JSON.stringify({ success: true, quota: sudorouterUserInfo.quota, used_quota: sudorouterUserInfo.used_quota }),
              getUserResult.response.status, getUserResult.duration_ms
            ]
          );
        } else {
          // 记录失败日志
          db.run(
            `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms, error_message)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              user.id, phone, "SUDOROUTER_GET_USER", "sudorouter_api", user.sudorouter_user_id,
              getUserResult.request.method, getUserResult.request.url,
              JSON.stringify({ user_id: user.sudorouter_user_id }),
              JSON.stringify(getUserResult.response.data),
              getUserResult.response.status, getUserResult.duration_ms,
              getUserResult.error || "获取用户信息失败"
            ]
          );
        }
      } catch (error) {
        console.error(`[Login] 同步用户 ${phone} 额度失败:`, error);
        // 使用本地缓存数据
        totalPoints = sudorouterService.quotaToPoints(user.quota || 0);
        usedPoints = sudorouterService.quotaToPoints(user.used_quota || 0);
        remainingPoints = totalPoints - usedPoints;
      }
    }

    // 登录成功
    const token = await sign(
      {
        id: user.id,
        phone: user.phone,
        role: user.role,
        enterprise_id: user.enterprise_id,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
      SECRET,
    );

    // 获取模型服务配置
    const modelServiceUrl = sudorouterService.getModelServiceUrl();

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          phone: user.phone,
          nickname: user.nickname,
          role: user.role,
          status: user.status,
          enterprise_code: enterprise.code,
          sudorouter_key: user.sudorouter_key ? `sk-${user.sudorouter_key}` : null,
          model_service_url: modelServiceUrl,
          models: models,
          points: {
            total: totalPoints,
            used: usedPoints,
            remaining: remainingPoints,
            bonus: bonusPoints,
          },
        },
      },
    });
  }

  // 用户不存在，生成 register_token 并返回
  // 生成 32 位随机 token
  const registerToken = crypto.randomUUID().replace(/-/g, '');

  // 将 register_token 存入 Redis，10 分钟有效
  await redis.setex(`register_token:${registerToken}`, 600, JSON.stringify({
    phone,
    verified: true,
    created_at: Date.now()
  }));

  console.log(`[Login] 用户不存在，生成 register_token: ${registerToken.substring(0, 8)}... 手机号: ${phone}`);

  return c.json({
    success: false,
    need_register: true,
    register_token: registerToken,
    phone: phone,
    msg: "用户不存在，请先注册"
  });
});

// POST /api/v1/auth/register - Register new user with register_token
app.post("/api/v1/auth/register", rateLimiter(rateLimitPresets.login), async (c) => {
  const { register_token, nickname, invitation_code } = await c.req.json();

  // 参数验证
  if (!register_token || !nickname || !invitation_code) {
    return c.json(
      {
        success: false,
        msg: "参数不完整",
      },
      400,
    );
  }

  // 验证 register_token
  const tokenDataStr = await redis.get(`register_token:${register_token}`);
  if (!tokenDataStr) {
    return c.json(
      {
        success: false,
        msg: "注册凭证无效或已过期，请重新获取验证码",
      },
      400,
    );
  }

  const tokenData = JSON.parse(tokenDataStr);
  const phone = tokenData.phone;

  // 检查用户是否已被创建（防止重复注册）
  const existingUser = db
    .prepare("SELECT * FROM users WHERE phone = ?")
    .get(phone) as any;

  if (existingUser) {
    // 删除 register_token
    await redis.del(`register_token:${register_token}`);
    return c.json(
      {
        success: false,
        msg: "该手机号已注册，请直接登录",
      },
      400,
    );
  }

  // 验证邀请码
  const invitationCode = db
    .prepare("SELECT * FROM invitation_codes WHERE code = ?")
    .get(invitation_code) as any;

  if (!invitationCode) {
    return c.json(
      {
        success: false,
        msg: "邀请码不存在",
      },
      400,
    );
  }

  if (invitationCode.status === 1) {
    return c.json(
      {
        success: false,
        msg: "邀请码已被使用",
      },
      400,
    );
  }

  // 获取默认企业
  const enterprise = db
    .prepare("SELECT * FROM enterprises WHERE code = 'sudo'")
    .get() as any;

  if (!enterprise) {
    return c.json(
      {
        success: false,
        msg: "系统配置错误",
      },
      500,
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

  // 调用 sudorouter 创建用户
  const createUserResult = await sudorouterService.createUserWithLog(phone);
  if (!createUserResult.success || !createUserResult.data) {
    // 记录失败日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, method, path, request_data, response_data, response_status, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        0, phone, "SUDOROUTER_CREATE_USER", "sudorouter_api",
        createUserResult.request.method, createUserResult.request.url,
        JSON.stringify(createUserResult.request.body),
        JSON.stringify(createUserResult.response.data),
        createUserResult.response.status, createUserResult.duration_ms,
        createUserResult.error || "创建用户失败"
      ]
    );
    return c.json(
      {
        success: false,
        msg: "创建用户失败，请稍后重试",
      },
      500,
    );
  }

  const sudorouterUser = createUserResult.data;

  // 记录创建用户成功日志
  db.run(
    `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      0, phone, "SUDOROUTER_CREATE_USER", "sudorouter_api", sudorouterUser.id,
      createUserResult.request.method, createUserResult.request.url,
      JSON.stringify(createUserResult.request.body),
      JSON.stringify({ success: true, id: sudorouterUser.id, username: sudorouterUser.username }),
      createUserResult.response.status, createUserResult.duration_ms
    ]
  );

  // 充值初始额度
  const initialQuota = sudorouterService.getInitialQuota();
  const quotaResult = await sudorouterService.updateUserQuotaWithLog(
    sudorouterUser.id,
    initialQuota,
    "新用户注册赠送额度"
  );

  if (!quotaResult.success) {
    // 记录失败日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        0, phone, "SUDOROUTER_UPDATE_QUOTA", "sudorouter_api", sudorouterUser.id,
        quotaResult.request.method, quotaResult.request.url,
        JSON.stringify(quotaResult.request.body),
        JSON.stringify(quotaResult.response.data),
        quotaResult.response.status, quotaResult.duration_ms,
        quotaResult.error || "额度充值失败"
      ]
    );
    console.error(`[Register] 用户 ${phone} 额度充值失败`);
  } else {
    // 记录成功日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        0, phone, "SUDOROUTER_UPDATE_QUOTA", "sudorouter_api", sudorouterUser.id,
        quotaResult.request.method, quotaResult.request.url,
        JSON.stringify(quotaResult.request.body),
        JSON.stringify({ success: true, quota: initialQuota }),
        quotaResult.response.status, quotaResult.duration_ms
      ]
    );
    console.log(`[Register] 用户 ${phone} 充值成功: ${initialQuota}`);
  }

  // 调用 sudorouter 创建令牌
  const createTokenResult = await sudorouterService.createTokenWithLog(
    sudorouterUser.id,
    phone,
    true, // unlimited_quota
  );

  if (!createTokenResult.success || !createTokenResult.data) {
    // 记录失败日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        0, phone, "SUDOROUTER_CREATE_TOKEN", "sudorouter_api", sudorouterUser.id,
        createTokenResult.request.method, createTokenResult.request.url,
        JSON.stringify(createTokenResult.request.body),
        JSON.stringify(createTokenResult.response.data),
        createTokenResult.response.status, createTokenResult.duration_ms,
        createTokenResult.error || "创建令牌失败"
      ]
    );
    return c.json(
      {
        success: false,
        msg: "创建令牌失败，请稍后重试",
      },
      500,
    );
  }

  const sudorouterKey = createTokenResult.data;

  // 记录创建令牌成功日志
  db.run(
    `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      0, phone, "SUDOROUTER_CREATE_TOKEN", "sudorouter_api", sudorouterUser.id,
      createTokenResult.request.method, createTokenResult.request.url,
      JSON.stringify(createTokenResult.request.body),
      JSON.stringify({ success: true, key_preview: sudorouterKey.substring(0, 20) + "..." }),
      createTokenResult.response.status, createTokenResult.duration_ms
    ]
  );

  // 计算初始积分
  const initialBalance = initialQuota * 0.002;

  // 创建本地用户
  const result = db.run(
    `INSERT INTO users (
      phone, nickname, role, status, enterprise_id,
      sudorouter_user_id, sudorouter_key, invitation_code_id,
      quota, used_quota, balance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      phone,
      nickname, // 使用用户填写的昵称
      "USER",
      1, // 状态默认已批准
      enterprise.id,
      sudorouterUser.id,
      sudorouterKey,
      invitationCode.id,
      initialQuota,
      0,
      initialBalance,
    ],
  );

  const newUserId = result.lastInsertRowid;

  // 标记邀请码已使用
  db.run(
    "UPDATE invitation_codes SET status = 1, used_by_user_id = ?, used_at = datetime('now') WHERE id = ?",
    [newUserId, invitationCode.id],
  );

  // 创建初始积分流水
  db.run(
    "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
    [newUserId, initialBalance, "BONUS", "新用户注册赠送"],
  );

  // 记录操作日志
  db.run(
    `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newUserId, phone, "USER_CREATE", "user", newUserId, "POST", "/api/v1/auth/register"],
  );

  // 删除 register_token
  await redis.del(`register_token:${register_token}`);

  // 生成 JWT
  const token = await sign(
    {
      id: newUserId,
      phone: phone,
      role: "USER",
      enterprise_id: enterprise.id,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    },
    SECRET,
  );

  console.log(`[用户注册] 手机号: ${phone}, 昵称: ${nickname}, sudorouter用户ID: ${sudorouterUser.id}, 初始积分: ${initialBalance}`);

  const bonusPoints = sudorouterService.getInitialPoints(); // 赠送积分

  // 获取模型服务配置
  const modelServiceUrl = sudorouterService.getModelServiceUrl();
  const models = await sudorouterService.getAvailableModels();

  return c.json({
    success: true,
    data: {
      token,
      user: {
        id: newUserId,
        phone: phone,
        nickname: nickname,
        role: "USER",
        status: 1,
        enterprise_code: enterprise.code,
        sudorouter_key: `sk-${sudorouterKey}`,
        model_service_url: modelServiceUrl,
        models: models,
        points: {
          total: initialBalance,
          used: 0,
          remaining: initialBalance,
          bonus: bonusPoints,
        },
      },
    },
  });
});

app.get("/api/v1/user/profile", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare(
      "SELECT u.*, e.code as enterprise_code FROM users u JOIN enterprises e ON u.enterprise_id = e.id WHERE u.id = ?",
    )
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 从 sudorouter 同步用户额度
  let remainingPoints = 0;
  let usedPoints = 0;
  const bonusPoints = sudorouterService.getInitialPoints(); // 赠送积分 1000

  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    const sudorouterUser = await sudorouterService.getUser(user.sudorouter_user_id);
    if (sudorouterUser) {
      const quota = sudorouterUser.quota || 0;
      const usedQuota = sudorouterUser.used_quota || 0;

      // 积分计算：积分 = 额度 * 0.002
      remainingPoints = sudorouterService.quotaToPoints(quota);
      usedPoints = sudorouterService.quotaToPoints(usedQuota);

      // 更新本地用户额度
      db.run(
        "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
        [quota, usedQuota, remainingPoints, user.id],
      );

      user.quota = quota;
      user.used_quota = usedQuota;
      user.balance = remainingPoints;
    }
  }

  return c.json({
    success: true,
    data: {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      role: user.role,
      status: user.status,
      enterprise_id: user.enterprise_id,
      enterprise_code: user.enterprise_code,
      // 积分信息
      bonus_points: bonusPoints,           // 赠送积分（固定1000）
      remaining_points: remainingPoints,   // 剩余积分
      used_points: usedPoints,             // 已用积分
      // 原始额度信息（可选，用于调试）
      quota: user.quota || 0,
      used_quota: user.used_quota || 0,
    },
  });
});

// 用户中心合并接口 - 一次性返回积分、今日统计和使用流水
app.get("/api/v1/user/dashboard", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 默认积分数据
  let totalPoints = 0;
  let usedPoints = 0;
  let remainingPoints = 0;
  const bonusPoints = sudorouterService.getInitialPoints();

  // 今日使用统计
  let todayTokens = 0;
  let todayCostPoints = 0;
  let todayRequests = 0;

  // 使用流水
  let usageLogs: any[] = [];
  let totalLogs = 0;

  // 从 sudorouter 获取数据
  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    // 并行调用：获取用户信息 + 获取使用日志
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const now = Math.floor(Date.now() / 1000);
    const monthAgo = now - 30 * 24 * 60 * 60;

    const [getUserResult, logsResult] = await Promise.all([
      sudorouterService.getUserWithLog(user.sudorouter_user_id),
      sudorouterService.getUsageLogs(user.sudorouter_user_id, monthAgo, now, 1, 100)
    ]);

    // 处理用户信息
    if (getUserResult.success && getUserResult.data) {
      const sudorouterUser = getUserResult.data;
      totalPoints = sudorouterService.quotaToPoints(sudorouterUser.quota || 0);
      usedPoints = sudorouterService.quotaToPoints(sudorouterUser.used_quota || 0);
      remainingPoints = totalPoints - usedPoints;

      // 更新本地数据库
      db.run(
        "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
        [sudorouterUser.quota, sudorouterUser.used_quota, remainingPoints, user.id]
      );

      // 记录 API 调用日志
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.phone, "SUDOROUTER_GET_USER", "sudorouter_api", user.sudorouter_user_id,
          "GET", getUserResult.request.url,
          JSON.stringify({ user_id: user.sudorouter_user_id }),
          JSON.stringify({ success: true, quota: sudorouterUser.quota, used_quota: sudorouterUser.used_quota }),
          getUserResult.response.status, getUserResult.duration_ms
        ]
      );
    }

    // 处理使用日志（过滤掉 manage 类型和空模型名的记录）
    if (logsResult && logsResult.data) {
      // 过滤有效的使用记录（与今日统计过滤条件一致）
      const validLogs = logsResult.data.data.filter((log: any) =>
        log.type !== "manage" && log.model_name
      );

      totalLogs = validLogs.length;
      usageLogs = validLogs.map((log: any) => ({
        id: log.id,
        model: log.model_name,
        timestamp: new Date(log.created_at * 1000).toISOString(),
        prompt_tokens: log.prompt_tokens || 0,
        completion_tokens: log.completion_tokens || 0,
        created_at: log.created_at,
      }));

      // 计算今日统计（从同一份数据中计算，避免重复调用）
      for (const log of validLogs) {
        if (log.created_at >= todayStart) {
          todayRequests += 1;
          todayTokens += (log.prompt_tokens || 0) + (log.completion_tokens || 0);
          todayCostPoints += (log.quota || 0) * 0.002;
        }
      }

      // 记录 API 调用日志
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.phone, "SUDOROUTER_GET_USAGE_LOGS", "sudorouter_api", user.sudorouter_user_id,
          "GET", "/api/log/",
          JSON.stringify({ user_id: user.sudorouter_user_id, time_from: monthAgo, time_to: now }),
          JSON.stringify({ success: true, count: totalLogs })
        ]
      );
    }
  }

  return c.json({
    success: true,
    data: {
      points: {
        total: totalPoints,
        used: usedPoints,
        remaining: remainingPoints,
        bonus: bonusPoints,
      },
      usage_today: {
        tokens: todayTokens,
        cost_points: Math.round(todayCostPoints * 1000) / 1000,
        requests: todayRequests,
      },
      ledger: {
        list: usageLogs,
        total: totalLogs,
      },
    },
  });
});

app.get("/api/v1/user/ledger", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 时间范围参数
  const timeFrom = c.req.query("time_from");
  const timeTo = c.req.query("time_to");

  // 如果有 sudorouter 用户ID，从 sudorouter 获取使用日志
  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    const from = timeFrom ? parseInt(timeFrom) : Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const to = timeTo ? parseInt(timeTo) : Math.floor(Date.now() / 1000);

    const logs = await sudorouterService.getUsageLogs(
      user.sudorouter_user_id,
      from,
      to,
      1,
      100,
    );

    // 记录 Sudorouter API 调用日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id, user.phone, "SUDOROUTER_GET_USAGE_LOGS", "sudorouter_api", user.sudorouter_user_id,
        "GET", "/api/log/",
        JSON.stringify({ user_id: user.sudorouter_user_id, time_from: from, time_to: to, page_size: 100 }),
        JSON.stringify({ success: !!logs, count: logs?.data?.count || 0 })
      ]
    );

    if (logs && logs.data) {
      const formattedLogs = logs.data.data.map((log: any) => ({
        id: log.id,
        user_id: user.id,
        amount: -((log.quota || 0) * 0.002),
        type: "CONSUME",
        memo: `${log.model_name || "unknown"} (${log.prompt_tokens || 0}+${log.completion_tokens || 0} tokens)`,
        timestamp: new Date(log.created_at * 1000).toISOString(),
        model: log.model_name,
        prompt_tokens: log.prompt_tokens,
        completion_tokens: log.completion_tokens,
        quota: log.quota,
      }));

      return c.json({
        success: true,
        data: formattedLogs,
        total: logs.data.count,
      });
    }
  }

  // 回退到本地流水
  const allLogs = db
    .prepare(
      "SELECT * FROM ledger WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20",
    )
    .all(payload.id);
  return c.json({ success: true, data: allLogs });
});

// 用户统计接口 - 获取用户中心数据
app.get("/api/v1/user/stats", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 默认积分数据
  let totalPoints = 0;
  let usedPoints = 0;
  let remainingPoints = 0;
  const bonusPoints = sudorouterService.getInitialPoints();

  // 今日使用统计
  let todayTokens = 0;
  let todayCostPoints = 0;
  let todayRequests = 0;

  // 从 sudorouter 获取用户信息
  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    const getUserResult = await sudorouterService.getUserWithLog(user.sudorouter_user_id);
    if (getUserResult.success && getUserResult.data) {
      const sudorouterUser = getUserResult.data;
      totalPoints = sudorouterService.quotaToPoints(sudorouterUser.quota || 0);
      usedPoints = sudorouterService.quotaToPoints(sudorouterUser.used_quota || 0);
      remainingPoints = totalPoints - usedPoints;

      // 更新本地数据库
      db.run(
        "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
        [sudorouterUser.quota, sudorouterUser.used_quota, remainingPoints, user.id]
      );

      // 记录 Sudorouter API 调用日志
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.phone, "SUDOROUTER_GET_USER", "sudorouter_api", user.sudorouter_user_id,
          "GET", getUserResult.request.url,
          JSON.stringify({ user_id: user.sudorouter_user_id }),
          JSON.stringify({ success: true, quota: sudorouterUser.quota, used_quota: sudorouterUser.used_quota }),
          getUserResult.response.status, getUserResult.duration_ms
        ]
      );
    }

    // 获取今日使用日志
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const now = Math.floor(Date.now() / 1000);

    const todayLogs = await sudorouterService.getUsageLogs(
      user.sudorouter_user_id,
      todayStart,
      now,
      1,
      1000
    );

    // 记录获取使用日志的 API 调用
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id, user.phone, "SUDOROUTER_GET_USAGE_LOGS", "sudorouter_api", user.sudorouter_user_id,
        "GET", "/api/log/",
        JSON.stringify({ user_id: user.sudorouter_user_id, time_from: todayStart, time_to: now }),
        JSON.stringify({ success: !!todayLogs, count: todayLogs?.data?.count || 0 })
      ]
    );

    if (todayLogs && todayLogs.data && todayLogs.data.data) {
      for (const log of todayLogs.data.data) {
        // 只统计模型使用记录，排除管理操作(manage)类型的日志
        if (log.type !== "manage" && log.model_name) {
          todayRequests += 1;
          todayTokens += (log.prompt_tokens || 0) + (log.completion_tokens || 0);
          todayCostPoints += (log.quota || 0) * 0.002;
        }
      }
    }
  }

  return c.json({
    success: true,
    data: {
      points: {
        total: totalPoints,
        used: usedPoints,
        remaining: remainingPoints,
        bonus: bonusPoints,
      },
      usage_today: {
        tokens: todayTokens,
        cost_points: Math.round(todayCostPoints * 1000) / 1000,
        requests: todayRequests,
      },
    },
  });
});

app.get(
  "/api/v1/admin/members",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const user = c.get("user");

    let users: any[];
    if (user.role === "SUPER_ADMIN") {
      users = db.prepare("SELECT * FROM users ORDER BY status ASC").all();
    } else {
      users = db
        .prepare("SELECT * FROM users WHERE enterprise_id = ? ORDER BY status ASC")
        .all(user.enterprise_id ?? 0);
    }

    return c.json({ success: true, data: users });
  },
);

app.post(
  "/api/v1/admin/approve",
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

    if (admin.role !== "SUPER_ADMIN" && targetUser.enterprise_id !== admin.enterprise_id) {
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

app.post(
  "/api/v1/admin/reject",
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

    if (admin.role !== "SUPER_ADMIN" && targetUser.enterprise_id !== admin.enterprise_id) {
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

app.post(
  "/api/v1/admin/delete",
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

    if (admin.role !== "SUPER_ADMIN" && targetUser.enterprise_id !== admin.enterprise_id) {
      return c.json({ success: false, msg: "无权操作该用户" }, 403);
    }

    db.run("DELETE FROM users WHERE id = ?", [userId]);
    db.run("DELETE FROM ledger WHERE user_id = ?", [userId]);

    return c.json({ success: true, msg: "用户已删除" });
  },
);

app.post("/api/v1/user/update-profile", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const { nickname } = await c.req.json();
  if (!nickname || nickname.trim().length === 0) {
    return c.json({ success: false, msg: "昵称不能为空" }, 400);
  }

  // 更新昵称
  db.run("UPDATE users SET nickname = ? WHERE id = ?", [
    nickname.trim(),
    payload.id,
  ]);

  return c.json({ success: true, msg: "昵称已更新" });
});

app.get("/api/v1/router/models", (c) => {
  return c.json({
    success: true,
    data: [
      {
        label: "Claude 3.5 Sonnet (Global)",
        value: "claude-3-5-sonnet",
      },
      { label: "GPT-4o (Global)", value: "gpt-4o" },
      { label: "DeepSeek V3", value: "deepseek-v3" },
    ],
  });
});

// NEW: Usage Reporting Endpoint
app.post("/api/v1/usage/report", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const { inputTokens, outputTokens, model } = await c.req.json();
  const totalTokens = (inputTokens || 0) + (outputTokens || 0);

  // Rate: 1000 tokens = 1 point
  const points = Math.ceil((totalTokens / 1000) * 100) / 100;

  if (points <= 0) {
    return c.json({ success: true, deducted: 0, newBalance: 0 });
  }

  // 查询当前用户余额
  const user = db
    .prepare("SELECT balance FROM users WHERE id = ?")
    .get(payload.id) as any;

  if (!user) {
    return c.json({ success: false, msg: "用户不存在" }, 404);
  }

  // 检查余额是否足够
  if (user.balance < points) {
    return c.json(
      {
        success: false,
        msg: "余额不足",
        data: { balance: user.balance, required: points },
      },
      400,
    );
  }

  // 使用事务确保原子性
  db.run("BEGIN TRANSACTION");
  try {
    // Deduct balance
    db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [
      points,
      payload.id,
    ]);

    // Add ledger entry
    db.run(
      "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
      [
        payload.id,
        -points,
        "CONSUME",
        `Used ${model || "model"} (${totalTokens} tokens)`,
      ],
    );

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    console.error("[Usage Report] 扣费失败:", error);
    return c.json({ success: false, msg: "扣费失败" }, 500);
  }

  // Return new balance
  const updatedUser = db
    .prepare("SELECT balance FROM users WHERE id = ?")
    .get(payload.id) as any;

  return c.json({
    success: true,
    deducted: points,
    newBalance: updatedUser?.balance || 0,
  });
});

// ==================== 操作日志接口 ====================

// GET /api/v1/admin/logs - 获取操作日志
app.get(
  "/api/v1/admin/logs",
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

// 定期清理过期日志（保留60天）
const cleanOldLogs = () => {
  const result = db.run(
    "DELETE FROM operation_logs WHERE created_at < datetime('now', '-60 days')",
  );
  if (result.changes > 0) {
    console.log(`[日志清理] 已删除 ${result.changes} 条过期日志`);
  }
};

// 每天执行一次清理
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
// 启动时也执行一次
cleanOldLogs();

// SPA fallback - serve index.html for all other routes (must be after all API routes)
app.get("/*", async (c) => {
  const file = Bun.file("./admin-dist/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html" },
  });
});

export default { port: 3000, fetch: app.fetch };
