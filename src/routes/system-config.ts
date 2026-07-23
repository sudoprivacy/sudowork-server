/**
 * System configuration routes.
 *
 * 双前缀挂载于 /api/v1 (见 src/index.ts: app.route("/api/v1", systemConfigRoutes)):
 * - GET  /system-config       公开,不鉴权(登录前获取登录方式)
 * - PUT  /admin/system-config SUPER_ADMIN,切换登录方式(切到验证码前校验短信通道)
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  systemConfigService,
  type ThirdPartyAuthConfig,
} from "../services/SystemConfigService.js";
import {
  authMiddleware,
  adminMiddleware,
  superAdminMiddleware,
} from "../middleware/auth.js";
import { config } from "../qms/config/index.js";
import { logOperation } from "../utils/logger.js";
import { encryptGcm } from "../utils/aes-gcm.js";

const systemConfigRoutes = new Hono();

// credentials 接口下发数据的对称加密 key (AES-256, 32 字节, 硬编码, 不可配置)
// 与 sudowork 客户端共享同一把; 客户端用相同 key + AES-256-GCM 解密。
const CREDENTIAL_AES_KEY = Buffer.from(
  "L7CbnQlwVrzWlaehCWSIiKuwBxFDh9i1AFaifYv7UXE=",
  "base64",
);

// 对外公开配置白名单:此接口仅返回以下 system_config key;新增配置必须在此登记 key+取值函数才对外暴露
const PUBLIC_CONFIG: Record<string, () => unknown> = {
  login_method: () => systemConfigService.getLoginMethod(),
  log_report: () => {
    const { enabled, protocol, domain } = systemConfigService.getLogReport();
    return enabled === 1
      ? { enabled: 1, baseurl: `${protocol}://${domain}` }
      : { enabled: 0 };
  },
  version_update: () => {
    const { enabled, cos_domain } = systemConfigService.getVersionUpdate();
    return enabled === 1 ? { enabled: 1, cos_domain } : { enabled: 0 };
  },
  product_improvement: () => {
    const { enabled } = systemConfigService.getProductImprovement();
    return enabled === 1
      ? {
          enabled: 1,
          encryption_required: config.encryption.encryptionRequired,
        }
      : { enabled: 0 };
  },
  sudorouter_baseurl: () =>
    (process.env.SUDOROUTER_BASE_URL || "").replace(/\/+$/, ""),
  skillhub_baseurl: () =>
    (process.env.SKILLHUB_BASE_URL || "").replace(/\/+$/, ""),
  scode_auto_model: () => systemConfigService.getScodeAutoModel(),
  third_party_auth: () => systemConfigService.getPublicThirdPartyAuth(),
};

function validateThirdPartyAuthConfig(
  configValue: ThirdPartyAuthConfig,
): string | null {
  if (configValue.enabled !== 1) {
    return "三方认证配置未启用";
  }

  const provider = configValue.providers.find(
    (item) => item.id === configValue.default_provider && item.enabled === 1,
  );
  if (!provider) {
    return "默认三方认证 Provider 不存在或未启用";
  }

  if (provider.type !== "cas") {
    return "当前仅支持 CAS 类型 Provider";
  }

  try {
    const url = new URL(provider.cas_url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "CAS URL 必须使用 http 或 https";
    }
  } catch {
    return "CAS URL 格式不正确";
  }

  if (
    !provider.login_path ||
    !provider.validate_path ||
    !provider.logout_path ||
    !provider.service_param
  ) {
    return "CAS 登录地址、校验地址、登出地址和 service 参数名不能为空";
  }

  if (provider.logout_service_url) {
    try {
      const logoutServiceUrl = new URL(provider.logout_service_url);
      if (
        logoutServiceUrl.protocol !== "http:" &&
        logoutServiceUrl.protocol !== "https:"
      ) {
        return "登出回跳 URL 必须使用 http 或 https";
      }
    } catch {
      return "登出回跳 URL 格式不正确";
    }
  }

  if (
    provider.callback_mode !== "direct_app" &&
    provider.callback_mode !== "server_callback"
  ) {
    return "三方认证回调模式不正确";
  }

  if (provider.callback_mode === "server_callback") {
    try {
      const callbackUrl = new URL(provider.server_callback_url);
      if (
        callbackUrl.protocol !== "http:" &&
        callbackUrl.protocol !== "https:"
      ) {
        return "服务端回调 URL 必须使用 http 或 https";
      }
    } catch {
      return "服务端回调 URL 格式不正确";
    }
  }

  if (!provider.app_callback_url) {
    return "App 回调 URL 不能为空";
  }

  if (!provider.enterprise_code) {
    return "Provider 绑定企业码不能为空";
  }

  const enterprise = db
    .prepare("SELECT id FROM enterprises WHERE code = ?")
    .get(provider.enterprise_code);
  if (!enterprise) {
    return `Provider 绑定企业码 ${provider.enterprise_code} 不存在`;
  }

  return null;
}

// GET /api/v1/system-config — 公开,登录页/第三方在登录前读取(白名单驱动)
systemConfigRoutes.get("/system-config", (c) => {
  const data: Record<string, unknown> = {};
  for (const [key, getter] of Object.entries(PUBLIC_CONFIG)) {
    data[key] = getter();
  }
  return c.json({ success: true, data });
});

// GET /api/v1/admin/system-config — 鉴权,后台渲染系统配置页(全量,无白名单)
systemConfigRoutes.get(
  "/admin/system-config",
  authMiddleware,
  adminMiddleware,
  (c) => {
    return c.json({
      success: true,
      data: {
        login_method: systemConfigService.getLoginMethod(),
        sms_configured: systemConfigService.isSmsChannelConfigured(),
        third_party_auth: systemConfigService.getThirdPartyAuth(),
        log_report: (() => {
          const lr = systemConfigService.getLogReport();
          return {
            enabled: lr.enabled,
            protocol: lr.protocol ?? "",
            domain: lr.domain ?? "",
            key: "",
            key_set: !!lr.key_set,
          };
        })(),
        version_update: systemConfigService.getVersionUpdate(),
        product_improvement: systemConfigService.getProductImprovement(),
        scode_auto_model: systemConfigService.getScodeAutoModel(),
      },
    });
  },
);

// PUT /api/v1/admin/system-config — SUPER_ADMIN 部分更新 system_config
// body 里没传的字段一律跳过;login_method 校验与写入逻辑原样保留。
systemConfigRoutes.put(
  "/admin/system-config",
  authMiddleware,
  superAdminMiddleware,
  async (c) => {
    const body = await c.req.json();
    const operator = c.get("user");
    const changes: Record<string, { before: unknown; after: unknown }> = {};

    let nextThirdPartyAuth = systemConfigService.getThirdPartyAuth();
    if (body.third_party_auth !== undefined) {
      const before = systemConfigService.getThirdPartyAuth();
      nextThirdPartyAuth = systemConfigService.normalizeThirdPartyAuth(
        body.third_party_auth,
      );
      const validationError =
        nextThirdPartyAuth.enabled === 1
          ? validateThirdPartyAuthConfig(nextThirdPartyAuth)
          : null;
      if (validationError) {
        return c.json({ success: false, msg: validationError }, 400);
      }
      systemConfigService.setThirdPartyAuth(nextThirdPartyAuth);
      changes.third_party_auth = { before, after: nextThirdPartyAuth };
    }

    if (body.login_method !== undefined) {
      const { login_method } = body;

      if (login_method !== 0 && login_method !== 1 && login_method !== 2) {
        return c.json({ success: false, msg: "无效的登录方式" }, 400);
      }

      // 切到手机验证码(0)前必须校验短信通道已真正配置
      if (login_method === 0 && !systemConfigService.isSmsChannelConfigured()) {
        return c.json(
          {
            success: false,
            msg: "短信通道未配置,无法切换到手机验证码",
          },
          400,
        );
      }

      if (login_method === 2) {
        const validationError =
          validateThirdPartyAuthConfig(nextThirdPartyAuth);
        if (validationError) {
          return c.json({ success: false, msg: validationError }, 400);
        }
      }

      const before = systemConfigService.getLoginMethod();
      systemConfigService.setLoginMethod(login_method);
      changes.login_method = { before, after: login_method };
    }

    if (body.scode_auto_model !== undefined) {
      if (typeof body.scode_auto_model !== "string") {
        return c.json(
          { success: false, msg: "Sudowork Auto 默认模型必须为字符串" },
          400,
        );
      }
      const before = systemConfigService.getScodeAutoModel();
      const after = body.scode_auto_model.trim();
      systemConfigService.setScodeAutoModel(after);
      changes.scode_auto_model = { before, after };
    }

    if (body.log_report !== undefined) {
      const { enabled, protocol, domain, key } = body.log_report;
      const before = systemConfigService.getLogReport();
      if (enabled === 1) {
        if (protocol !== "http" && protocol !== "https") {
          return c.json(
            {
              success: false,
              msg: "日志上报开启时,协议类型必须为 http 或 https",
            },
            400,
          );
        }
        if (!domain || typeof domain !== "string" || domain.trim() === "") {
          return c.json(
            { success: false, msg: "日志上报开启时,域名必填且非空" },
            400,
          );
        }
        if (!(
          (typeof key === "string" && key.length > 0) ||
          before.key_set === true
        )) {
          return c.json(
            { success: false, msg: "日志上报开启时,Key 必填" },
            400,
          );
        }
      }
      await systemConfigService.setLogReport({
        enabled: enabled === 1 ? 1 : 0,
        protocol: protocol ?? "",
        domain: domain ?? "",
        key,
      });
      const afterKeySet =
        before.key_set || (typeof key === "string" && key.length > 0);
      changes.log_report = {
        before: {
          enabled: before.enabled,
          protocol: before.protocol,
          domain: before.domain,
          key_set: before.key_set,
        },
        after: {
          enabled: enabled === 1 ? 1 : 0,
          protocol: protocol ?? "",
          domain: domain ?? "",
          key_set: afterKeySet,
        },
      };
    }

    if (body.version_update !== undefined) {
      const { enabled, cos_domain } = body.version_update;
      if (enabled === 1) {
        if (
          !cos_domain ||
          typeof cos_domain !== "string" ||
          cos_domain.trim() === ""
        ) {
          return c.json(
            {
              success: false,
              msg: "版本自动更新开启时,COS 访问域名必填且非空",
            },
            400,
          );
        }
      }
      const before = systemConfigService.getVersionUpdate();
      systemConfigService.setVersionUpdate({
        enabled: enabled === 1 ? 1 : 0,
        cos_domain: cos_domain ?? "",
      });
      changes.version_update = {
        before,
        after: { enabled: enabled === 1 ? 1 : 0, cos_domain: cos_domain ?? "" },
      };
    }

    if (body.product_improvement !== undefined) {
      const { enabled } = body.product_improvement;
      if (enabled === 1) {
        if (!config.auth.defaultApiKey) {
          return c.json(
            {
              success: false,
              msg: "未配置 QMS_DEFAULT_API_KEY,无法开启产品改进计划",
            },
            400,
          );
        }
        if (config.encryption.encryptionRequired) {
          if (!config.encryption.privateKeyPem) {
            return c.json(
              {
                success: false,
                msg: "已开启遥测加密(QMS_TELEMETRY_ENCRYPTION_REQUIRED=true),但未配置 QMS_TELEMETRY_PRIVATE_KEY",
              },
              400,
            );
          }
          if (!config.encryption.publicKeyPem) {
            return c.json(
              {
                success: false,
                msg: "已开启遥测加密(QMS_TELEMETRY_ENCRYPTION_REQUIRED=true),但未配置 QMS_TELEMETRY_PUBLIC_KEY",
              },
              400,
            );
          }
        }
      }
      // ↓ 新增 before 读取 + changes 记录;setProductImprovement 改为仅传 enabled(去除 protocol/domain)
      const before = systemConfigService.getProductImprovement();
      systemConfigService.setProductImprovement({
        enabled: enabled === 1 ? 1 : 0,
      });
      changes.product_improvement = {
        before,
        after: { enabled: enabled === 1 ? 1 : 0 },
      };
    }

    if (Object.keys(changes).length > 0) {
      logOperation({
        userId: operator?.id ?? 0,
        userPhone: operator?.phone ?? "",
        action: "SYSTEM_CONFIG_UPDATE",
        resource: "system_config",
        method: "PUT",
        path: "/api/v1/admin/system-config",
        requestData: changes,
      });
    }
    return c.json({
      success: true,
      msg: "系统配置更新成功",
    });
  },
);

// GET /api/v1/system-config/credentials — 登录鉴权下发敏感凭证(任何有效登录用户可访问)
// skillhub token 等敏感信息走此接口,公开接口不暴露。
systemConfigRoutes.get(
  "/system-config/credentials",
  authMiddleware,
  async (c) => {
    const data: Record<string, unknown> = {
      skillhub: { token: process.env.SKILLHUB_API_TOKEN || "" },
    };
    const lr = systemConfigService.getLogReport();
    if (lr.enabled === 1 && lr.key_set) {
      const k = await systemConfigService.getLogReportKeyPlaintext();
      if (k) data.log_report = { key: k };
    }
    if (systemConfigService.getProductImprovement().enabled === 1) {
      const pi: Record<string, string> = {
        api_key: config.auth.defaultApiKey || "",
      };
      if (config.encryption.encryptionRequired) {
        pi.public_key = config.encryption.publicKeyPem || "";
      }
      data.product_improvement = pi;
    }
    const encrypted = await encryptGcm(
      new TextEncoder().encode(JSON.stringify(data)),
      CREDENTIAL_AES_KEY,
    );
    return c.json({
      success: true,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    });
  },
);

export { systemConfigRoutes };
