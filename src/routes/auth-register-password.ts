/**
 * Third-party password-based registration route.
 *
 * POST /api/v1/auth/register-password
 *
 * 供第三方调用的用户名密码方式注册接口。
 * 与 /api/v1/auth/register（手机验证码方式）并列，区别：
 * - 手机验证码 → 改成密码
 * - 手机号 → 改成用户名（复用数据库 phone 字段）
 * - login_type 固定为 1
 * - 其余流程与老 register 完全一致
 *
 * 闸门：仅当系统开启用户名密码登录（login_method=1）时可用
 */

import { Hono } from "hono";
import { sign } from "hono/jwt";
import { db } from "../db/index.js";
import { redis } from "../redis.js";
import { sudorouterService } from "../services/SudorouterService.js";
import { systemConfigService } from "../services/SystemConfigService.js";
import { rateLimiter, rateLimitPresets } from "../middleware/rateLimiter.js";
import { validatePasswordStrength, hashPassword } from "../utils/password.js";
import { logSudorouterCall } from "../utils/logger.js";
import type { User } from "../types/index.js";

const SECRET = process.env.JWT_SECRET || "sudowork-secret-key";

const authRegisterPasswordRoutes = new Hono();

authRegisterPasswordRoutes.post(
  "/register-password",
  rateLimiter(rateLimitPresets.login),
  async (c) => {
    // 闸门 1:仅 login_method=1 时可用
    if (systemConfigService.getLoginMethod() !== 1) {
      return c.json(
        {
          success: false,
          msg: "当前系统未开启用户名密码登录，注册功能暂不可用",
        },
        403,
      );
    }

    const { phone, password, nickname, invitation_code } = await c.req.json();

    // 参数验证
    if (!phone || !password || !nickname || !invitation_code) {
      return c.json(
        {
          success: false,
          msg: "参数不完整",
        },
        400,
      );
    }

    // 密码强度校验
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return c.json({ success: false, msg: strength.message }, 400);
    }

    // 用户名查重(phone 字段存用户名称)
    const existingUser = db
      .prepare("SELECT * FROM users WHERE phone = ?")
      .get(phone) as User | undefined;

    if (existingUser) {
      return c.json(
        {
          success: false,
          msg: "用户名已存在",
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

    // 获取邀请码关联的企业
    const enterprise = db
      .prepare("SELECT * FROM enterprises WHERE id = ?")
      .get(invitationCode.enterprise_id) as any;

    if (!enterprise) {
      return c.json(
        {
          success: false,
          msg: "邀请码关联企业不存在",
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
    const createUserResult = await sudorouterService.createUserWithLog(phone, nickname);
    if (!createUserResult.success || !createUserResult.data) {
      logSudorouterCall({
        userId: 0,
        userPhone: phone,
        action: "SUDOROUTER_CREATE_USER",
        method: createUserResult.request.method,
        url: createUserResult.request.url,
        requestBody: createUserResult.request.body,
        responseBody: createUserResult.response.data,
        responseStatus: createUserResult.response.status,
        durationMs: createUserResult.duration_ms,
        errorMessage: createUserResult.error || "创建用户失败",
      });
      return c.json(
        {
          success: false,
          msg: "创建用户失败，请稍后重试",
        },
        500,
      );
    }

    const sudorouterUser = createUserResult.data;

    logSudorouterCall({
      userId: 0,
      userPhone: phone,
      action: "SUDOROUTER_CREATE_USER",
      resourceId: sudorouterUser.id,
      method: createUserResult.request.method,
      url: createUserResult.request.url,
      requestBody: createUserResult.request.body,
      responseBody: {
        success: true,
        id: sudorouterUser.id,
        username: sudorouterUser.username,
      },
      responseStatus: createUserResult.response.status,
      durationMs: createUserResult.duration_ms,
    });

    // 充值初始额度
    const initialQuota = sudorouterService.getInitialQuota();
    const quotaResult = await sudorouterService.updateUserQuotaWithLog(
      sudorouterUser.id,
      initialQuota,
      "新用户注册赠送额度",
    );

    if (!quotaResult.success) {
      logSudorouterCall({
        userId: 0,
        userPhone: phone,
        action: "SUDOROUTER_UPDATE_QUOTA",
        resourceId: sudorouterUser.id,
        method: quotaResult.request.method,
        url: quotaResult.request.url,
        requestBody: quotaResult.request.body,
        responseBody: quotaResult.response.data,
        responseStatus: quotaResult.response.status,
        durationMs: quotaResult.duration_ms,
        errorMessage: quotaResult.error || "额度充值失败",
      });
      console.error(`[Register-Password] 用户 ${phone} 额度充值失败`);
    } else {
      logSudorouterCall({
        userId: 0,
        userPhone: phone,
        action: "SUDOROUTER_UPDATE_QUOTA",
        resourceId: sudorouterUser.id,
        method: quotaResult.request.method,
        url: quotaResult.request.url,
        requestBody: quotaResult.request.body,
        responseBody: { success: true, quota: initialQuota },
        responseStatus: quotaResult.response.status,
        durationMs: quotaResult.duration_ms,
      });
      console.log(`[Register-Password] 用户 ${phone} 充值成功: ${initialQuota}`);
    }

    // 调用 sudorouter 创建令牌
    const createTokenResult = await sudorouterService.createTokenWithLog(
      sudorouterUser.id,
      phone,
      true,
    );

    if (!createTokenResult.success || !createTokenResult.data) {
      logSudorouterCall({
        userId: 0,
        userPhone: phone,
        action: "SUDOROUTER_CREATE_TOKEN",
        resourceId: sudorouterUser.id,
        method: createTokenResult.request.method,
        url: createTokenResult.request.url,
        requestBody: createTokenResult.request.body,
        responseBody: createTokenResult.response.data,
        responseStatus: createTokenResult.response.status,
        durationMs: createTokenResult.duration_ms,
        errorMessage: createTokenResult.error || "创建令牌失败",
      });
      return c.json(
        {
          success: false,
          msg: "创建令牌失败，请稍后重试",
        },
        500,
      );
    }

    const sudorouterKey = createTokenResult.data;

    logSudorouterCall({
      userId: 0,
      userPhone: phone,
      action: "SUDOROUTER_CREATE_TOKEN",
      resourceId: sudorouterUser.id,
      method: createTokenResult.request.method,
      url: createTokenResult.request.url,
      requestBody: createTokenResult.request.body,
      responseBody: {
        success: true,
        key_preview: sudorouterKey.substring(0, 20) + "...",
      },
      responseStatus: createTokenResult.response.status,
      durationMs: createTokenResult.duration_ms,
    });

    // 计算初始积分
    const initialBalance = sudorouterService.quotaToPoints(initialQuota);

    // 密码哈希
    const passwordHash = await hashPassword(password);

    // 创建本地用户(login_type=1)
    const result = db.run(
      `INSERT INTO users (
        phone, nickname, role, status, enterprise_id,
        sudorouter_user_id, sudorouter_key, invitation_code_id,
        quota, used_quota, balance, password_hash, login_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        phone,
        nickname,
        "USER",
        1,
        enterprise.id,
        sudorouterUser.id,
        sudorouterKey,
        invitationCode.id,
        initialQuota,
        0,
        initialBalance,
        passwordHash,
        1, // login_type=1 (密码登录)
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
      [
        newUserId,
        phone,
        "USER_CREATE",
        "user",
        newUserId,
        "POST",
        "/api/v1/auth/register-password",
      ],
    );

    // 生成 refresh_token
    const deviceId = c.req.header("X-Device-Id") || "default";
    const refreshToken = crypto.randomUUID();

    await redis.setex(
      `refresh_token:${newUserId}:${deviceId}:${refreshToken}`,
      30 * 24 * 60 * 60,
      JSON.stringify({ phone, role: "USER", enterprise_id: enterprise.id }),
    );

    // 生成 access_token（2小时）
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await sign(
      {
        id: newUserId,
        phone: phone,
        role: "USER",
        enterprise_id: enterprise.id,
        iat: now,
        exp: now + 2 * 60 * 60,
      },
      SECRET,
    );

    // 生成兼容旧客户端的 token（30天）
    const legacyToken = await sign(
      {
        id: newUserId,
        phone: phone,
        role: "USER",
        enterprise_id: enterprise.id,
        iat: now,
        exp: now + 30 * 24 * 60 * 60,
      },
      SECRET,
    );

    console.log(
      `[用户注册(密码方式)] 用户名: ${phone}, 昵称: ${nickname}, sudorouter用户ID: ${sudorouterUser.id}, 初始积分: ${initialBalance}`,
    );

    const bonusPoints = sudorouterService.getInitialPoints();

    const modelServiceUrl = sudorouterService.getModelServiceUrl();
    const models = await sudorouterService.getAvailableModels();

    return c.json({
      success: true,
      data: {
        token: legacyToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 2 * 60 * 60,
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
          scode_auto_model: systemConfigService.getScodeAutoModel(),
          points: {
            total: initialBalance,
            used: 0,
            remaining: initialBalance,
            bonus: bonusPoints,
          },
        },
      },
    });
  },
);

export { authRegisterPasswordRoutes };
