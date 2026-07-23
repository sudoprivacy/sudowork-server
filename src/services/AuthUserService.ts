import { sign } from "hono/jwt";
import { db, SECRET } from "../db/index.js";
import { redis } from "../redis.js";
import { sudorouterService } from "./SudorouterService.js";
import { systemConfigService } from "./SystemConfigService.js";
import { generateInvitationCode } from "../utils/invitation.js";
import { USER_ROLES, USER_STATUS } from "../utils/constants.js";
import { logOperation, logSudorouterCall } from "../utils/logger.js";
import type { Enterprise, User } from "../types/index.js";

const SUDOROUTER_DISPLAY_NAME_MAX_LENGTH = 20;

export class AuthUserServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface LoginSuccessData {
  token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: number;
    phone: string;
    nickname: string | null;
    role: string;
    status: number;
    enterprise_id: number | null;
    enterprise_code: string;
    sudorouter_key: string | null;
    model_service_url: string;
    models: string[];
    scode_auto_model: string;
    points: {
      total: number;
      used: number;
      remaining: number;
      bonus: number;
    };
  };
}

export interface ProvisionUserInput {
  account: string;
  nickname: string;
  sudorouterUsername?: string;
  enterprise: Enterprise;
  loginType: number;
  operationPath: string;
  invitationCodePrefix: string;
  initialQuotaUsd?: number | null;
}

interface SudorouterProvisionOutcome {
  sudorouterUser: {
    id: number;
    username: string;
    quota?: number;
    used_quota?: number;
  };
  sudorouterUsername: string;
  createdSudorouterUser: boolean;
}

class AuthUserService {
  async buildLoginSuccessData(
    user: User,
    deviceId: string,
  ): Promise<LoginSuccessData> {
    if (user.status === USER_STATUS.DISABLED) {
      throw new AuthUserServiceError(403, "该账户已被禁用，请联系管理员");
    }

    const enterprise = db
      .prepare("SELECT * FROM enterprises WHERE id = ?")
      .get(user.enterprise_id) as Enterprise | undefined;
    if (!enterprise) {
      throw new AuthUserServiceError(500, "用户企业信息异常");
    }

    let totalPoints = sudorouterService.quotaToPoints(
      (user.quota || 0) + (user.used_quota || 0),
    );
    let usedPoints = sudorouterService.quotaToPoints(user.used_quota || 0);
    let remainingPoints = sudorouterService.quotaToPoints(user.quota || 0);

    const bonusResult = db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE user_id = ? AND type = 'BONUS'",
      )
      .get(user.id) as { total: number } | undefined;
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
            userPhone: user.phone,
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
            userPhone: user.phone,
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
        console.error(
          `[AuthUserService] 同步用户 ${user.phone} 额度失败:`,
          error,
        );
      }
    }

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
    const tokenPayload = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      enterprise_id: user.enterprise_id,
      iat: now,
    };
    const accessToken = await sign(
      { ...tokenPayload, exp: now + 2 * 60 * 60 },
      SECRET,
    );
    const legacyToken = await sign(
      { ...tokenPayload, exp: now + 30 * 24 * 60 * 60 },
      SECRET,
    );

    return {
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
        enterprise_id: user.enterprise_id,
        enterprise_code: enterprise.code,
        sudorouter_key: user.sudorouter_key
          ? `sk-${user.sudorouter_key}`
          : null,
        model_service_url: sudorouterService.getModelServiceUrl(),
        models,
        scode_auto_model: systemConfigService.getScodeAutoModel(),
        points: {
          total: totalPoints,
          used: usedPoints,
          remaining: remainingPoints,
          bonus: bonusPoints,
        },
      },
    };
  }

  async createProvisionedUser(input: ProvisionUserInput): Promise<User> {
    if (!sudorouterService.isConfigured()) {
      throw new AuthUserServiceError(500, "系统未完成配置，请联系管理员");
    }

    const {
      sudorouterUser,
      sudorouterUsername,
      createdSudorouterUser,
    } = await this.createOrFindSudorouterUser(input);

    const initialQuota =
      input.initialQuotaUsd == null
        ? sudorouterService.getInitialQuota()
        : sudorouterService.usdToQuota(input.initialQuotaUsd);
    let localQuota = sudorouterUser.quota ?? 0;
    let localUsedQuota = sudorouterUser.used_quota ?? 0;
    let localBalance = sudorouterService.quotaToPoints(localQuota);

    if (createdSudorouterUser) {
      const quotaResult = await sudorouterService.updateUserQuotaWithLog(
        sudorouterUser.id,
        initialQuota,
        "新用户注册赠送额度",
      );

      logSudorouterCall({
        userId: 0,
        userPhone: input.account,
        action: "SUDOROUTER_UPDATE_QUOTA",
        resourceId: sudorouterUser.id,
        method: quotaResult.request.method,
        url: quotaResult.request.url,
        requestBody: quotaResult.request.body,
        responseBody: quotaResult.success
          ? { success: true, quota: initialQuota }
          : quotaResult.response.data,
        responseStatus: quotaResult.response.status,
        durationMs: quotaResult.duration_ms,
        errorMessage: quotaResult.success
          ? undefined
          : quotaResult.error || "额度充值失败",
      });
      if (!quotaResult.success) {
        console.error(`[AuthUserService] 用户 ${input.account} 额度充值失败`);
      }

      localQuota = initialQuota;
      localUsedQuota = 0;
      localBalance = sudorouterService.quotaToPoints(initialQuota);
    }

    const createTokenResult = await sudorouterService.createTokenWithLog(
      sudorouterUser.id,
      sudorouterUsername,
      true,
    );
    if (!createTokenResult.success || !createTokenResult.data) {
      logSudorouterCall({
        userId: 0,
        userPhone: input.account,
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
      throw new AuthUserServiceError(500, "创建令牌失败，请稍后重试");
    }

    const sudorouterKey = createTokenResult.data;
    logSudorouterCall({
      userId: 0,
      userPhone: input.account,
      action: "SUDOROUTER_CREATE_TOKEN",
      resourceId: sudorouterUser.id,
      method: createTokenResult.request.method,
      url: createTokenResult.request.url,
      requestBody: createTokenResult.request.body,
      responseBody: {
        success: true,
        key_preview: `${sudorouterKey.substring(0, 20)}...`,
      },
      responseStatus: createTokenResult.response.status,
      durationMs: createTokenResult.duration_ms,
    });

    const invitationCode = this.createAutoInvitationCode(
      input.enterprise.id,
      input.invitationCodePrefix,
      input.initialQuotaUsd,
    );

    const result = db.run(
      `INSERT INTO users (
        phone, nickname, role, status, enterprise_id,
        sudorouter_user_id, sudorouter_key, invitation_code_id,
        quota, used_quota, balance, password_hash, login_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        input.account,
        input.nickname,
        USER_ROLES.USER,
        USER_STATUS.APPROVED,
        input.enterprise.id,
        sudorouterUser.id,
        sudorouterKey,
        invitationCode.id,
        localQuota,
        localUsedQuota,
        localBalance,
        input.loginType,
      ],
    );
    const newUserId = Number(result.lastInsertRowid);

    db.run(
      "UPDATE invitation_codes SET status = 1, used_by_user_id = ?, used_at = datetime('now') WHERE id = ?",
      [newUserId, invitationCode.id],
    );
    if (createdSudorouterUser && localBalance > 0) {
      db.run(
        "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
        [newUserId, localBalance, "BONUS", "新用户注册赠送"],
      );
    }

    logOperation({
      userId: newUserId,
      userPhone: input.account,
      action: "USER_CREATE",
      resource: "user",
      resourceId: newUserId,
      method: "POST",
      path: input.operationPath,
      requestData: {
        phone: input.account,
        nickname: input.nickname,
        enterprise_id: input.enterprise.id,
        invitation_code_id: invitationCode.id,
        login_type: input.loginType,
        provisioned_by: "third_party_auth",
        sudorouter_username: sudorouterUsername,
      },
      responseData: {
        id: newUserId,
        sudorouter_user_id: sudorouterUser.id,
        sudorouter_binding: createdSudorouterUser ? "created" : "existing",
        initial_points: createdSudorouterUser ? localBalance : 0,
        quota: localQuota,
      },
    });

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(newUserId) as User | undefined;
    if (!user) {
      throw new AuthUserServiceError(500, "用户创建后查询失败");
    }
    return user;
  }

  private createAutoInvitationCode(
    enterpriseId: number,
    prefix: string,
    initialQuotaUsd?: number | null,
  ): { id: number; code: string } {
    const safePrefix =
      prefix
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .slice(0, 6) || "AUTO";
    for (let i = 0; i < 10; i += 1) {
      const code = `${safePrefix}${generateInvitationCode()}`;
      try {
        const result = db.run(
          "INSERT INTO invitation_codes (code, enterprise_id, initial_quota_usd) VALUES (?, ?, ?)",
          [code, enterpriseId, initialQuotaUsd ?? null],
        );
        return { id: Number(result.lastInsertRowid), code };
      } catch (error) {
        if (!String(error).includes("UNIQUE")) {
          throw error;
        }
      }
    }
    throw new AuthUserServiceError(500, "自动邀请码生成失败，请稍后重试");
  }

  private buildSudorouterDisplayName(
    nickname: string,
    fallback: string,
  ): string {
    const value = nickname.trim() || fallback;
    return Array.from(value)
      .slice(0, SUDOROUTER_DISPLAY_NAME_MAX_LENGTH)
      .join("");
  }

  private async createOrFindSudorouterUser(
    input: ProvisionUserInput,
  ): Promise<SudorouterProvisionOutcome> {
    const sudorouterUsername = this.buildSudorouterUsername(input);
    const sudorouterDisplayName = this.buildSudorouterDisplayName(
      input.nickname,
      sudorouterUsername,
    );
    const createUserResult = await sudorouterService.createUserWithLog(
      sudorouterUsername,
      sudorouterDisplayName,
    );

    if (createUserResult.success && createUserResult.data) {
      const sudorouterUser = createUserResult.data;
      logSudorouterCall({
        userId: 0,
        userPhone: input.account,
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
      return {
        sudorouterUser,
        sudorouterUsername,
        createdSudorouterUser: true,
      };
    }

    logSudorouterCall({
      userId: 0,
      userPhone: input.account,
      action: "SUDOROUTER_CREATE_USER",
      method: createUserResult.request.method,
      url: createUserResult.request.url,
      requestBody: createUserResult.request.body,
      responseBody: createUserResult.response.data,
      responseStatus: createUserResult.response.status,
      durationMs: createUserResult.duration_ms,
      errorMessage: createUserResult.error || "创建用户失败",
    });

    if (!this.isSudorouterUsernameConflict(createUserResult)) {
      throw new AuthUserServiceError(500, "创建用户失败，请稍后重试");
    }

    const findUserResult =
      await sudorouterService.findUserByUsernameWithLog(sudorouterUsername);
    if (!findUserResult.success || !findUserResult.data) {
      logSudorouterCall({
        userId: 0,
        userPhone: input.account,
        action: "SUDOROUTER_FIND_USER",
        method: findUserResult.request.method,
        url: findUserResult.request.url,
        requestBody: { username: sudorouterUsername },
        responseBody: findUserResult.response.data,
        responseStatus: findUserResult.response.status,
        durationMs: findUserResult.duration_ms,
        errorMessage: findUserResult.error || "查询用户失败",
      });
      throw new AuthUserServiceError(
        500,
        "Sudorouter 用户名已存在，但查询既有用户失败，请稍后重试",
      );
    }

    logSudorouterCall({
      userId: 0,
      userPhone: input.account,
      action: "SUDOROUTER_FIND_USER",
      resourceId: findUserResult.data.id,
      method: findUserResult.request.method,
      url: findUserResult.request.url,
      requestBody: { username: sudorouterUsername },
      responseBody: {
        success: true,
        id: findUserResult.data.id,
        username: findUserResult.data.username,
        quota: findUserResult.data.quota,
        used_quota: findUserResult.data.used_quota,
      },
      responseStatus: findUserResult.response.status,
      durationMs: findUserResult.duration_ms,
    });
    console.warn(
      `[AuthUserService] Sudorouter 用户名 ${sudorouterUsername} 已存在，绑定既有用户 ID ${findUserResult.data.id}`,
    );

    return {
      sudorouterUser: findUserResult.data,
      sudorouterUsername,
      createdSudorouterUser: false,
    };
  }

  private buildSudorouterUsername(input: ProvisionUserInput): string {
    const username = (input.sudorouterUsername || input.account).trim();
    if (!username) {
      throw new AuthUserServiceError(400, "Sudorouter 用户名为空");
    }
    return username;
  }

  private isSudorouterUsernameConflict(
    result: Awaited<ReturnType<typeof sudorouterService.createUserWithLog>>,
  ): boolean {
    const errorText = [
      result.error,
      JSON.stringify(result.response.data),
    ].join(" ");
    return /duplicate|already exists|unique|用户名|已存在/i.test(
      errorText,
    );
  }
}

export const authUserService = new AuthUserService();
