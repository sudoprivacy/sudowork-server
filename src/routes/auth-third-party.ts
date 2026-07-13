import { Hono } from "hono";
import { db } from "../db/index.js";
import { rateLimiter, rateLimitPresets } from "../middleware/rateLimiter.js";
import {
  authUserService,
  AuthUserServiceError,
} from "../services/AuthUserService.js";
import {
  casAuthService,
  CasAuthServiceError,
} from "../services/CasAuthService.js";
import { systemConfigService } from "../services/SystemConfigService.js";
import { logOperation } from "../utils/logger.js";
import type { Enterprise, User } from "../types/index.js";

interface ThirdPartyAuthIdentity {
  id: number;
  provider_id: string;
  external_user_id: string;
  user_id: number;
  enterprise_id: number;
  raw_profile: string | null;
}

const thirdPartyAuthRoutes = new Hono();

thirdPartyAuthRoutes.post(
  "/third-party/cas/login",
  rateLimiter(rateLimitPresets.login),
  async (c) => {
    try {
      if (systemConfigService.getLoginMethod() !== 2) {
        return c.json(
          { success: false, msg: "当前系统未开启三方认证登录" },
          403,
        );
      }

      const { provider: providerId, ticket, service } = await c.req.json();
      if (
        typeof providerId !== "string" ||
        typeof ticket !== "string" ||
        typeof service !== "string" ||
        providerId.trim() === "" ||
        ticket.trim() === "" ||
        service.trim() === ""
      ) {
        return c.json({ success: false, msg: "参数不完整" }, 400);
      }

      const configValue = systemConfigService.getThirdPartyAuth();
      if (configValue.enabled !== 1) {
        return c.json({ success: false, msg: "三方认证配置未启用" }, 403);
      }

      const provider = systemConfigService.getThirdPartyProvider(providerId);
      if (!provider || provider.enabled !== 1 || provider.type !== "cas") {
        return c.json({ success: false, msg: "无效的三方认证 Provider" }, 400);
      }

      const profile = await casAuthService.validateTicket(
        provider,
        service,
        ticket,
      );
      if (!profile.isActive) {
        return c.json({ success: false, msg: "CAS 用户已被禁用" }, 403);
      }

      const enterprise = db
        .prepare("SELECT * FROM enterprises WHERE code = ?")
        .get(provider.enterprise_code) as Enterprise | undefined;
      if (!enterprise) {
        return c.json(
          { success: false, msg: "Provider 绑定企业不存在，请联系管理员" },
          500,
        );
      }

      let identity = db
        .prepare(
          "SELECT * FROM third_party_auth_identities WHERE provider_id = ? AND external_user_id = ?",
        )
        .get(provider.id, profile.user) as ThirdPartyAuthIdentity | undefined;

      let user = identity
        ? (db
            .prepare("SELECT * FROM users WHERE id = ?")
            .get(identity.user_id) as User | undefined)
        : undefined;

      if (identity && !user) {
        db.run("DELETE FROM third_party_auth_identities WHERE id = ?", [
          identity.id,
        ]);
        identity = undefined;
      }

      if (!user) {
        const existingUser = db
          .prepare("SELECT * FROM users WHERE phone = ?")
          .get(profile.account) as User | undefined;

        if (existingUser) {
          if (
            existingUser.enterprise_id !== enterprise.id ||
            existingUser.login_type !== 2
          ) {
            return c.json(
              {
                success: false,
                msg: "CAS 账号对应的本地用户已存在但登录方式或企业不匹配，请联系管理员处理",
              },
              409,
            );
          }
          user = existingUser;
        } else {
          if (provider.auto_provision !== 1) {
            return c.json(
              { success: false, msg: "当前 Provider 未开启自动创建用户" },
              403,
            );
          }
          user = await authUserService.createProvisionedUser({
            account: profile.account,
            nickname: profile.nickname,
            enterprise,
            loginType: 2,
            operationPath: "/api/v1/auth/third-party/cas/login",
            invitationCodePrefix: provider.id,
          });
        }

        identity = upsertThirdPartyIdentity({
          providerId: provider.id,
          externalUserId: profile.user,
          user,
          rawProfile: {
            user: profile.user,
            username: profile.username,
            account: profile.account,
            nickname: profile.nickname,
            attributes: profile.attributes,
          },
        });
      } else if (identity) {
        updateThirdPartyIdentityProfile(identity.id, {
          user: profile.user,
          username: profile.username,
          account: profile.account,
          nickname: profile.nickname,
          attributes: profile.attributes,
        });
      }

      const deviceId = c.req.header("X-Device-Id") || "default";
      const data = await authUserService.buildLoginSuccessData(user, deviceId);

      logOperation({
        userId: user.id,
        userPhone: user.phone,
        action: "AUTH_THIRD_PARTY_LOGIN",
        resource: "third_party_auth",
        resourceId: identity?.id,
        method: "POST",
        path: "/api/v1/auth/third-party/cas/login",
        requestData: {
          provider_id: provider.id,
          external_user_id: profile.user,
        },
        responseData: { user_id: user.id, enterprise_id: user.enterprise_id },
      });

      return c.json({ success: true, data });
    } catch (error) {
      if (
        error instanceof CasAuthServiceError ||
        error instanceof AuthUserServiceError
      ) {
        return c.json(
          { success: false, msg: error.message },
          error.status as 400 | 401 | 403 | 409 | 500 | 502,
        );
      }
      console.error("[ThirdPartyAuth] CAS login failed:", error);
      return c.json({ success: false, msg: "三方认证登录失败" }, 500);
    }
  },
);

function upsertThirdPartyIdentity(input: {
  providerId: string;
  externalUserId: string;
  user: User;
  rawProfile: unknown;
}): ThirdPartyAuthIdentity {
  const rawProfile = JSON.stringify(input.rawProfile);
  db.run(
    `INSERT OR IGNORE INTO third_party_auth_identities (
      provider_id, external_user_id, user_id, enterprise_id, raw_profile
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      input.providerId,
      input.externalUserId,
      input.user.id,
      input.user.enterprise_id,
      rawProfile,
    ],
  );
  db.run(
    `UPDATE third_party_auth_identities
     SET user_id = ?, enterprise_id = ?, raw_profile = ?, updated_at = datetime('now')
     WHERE provider_id = ? AND external_user_id = ?`,
    [
      input.user.id,
      input.user.enterprise_id,
      rawProfile,
      input.providerId,
      input.externalUserId,
    ],
  );
  return db
    .prepare(
      "SELECT * FROM third_party_auth_identities WHERE provider_id = ? AND external_user_id = ?",
    )
    .get(input.providerId, input.externalUserId) as ThirdPartyAuthIdentity;
}

function updateThirdPartyIdentityProfile(
  identityId: number,
  rawProfileValue: unknown,
): void {
  db.run(
    "UPDATE third_party_auth_identities SET raw_profile = ?, updated_at = datetime('now') WHERE id = ?",
    [JSON.stringify(rawProfileValue), identityId],
  );
}

export { thirdPartyAuthRoutes };
