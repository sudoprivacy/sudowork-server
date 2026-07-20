import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index.js";
import { rateLimiter, rateLimitPresets } from "../middleware/rateLimiter.js";
import {
  authUserService,
  AuthUserServiceError,
} from "../services/AuthUserService.js";
import {
  casAuthService,
  CasAuthServiceError,
  type CasUserProfile,
} from "../services/CasAuthService.js";
import {
  systemConfigService,
  type ThirdPartyAuthProviderConfig,
} from "../services/SystemConfigService.js";
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

interface ThirdPartyAuthHandoff {
  id: number;
  code_hash: string;
  provider_id: string;
  user_id: number;
  external_user_id: string;
  expires_at: number;
  used_at: string | null;
}

interface ResolvedCasUser {
  provider: ThirdPartyAuthProviderConfig;
  profile: CasUserProfile;
  user: User;
  identity: ThirdPartyAuthIdentity;
}

class ThirdPartyAuthRouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const HANDOFF_TTL_SECONDS = 60;
const SUDOROUTER_USERNAME_MAX_LENGTH = 12;
const HASHED_SUDOROUTER_USERNAME_PREFIX = "c";
const thirdPartyAuthRoutes = new Hono();

thirdPartyAuthRoutes.post(
  "/third-party/cas/login",
  rateLimiter(rateLimitPresets.login),
  async (c) => {
    try {
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

      const resolved = await resolveCasAuthenticatedUser({
        providerId,
        ticket,
        service,
        operationPath: "/api/v1/auth/third-party/cas/login",
      });
      const deviceId = c.req.header("X-Device-Id") || "default";
      const data = await authUserService.buildLoginSuccessData(
        resolved.user,
        deviceId,
      );

      logThirdPartyLogin(resolved, {
        path: "/api/v1/auth/third-party/cas/login",
        method: "POST",
        exchangeType: "direct_ticket",
      });

      return c.json({ success: true, data });
    } catch (error) {
      return handleRouteError(c, error, "CAS login failed");
    }
  },
);

thirdPartyAuthRoutes.get(
  "/third-party/cas/callback/:provider",
  rateLimiter(rateLimitPresets.login),
  async (c) => {
    try {
      const providerId = c.req.param("provider");
      const ticket = c.req.query("ticket");
      if (!providerId || !ticket) {
        return renderCallbackPage({
          title: "认证回调失败",
          message: "CAS 回调参数不完整，请重新登录。",
        });
      }

      const provider = getEnabledCasProvider(providerId);
      if (provider.callback_mode !== "server_callback") {
        throw new ThirdPartyAuthRouteError(
          400,
          "当前 Provider 未启用服务端回调模式",
        );
      }
      if (!provider.server_callback_url) {
        throw new ThirdPartyAuthRouteError(400, "服务端回调 URL 未配置");
      }

      const resolved = await resolveCasAuthenticatedUser({
        providerId,
        ticket,
        service: provider.server_callback_url,
        operationPath: "/api/v1/auth/third-party/cas/callback",
      });
      const code = createHandoffCode(resolved);
      const redirectUrl = buildAppCallbackUrl(resolved.provider, code);

      return renderCallbackPage({
        title: "认证成功",
        message: "正在打开 Sudowork，请在浏览器提示中确认。",
        redirectUrl,
      });
    } catch (error) {
      console.error("[ThirdPartyAuth] CAS callback failed:", error);
      return renderCallbackPage({
        title: "认证回调失败",
        message:
          error instanceof Error
            ? error.message
            : "三方认证回调失败，请重新登录。",
      });
    }
  },
);

thirdPartyAuthRoutes.get("/third-party/cas/logout/callback/:provider", (c) => {
  const providerId = c.req.param("provider");
  if (!providerId) {
    return renderCallbackPage({
      title: "已退出登录",
      message: "CAS 已完成退出登录，请返回 Sudowork。",
    });
  }

  const provider = systemConfigService.getThirdPartyProvider(providerId) ?? {
    id: providerId,
    app_callback_url: "",
  };

  return renderCallbackPage({
    title: "已退出登录",
    message: "正在打开 Sudowork，请在浏览器提示中确认。",
    redirectUrl: buildAppLogoutCallbackUrl(provider),
  });
});

thirdPartyAuthRoutes.post(
  "/third-party/cas/exchange",
  rateLimiter(rateLimitPresets.login),
  async (c) => {
    try {
      const { provider: providerId, code } = await c.req.json();
      if (
        typeof providerId !== "string" ||
        typeof code !== "string" ||
        providerId.trim() === "" ||
        code.trim() === ""
      ) {
        return c.json({ success: false, msg: "参数不完整" }, 400);
      }

      const provider = getEnabledCasProvider(providerId);
      const handoff = consumeHandoffCode(provider.id, code);
      const user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(handoff.user_id) as User | undefined;
      if (!user) {
        throw new ThirdPartyAuthRouteError(401, "登录凭证已失效，请重新登录");
      }

      const deviceId = c.req.header("X-Device-Id") || "default";
      const data = await authUserService.buildLoginSuccessData(user, deviceId);

      logOperation({
        userId: user.id,
        userPhone: user.phone,
        action: "AUTH_THIRD_PARTY_LOGIN",
        resource: "third_party_auth_handoff",
        resourceId: handoff.id,
        method: "POST",
        path: "/api/v1/auth/third-party/cas/exchange",
        requestData: {
          provider_id: provider.id,
          external_user_id: handoff.external_user_id,
          exchange_type: "handoff_code",
        },
        responseData: { user_id: user.id, enterprise_id: user.enterprise_id },
      });

      return c.json({ success: true, data });
    } catch (error) {
      return handleRouteError(c, error, "CAS exchange failed");
    }
  },
);

async function resolveCasAuthenticatedUser(input: {
  providerId: string;
  ticket: string;
  service: string;
  operationPath: string;
}): Promise<ResolvedCasUser> {
  const provider = getEnabledCasProvider(input.providerId);
  const profile = await casAuthService.validateTicket(
    provider,
    input.service,
    input.ticket,
  );
  if (!profile.isActive) {
    throw new ThirdPartyAuthRouteError(403, "CAS 用户已被禁用");
  }

  const enterprise = db
    .prepare("SELECT * FROM enterprises WHERE code = ?")
    .get(provider.enterprise_code) as Enterprise | undefined;
  if (!enterprise) {
    throw new ThirdPartyAuthRouteError(
      500,
      "Provider 绑定企业不存在，请联系管理员",
    );
  }

  let identity = db
    .prepare(
      "SELECT * FROM third_party_auth_identities WHERE provider_id = ? AND external_user_id = ?",
    )
    .get(provider.id, profile.user) as ThirdPartyAuthIdentity | undefined;

  let user = identity
    ? (db.prepare("SELECT * FROM users WHERE id = ?").get(identity.user_id) as
        User | undefined)
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
        throw new ThirdPartyAuthRouteError(
          409,
          "CAS 账号对应的本地用户已存在但登录方式或企业不匹配，请联系管理员处理",
        );
      }
      user = existingUser;
    } else {
      if (provider.auto_provision !== 1) {
        throw new ThirdPartyAuthRouteError(
          403,
          "当前 Provider 未开启自动创建用户",
        );
      }
      user = await authUserService.createProvisionedUser({
        account: profile.account,
        nickname: profile.nickname,
        sudorouterUsername: buildProvisionedSudorouterUsername(
          provider,
          profile,
        ),
        enterprise,
        loginType: 2,
        operationPath: input.operationPath,
        invitationCodePrefix: provider.id,
      });
    }

    identity = upsertThirdPartyIdentity({
      providerId: provider.id,
      externalUserId: profile.user,
      user,
      rawProfile: toRawProfile(profile),
    });
  } else if (identity) {
    updateThirdPartyIdentityProfile(identity.id, toRawProfile(profile));
  }

  if (!identity) {
    throw new ThirdPartyAuthRouteError(500, "三方认证身份绑定失败");
  }

  return { provider, profile, user, identity };
}

function getEnabledCasProvider(
  providerId?: string,
): ThirdPartyAuthProviderConfig {
  if (systemConfigService.getLoginMethod() !== 2) {
    throw new ThirdPartyAuthRouteError(403, "当前系统未开启三方认证登录");
  }

  const configValue = systemConfigService.getThirdPartyAuth();
  if (configValue.enabled !== 1) {
    throw new ThirdPartyAuthRouteError(403, "三方认证配置未启用");
  }

  const provider = systemConfigService.getThirdPartyProvider(providerId);
  if (!provider || provider.enabled !== 1 || provider.type !== "cas") {
    throw new ThirdPartyAuthRouteError(400, "无效的三方认证 Provider");
  }

  return provider;
}

function buildProvisionedSudorouterUsername(
  provider: ThirdPartyAuthProviderConfig,
  profile: CasUserProfile,
): string {
  const principal = profile.user.trim();
  if (Array.from(principal).length <= SUDOROUTER_USERNAME_MAX_LENGTH) {
    return principal;
  }

  const suffixLength =
    SUDOROUTER_USERNAME_MAX_LENGTH - HASHED_SUDOROUTER_USERNAME_PREFIX.length;
  const hashSpace = 36n ** BigInt(suffixLength);
  const hash = BigInt(
    `0x${createHash("sha256")
      .update(`${provider.id}:${principal}`)
      .digest("hex")}`,
  );
  const suffix = (hash % hashSpace)
    .toString(36)
    .padStart(suffixLength, "0");
  return `${HASHED_SUDOROUTER_USERNAME_PREFIX}${suffix}`;
}

function createHandoffCode(resolved: ResolvedCasUser): string {
  const code = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.run(
    "DELETE FROM third_party_auth_handoffs WHERE expires_at < ? OR used_at IS NOT NULL",
    [now],
  );
  db.run(
    `INSERT INTO third_party_auth_handoffs (
      code_hash, provider_id, user_id, external_user_id, expires_at
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      hashHandoffCode(code),
      resolved.provider.id,
      resolved.user.id,
      resolved.profile.user,
      now + HANDOFF_TTL_SECONDS,
    ],
  );
  return code;
}

function consumeHandoffCode(
  providerId: string,
  code: string,
): ThirdPartyAuthHandoff {
  const now = Math.floor(Date.now() / 1000);
  const codeHash = hashHandoffCode(code);
  const handoff = db
    .prepare("SELECT * FROM third_party_auth_handoffs WHERE code_hash = ?")
    .get(codeHash) as ThirdPartyAuthHandoff | undefined;
  if (!handoff || handoff.provider_id !== providerId) {
    throw new ThirdPartyAuthRouteError(401, "登录凭证无效，请重新登录");
  }
  if (handoff.used_at || handoff.expires_at < now) {
    throw new ThirdPartyAuthRouteError(401, "登录凭证已失效，请重新登录");
  }

  const result = db.run(
    "UPDATE third_party_auth_handoffs SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL AND expires_at >= ?",
    [handoff.id, now],
  );
  if (result.changes !== 1) {
    throw new ThirdPartyAuthRouteError(401, "登录凭证已失效，请重新登录");
  }

  return handoff;
}

function hashHandoffCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function buildAppCallbackUrl(
  provider: ThirdPartyAuthProviderConfig,
  code: string,
): string {
  const fallback = `sudowork://cas-callback/${encodeURIComponent(provider.id)}/callback`;
  const url = new URL(provider.app_callback_url || fallback);
  url.searchParams.set("code", code);
  return url.toString();
}

function buildAppLogoutCallbackUrl(provider: {
  id: string;
  app_callback_url?: string;
}): string {
  const fallback = `sudowork://cas-callback/${encodeURIComponent(provider.id)}/logout`;
  const rawUrl = provider.app_callback_url || fallback;
  try {
    const url = new URL(rawUrl);
    url.pathname = url.pathname.replace(/\/callback\/?$/, "/logout");
    url.search = "";
    return url.toString();
  } catch {
    return fallback;
  }
}

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

function toRawProfile(profile: CasUserProfile): unknown {
  return {
    user: profile.user,
    username: profile.username,
    account: profile.account,
    nickname: profile.nickname,
    attributes: profile.attributes,
  };
}

function logThirdPartyLogin(
  resolved: ResolvedCasUser,
  input: {
    path: string;
    method: string;
    exchangeType: string;
  },
): void {
  logOperation({
    userId: resolved.user.id,
    userPhone: resolved.user.phone,
    action: "AUTH_THIRD_PARTY_LOGIN",
    resource: "third_party_auth",
    resourceId: resolved.identity.id,
    method: input.method,
    path: input.path,
    requestData: {
      provider_id: resolved.provider.id,
      external_user_id: resolved.profile.user,
      exchange_type: input.exchangeType,
    },
    responseData: {
      user_id: resolved.user.id,
      enterprise_id: resolved.user.enterprise_id,
    },
  });
}

function renderCallbackPage(input: {
  title: string;
  message: string;
  redirectUrl?: string;
}): Response {
  const redirectScript = input.redirectUrl
    ? `<script>setTimeout(function(){ window.location.href = ${JSON.stringify(input.redirectUrl)}; }, 300);</script>`
    : "";
  const button = input.redirectUrl
    ? `<a class="button" href="${escapeHtml(input.redirectUrl)}">打开 Sudowork</a>`
    : "";
  return new Response(
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f5f7fb;
        color: #1d2129;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(440px, calc(100vw - 32px));
        padding: 32px;
        border: 1px solid #e5e6eb;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 16px 48px rgba(29, 33, 41, 0.12);
        text-align: center;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0 0 24px;
        color: #4e5969;
        line-height: 1.7;
      }
      .button {
        display: inline-flex;
        height: 40px;
        align-items: center;
        justify-content: center;
        padding: 0 18px;
        border-radius: 6px;
        background: #165dff;
        color: #fff;
        font-weight: 600;
        text-decoration: none;
      }
    </style>
    ${redirectScript}
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.message)}</p>
      ${button}
    </main>
  </body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function handleRouteError(c: Context, error: unknown, logLabel: string) {
  if (
    error instanceof CasAuthServiceError ||
    error instanceof AuthUserServiceError ||
    error instanceof ThirdPartyAuthRouteError
  ) {
    return c.json(
      { success: false, msg: error.message },
      error.status as 400 | 401 | 403 | 409 | 500 | 502,
    );
  }
  console.error(`[ThirdPartyAuth] ${logLabel}:`, error);
  return c.json({ success: false, msg: "三方认证登录失败" }, 500);
}

export { thirdPartyAuthRoutes };
