/**
 * System configuration routes.
 *
 * 双前缀挂载于 /api/v1 (见 src/index.ts: app.route("/api/v1", systemConfigRoutes)):
 * - GET  /system-config       公开,不鉴权(登录前获取登录方式)
 * - PUT  /admin/system-config SUPER_ADMIN,切换登录方式(切到验证码前校验短信通道)
 */

import { Hono } from "hono";
import { systemConfigService } from "../services/SystemConfigService.js";
import { authMiddleware, adminMiddleware, superAdminMiddleware } from "../middleware/auth.js";

const systemConfigRoutes = new Hono();

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
    const { enabled, protocol, domain } = systemConfigService.getProductImprovement();
    return enabled === 1
      ? { enabled: 1, baseurl: `${protocol}://${domain}` }
      : { enabled: 0 };
  },
  sudorouter_baseurl: () =>
    (process.env.SUDOROUTER_BASE_URL || "").replace(/\/+$/, ""),
  skillhub_baseurl: () =>
    (process.env.SKILLHUB_BASE_URL || "").replace(/\/+$/, ""),
};

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
        log_report: systemConfigService.getLogReport(),
        version_update: systemConfigService.getVersionUpdate(),
        product_improvement: systemConfigService.getProductImprovement(),
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

    if (body.login_method !== undefined) {
      const { login_method } = body;

      if (login_method !== 0 && login_method !== 1) {
        return c.json(
          { success: false, msg: "无效的登录方式" },
          400,
        );
      }

      // 切到手机验证码(0)前必须校验短信通道已真正配置
      if (
        login_method === 0 &&
        !systemConfigService.isSmsChannelConfigured()
      ) {
        return c.json(
          {
            success: false,
            msg: "短信通道未配置,无法切换到手机验证码",
          },
          400,
        );
      }

      systemConfigService.setLoginMethod(login_method);
    }

    if (body.log_report !== undefined) {
      const { enabled, protocol, domain } = body.log_report;
      if (enabled === 1) {
        if (protocol !== "http" && protocol !== "https") {
          return c.json(
            { success: false, msg: "日志上报开启时,协议类型必须为 http 或 https" },
            400,
          );
        }
        if (!domain || typeof domain !== "string" || domain.trim() === "") {
          return c.json(
            { success: false, msg: "日志上报开启时,域名必填且非空" },
            400,
          );
        }
      }
      systemConfigService.setLogReport({
        enabled: enabled === 1 ? 1 : 0,
        protocol: protocol ?? "",
        domain: domain ?? "",
      });
    }

    if (body.version_update !== undefined) {
      const { enabled, cos_domain } = body.version_update;
      if (enabled === 1) {
        if (!cos_domain || typeof cos_domain !== "string" || cos_domain.trim() === "") {
          return c.json(
            { success: false, msg: "版本自动更新开启时,COS 访问域名必填且非空" },
            400,
          );
        }
      }
      systemConfigService.setVersionUpdate({
        enabled: enabled === 1 ? 1 : 0,
        cos_domain: cos_domain ?? "",
      });
    }

    if (body.product_improvement !== undefined) {
      const { enabled, protocol, domain } = body.product_improvement;
      if (enabled === 1) {
        if (protocol !== "http" && protocol !== "https") {
          return c.json(
            { success: false, msg: "参与产品改进计划开启时,协议类型必须为 http 或 https" },
            400,
          );
        }
        if (!domain || typeof domain !== "string" || domain.trim() === "") {
          return c.json(
            { success: false, msg: "参与产品改进计划开启时,域名必填且非空" },
            400,
          );
        }
      }
      systemConfigService.setProductImprovement({
        enabled: enabled === 1 ? 1 : 0,
        protocol: protocol ?? "",
        domain: domain ?? "",
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
  (c) => {
    return c.json({
      success: true,
      data: {
        skillhub: { token: process.env.SKILLHUB_API_TOKEN || "" },
      },
    });
  },
);

export { systemConfigRoutes };
