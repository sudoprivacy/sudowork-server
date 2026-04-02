/**
 * Authentication routes
 */

import { Hono } from "hono";
import { sign } from "hono/jwt";
import { db, SECRET } from "../db/index.js";
import { smsService } from "../services/SmsService.js";
import { sudorouterService } from "../services/SudorouterService.js";
import { isValidPhone, isValidSmsCode } from "../utils/validation.js";
import { rateLimiter, rateLimitPresets } from "../middleware/rateLimiter.js";
import { redis } from "../redis.js";
import type { User } from "../types/index.js";
import { logSudorouterCall } from "../utils/logger.js";

const authRoutes = new Hono();

// POST /api/v1/auth/send-code - Send SMS verification code
authRoutes.post("/send-code", async (c) => {
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
authRoutes.post("/login", rateLimiter(rateLimitPresets.login), async (c) => {
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
  if (!isValidSmsCode(code)) {
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
    .get(phone) as User | undefined;

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

    // 从 ledger 表查询实际获得的赠送积分
    const bonusResult = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE user_id = ? AND type = 'BONUS'")
      .get(user.id) as any;
    const bonusPoints = bonusResult?.total || 0;

    // 并行调用：获取用户信息 + 获取可用模型
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
          const sudorouterUserInfo = getUserResult.data;
          totalPoints = sudorouterService.quotaToPoints(
            (sudorouterUserInfo.quota || 0) + (sudorouterUserInfo.used_quota || 0),
          );
          usedPoints = sudorouterService.quotaToPoints(
            sudorouterUserInfo.used_quota || 0,
          );
          remainingPoints = sudorouterService.quotaToPoints(
            sudorouterUserInfo.quota || 0,
          );

          // 更新本地数据库
          db.run(
            "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
            [
              sudorouterUserInfo.quota,
              sudorouterUserInfo.used_quota,
              remainingPoints,
              user.id,
            ],
          );

          // 记录 Sudorouter API 调用日志
          logSudorouterCall({
            userId: user.id,
            userPhone: phone,
            action: "SUDOROUTER_GET_USER",
            resourceId: user.sudorouter_user_id,
            method: getUserResult.request.method,
            url: getUserResult.request.url,
            requestBody: { user_id: user.sudorouter_user_id },
            responseBody: {
              success: true,
              quota: sudorouterUserInfo.quota,
              used_quota: sudorouterUserInfo.used_quota,
            },
            responseStatus: getUserResult.response.status,
            durationMs: getUserResult.duration_ms,
          });
        } else {
          // 记录失败日志
          logSudorouterCall({
            userId: user.id,
            userPhone: phone,
            action: "SUDOROUTER_GET_USER",
            resourceId: user.sudorouter_user_id,
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
        console.error(`[Login] 同步用户 ${phone} 额度失败:`, error);
        // 使用本地缓存数据
        totalPoints = sudorouterService.quotaToPoints(
          (user.quota || 0) + (user.used_quota || 0),
        );
        usedPoints = sudorouterService.quotaToPoints(user.used_quota || 0);
        remainingPoints = sudorouterService.quotaToPoints(user.quota || 0);
      }
    }

    // 登录成功
    const token = await sign(
      {
        id: user.id,
        phone: user.phone,
        role: user.role,
        enterprise_id: user.enterprise_id,
        // exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
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

  // 用户不存在，生成 register_token 并返回
  // 生成 32 位随机 token
  const registerToken = crypto.randomUUID().replace(/-/g, "");

  // 将 register_token 存入 Redis，10 分钟有效
  await redis.setex(
    `register_token:${registerToken}`,
    600,
    JSON.stringify({
      phone,
      verified: true,
      created_at: Date.now(),
    }),
  );

  console.log(
    `[Login] 用户不存在，生成 register_token: ${registerToken.substring(0, 8)}... 手机号: ${phone}`,
  );

  return c.json({
    success: false,
    need_register: true,
    register_token: registerToken,
    phone: phone,
    msg: "用户不存在，请先注册",
  });
});

// POST /api/v1/auth/register - Register new user with register_token
authRoutes.post(
  "/register",
  rateLimiter(rateLimitPresets.login),
  async (c) => {
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
      .get(phone) as User | undefined;

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
    const createUserResult = await sudorouterService.createUserWithLog(phone, nickname);
    if (!createUserResult.success || !createUserResult.data) {
      // 记录失败日志
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

    // 记录创建用户成功日志
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
      // 记录失败日志
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
      console.error(`[Register] 用户 ${phone} 额度充值失败`);
    } else {
      // 记录成功日志
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

    // 记录创建令牌成功日志
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
      [
        newUserId,
        phone,
        "USER_CREATE",
        "user",
        newUserId,
        "POST",
        "/api/v1/auth/register",
      ],
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

    console.log(
      `[用户注册] 手机号: ${phone}, 昵称: ${nickname}, sudorouter用户ID: ${sudorouterUser.id}, 初始积分: ${initialBalance}`,
    );

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
  },
);

export { authRoutes };