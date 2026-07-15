/**
 * Unified login route dispatched by system login_method.
 *
 * POST /api/v1/auth/login-by-config (公开,不鉴权)
 * 挂载:src/index.ts app.route("/api/v1/auth", loginByConfigRoutes)
 *
 * 按 system_config.login_method 分流:
 * - 0 手机验证码:校验 phone+code(smsService.verifyCode),查 users WHERE phone=? AND login_type=0
 *   (密码用户即使 phone 命中也不可经此分支登录,满足 §一需求3)
 * - 1 用户名密码:校验 phone+password(verifyPassword),查 users WHERE phone=? AND login_type=1
 * - 2 三方认证登录:拒绝本接口,客户端应走 Provider CAS 回调接口
 *
 * 不改 auth.ts;/auth/login、/admin/login 保持原样。登录成功逻辑(同步额度/签发 token)
 * 依据 auth.ts:121-311 在本文件内重新实现(代码冗余以避免改动 auth.ts)。
 */

import { Hono, type Context } from "hono";
import { sign } from "hono/jwt";
import { db, SECRET } from "../db/index.js";
import { smsService } from "../services/SmsService.js";
import { sudorouterService } from "../services/SudorouterService.js";
import { systemConfigService } from "../services/SystemConfigService.js";
import { verifyPassword } from "../utils/password.js";
import { isValidPhone, isValidSmsCode } from "../utils/validation.js";
import { rateLimiter, rateLimitPresets } from "../middleware/rateLimiter.js";
import { redis } from "../redis.js";
import type { User } from "../types/index.js";
import { logSudorouterCall } from "../utils/logger.js";

const loginByConfigRoutes = new Hono();

/**
 * 构建登录成功响应(复用 auth.ts:121-311 的禁用检查/企业查询/额度同步/签发逻辑)。
 */
async function buildLoginSuccess(c: Context, user: User, phone: string) {
  // 账号禁用检查
  if (user.status === 2) {
    return c.json({ success: false, msg: "该账户已被禁用，请联系管理员" }, 403);
  }

  // 查询用户关联的企业
  const enterprise = db
    .prepare("SELECT * FROM enterprises WHERE id = ?")
    .get(user.enterprise_id) as any;
  if (!enterprise) {
    return c.json({ success: false, msg: "用户企业信息异常" }, 500);
  }

  // 同步 sudorouter 额度(复用 auth.ts:153-240 逻辑)
  let totalPoints = 0;
  let usedPoints = 0;
  let remainingPoints = 0;

  const bonusResult = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE user_id = ? AND type = 'BONUS'",
    )
    .get(user.id) as any;
  const bonusPoints = bonusResult?.total || 0;

  const [getUserResult, models] =
    user.sudorouter_user_id && sudorouterService.isConfigured()
      ? await Promise.all([
          sudorouterService.getUserWithLog(user.sudorouter_user_id),
          sudorouterService.getAvailableModels(),
        ])
      : [null, await sudorouterService.getAvailableModels()];

  if (getUserResult) {
    try {
      if (getUserResult.success && getUserResult.data) {
        const info = getUserResult.data;
        totalPoints = sudorouterService.quotaToPoints(
          (info.quota || 0) + (info.used_quota || 0),
        );
        usedPoints = sudorouterService.quotaToPoints(info.used_quota || 0);
        remainingPoints = sudorouterService.quotaToPoints(info.quota || 0);

        db.run(
          "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
          [info.quota, info.used_quota, remainingPoints, user.id],
        );
        logSudorouterCall({
          userId: user.id,
          userPhone: phone,
          action: "SUDOROUTER_GET_USER",
          resourceId: user.sudorouter_user_id ?? undefined,
          method: getUserResult.request.method,
          url: getUserResult.request.url,
          requestBody: { user_id: user.sudorouter_user_id },
          responseBody: {
            success: true,
            quota: info.quota,
            used_quota: info.used_quota,
          },
          responseStatus: getUserResult.response.status,
          durationMs: getUserResult.duration_ms,
        });
      } else {
        logSudorouterCall({
          userId: user.id,
          userPhone: phone,
          action: "SUDOROUTER_GET_USER",
          resourceId: user.sudorouter_user_id ?? undefined,
          method: getUserResult.request.method,
          url: getUserResult.request.url,
          requestBody: { user_id: user.sudorouter_user_id },
          responseBody: getUserResult.response.data,
          responseStatus: getUserResult.response.status,
          durationMs: getUserResult.duration_ms,
          errorMessage: getUserResult.error || "获取用户信息失败",
        });
      }
    } catch (error) {
      console.error(`[LoginByConfig] 同步用户 ${phone} 额度失败:`, error);
      totalPoints = sudorouterService.quotaToPoints(
        (user.quota || 0) + (user.used_quota || 0),
      );
      usedPoints = sudorouterService.quotaToPoints(user.used_quota || 0);
      remainingPoints = sudorouterService.quotaToPoints(user.quota || 0);
    }
  }

  // 签发 token
  const deviceId = c.req.header("X-Device-Id") || "default";
  const refreshToken = crypto.randomUUID();
  await redis.setex(
    `refresh_token:${user.id}:${deviceId}:${refreshToken}`,
    30 * 24 * 60 * 60,
    JSON.stringify({
      phone: user.phone,
      role: user.role,
      enterprise_id: user.enterprise_id,
    }),
  );

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await sign(
    {
      id: user.id,
      phone: user.phone,
      role: user.role,
      enterprise_id: user.enterprise_id,
      iat: now,
      exp: now + 2 * 60 * 60,
    },
    SECRET,
  );
  const legacyToken = await sign(
    {
      id: user.id,
      phone: user.phone,
      role: user.role,
      enterprise_id: user.enterprise_id,
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
    },
    SECRET,
  );

  const modelServiceUrl = sudorouterService.getModelServiceUrl();

  return c.json({
    success: true,
    data: {
      token: legacyToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 2 * 60 * 60,
      user: {
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        role: user.role,
        status: user.status,
        enterprise_code: enterprise.code,
        sudorouter_key: user.sudorouter_key
          ? `sk-${user.sudorouter_key}`
          : null,
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

// POST /api/v1/auth/login-by-config
loginByConfigRoutes.post(
  "/login-by-config",
  rateLimiter(rateLimitPresets.login),
  async (c) => {
    const body = await c.req.json();
    const loginMethod = systemConfigService.getLoginMethod();

    if (loginMethod === 0) {
      // ===== 验证码分支 =====
      const { phone, code } = body;

      if (!phone || !code) {
        return c.json({ success: false, msg: "参数不完整" }, 400);
      }
      if (!isValidPhone(phone)) {
        return c.json({ success: false, msg: "手机号格式不正确" }, 400);
      }
      if (!isValidSmsCode(code)) {
        return c.json({ success: false, msg: "验证码格式不正确" }, 400);
      }

      const DEBUG_SKIP_VERIFY_CODE =
        process.env.DEBUG_SKIP_VERIFY_CODE === "true";
      if (!DEBUG_SKIP_VERIFY_CODE) {
        const verifyResult = await smsService.verifyCode(phone, code);
        if (!verifyResult.success) {
          return c.json({ success: false, msg: verifyResult.message }, 400);
        }
      } else {
        console.log(
          `[DEBUG] login-by-config 跳过验证码验证: phone=${phone}, code=${code}`,
        );
      }

      // 强制 login_type=0 过滤:密码用户即使 phone 命中也不可经此分支登录
      const user = db
        .prepare("SELECT * FROM users WHERE phone = ? AND login_type = 0")
        .get(phone) as User | undefined;

      if (user) {
        return buildLoginSuccess(c, user, phone);
      }

      // 用户不存在(login_type=0 未命中,含 phone 仅对应密码用户)→ register_token
      const registerToken = crypto.randomUUID().replace(/-/g, "");
      await redis.setex(
        `register_token:${registerToken}`,
        600,
        JSON.stringify({ phone, verified: true, created_at: Date.now() }),
      );
      console.log(
        `[LoginByConfig] 验证码分支用户不存在,生成 register_token: ${registerToken.substring(0, 8)}... 手机号: ${phone}`,
      );
      return c.json({
        success: false,
        need_register: true,
        register_token: registerToken,
        phone: phone,
        msg: "用户不存在，请先注册",
      });
    }

    if (loginMethod === 2) {
      return c.json(
        { success: false, msg: "当前系统已开启三方认证登录，请使用 CAS 登录" },
        403,
      );
    }

    // ===== 密码分支(login_method=1) =====
    const { phone, password } = body;

    if (!phone || !password) {
      return c.json({ success: false, msg: "账号或密码不能为空" }, 400);
    }

    // 强制 login_type=1 过滤
    const user = db
      .prepare("SELECT * FROM users WHERE phone = ? AND login_type = 1")
      .get(phone) as User | undefined;

    // 不存在或密码错误 → 统一 401(不暴露账号是否存在)
    if (!user) {
      return c.json({ success: false, msg: "账号或密码错误" }, 401);
    }

    const validPassword = await verifyPassword(
      password,
      user.password_hash || "",
    );
    if (!validPassword) {
      return c.json({ success: false, msg: "账号或密码错误" }, 401);
    }

    return buildLoginSuccess(c, user, phone);
  },
);

export { loginByConfigRoutes };
