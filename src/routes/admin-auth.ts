/**
 * Admin authentication routes
 */

import { Hono } from "hono";
import { sign } from "hono/jwt";
import { db, SECRET } from "../db/index.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimiter, rateLimitPresets } from "../middleware/rateLimiter.js";

const adminAuthRoutes = new Hono();

// POST /api/v1/admin/login - Admin login
adminAuthRoutes.post("/login", rateLimiter(rateLimitPresets.login), async (c) => {
  const { phone, password } = await c.req.json();

  if (!phone || !password) {
    return c.json(
      {
        success: false,
        msg: "账号或密码不能为空",
      },
      400,
    );
  }

  // Query admin (allow phone='sudo' or phone number)
  const admin = db
    .prepare(
      `
    SELECT * FROM users
    WHERE phone = ?
    AND role IN ('SUPER_ADMIN', 'ENTERPRISE_ADMIN')
  `,
    )
    .get(phone);

  if (!admin) {
    return c.json(
      {
        success: false,
        msg: "账号不存在",
      },
      404,
    );
  }

  // Verify password
  const validPassword = await verifyPassword(
    password,
    (admin as any).password_hash,
  );
  if (!validPassword) {
    return c.json(
      {
        success: false,
        msg: "密码错误",
      },
      401,
    );
  }

  // Generate JWT Token
  const token = await sign(
    {
      id: (admin as any).id,
      phone: (admin as any).phone,
      role: (admin as any).role,
      enterprise_id: (admin as any).enterprise_id,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    },
    SECRET,
  );

  return c.json({
    success: true,
    data: {
      token,
      user: {
        id: (admin as any).id,
        phone: (admin as any).phone,
        nickname: (admin as any).nickname,
        role: (admin as any).role,
        avatar: null,
      },
    },
  });
});

// POST /api/v1/admin/change-password - Change password
adminAuthRoutes.post("/change-password", authMiddleware, async (c) => {
  const payload = c.get("user");

  const { oldPassword, newPassword } = await c.req.json();

  if (!oldPassword || !newPassword) {
    return c.json(
      {
        success: false,
        msg: "旧密码和新密码不能为空",
      },
      400,
    );
  }

  // Password strength validation
  if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(newPassword)) {
    return c.json(
      {
        success: false,
        msg: "密码必须至少 8 位，包含字母和数字",
      },
      400,
    );
  }

  // Get current user
  const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);

  if (!admin) {
    return c.json({ success: false, msg: "用户不存在" }, 404);
  }

  // Verify old password
  const validPassword = await verifyPassword(
    oldPassword,
    (admin as any).password_hash,
  );
  if (!validPassword) {
    return c.json(
      {
        success: false,
        msg: "旧密码错误",
      },
      401,
    );
  }

  // Update password
  const newPasswordHash = await hashPassword(newPassword);
  db.run(
    `
    UPDATE users
    SET password_hash = ?, must_change_password = FALSE
    WHERE id = ?
  `,
    [newPasswordHash, payload.id],
  );

  return c.json({
    success: true,
    msg: "密码修改成功",
  });
});

export { adminAuthRoutes };