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
      },
    });
  },
);

// PUT /api/v1/admin/system-config — SUPER_ADMIN 切换登录方式
systemConfigRoutes.put(
  "/admin/system-config",
  authMiddleware,
  superAdminMiddleware,
  async (c) => {
    const { login_method } = await c.req.json();

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

    return c.json({
      success: true,
      msg: "登录方式更新成功",
      data: { login_method },
    });
  },
);

export { systemConfigRoutes };
