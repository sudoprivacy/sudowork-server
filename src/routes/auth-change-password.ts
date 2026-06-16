/**
 * Third-party password change route.
 *
 * POST /api/v1/auth/change-password (鉴权, JWT)
 * 挂载:src/index.ts app.route("/api/v1/auth", authChangePasswordRoutes)
 *
 * 仅 login_method=1 (用户名密码) 时可用,且仅密码用户 (login_type=1) 可改自己密码。
 * 入参:{ oldPassword, newPassword };从 JWT payload 取用户 id。
 */

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { db } from "../db/index.js";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "../utils/password.js";
import { systemConfigService } from "../services/SystemConfigService.js";

const authChangePasswordRoutes = new Hono();

authChangePasswordRoutes.post("/change-password", authMiddleware, async (c) => {
  const payload = c.get("user");

  // 闸门 1:仅 login_method=1 时可用
  if (systemConfigService.getLoginMethod() !== 1) {
    return c.json(
      {
        success: false,
        msg: "当前系统未开启用户名密码登录，修改密码功能暂不可用",
      },
      403,
    );
  }

  const { oldPassword, newPassword } = await c.req.json();

  if (!oldPassword || !newPassword) {
    return c.json(
      { success: false, msg: "原始密码和新密码不能为空" },
      400,
    );
  }

  // 新密码强度校验
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    return c.json({ success: false, msg: strength.message }, 400);
  }

  // 闸门 2:仅密码用户 (login_type=1) 可改自己密码
  const user = db
    .prepare("SELECT * FROM users WHERE id = ? AND login_type = 1")
    .get(payload.id) as { password_hash?: string } | undefined;

  if (!user) {
    return c.json(
      {
        success: false,
        msg: "当前系统未开启用户名密码登录，修改密码功能暂不可用",
      },
      403,
    );
  }

  // 校验原始密码 (不暴露账号是否存在)
  const valid = await verifyPassword(oldPassword, user.password_hash || "");
  if (!valid) {
    return c.json({ success: false, msg: "原始密码错误" }, 401);
  }

  // 更新密码
  const newHash = await hashPassword(newPassword);
  db.run(
    "UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?",
    [newHash, payload.id],
  );

  return c.json({ success: true, msg: "密码修改成功" });
});

export { authChangePasswordRoutes };
