/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Context } from "hono";
import { verify } from "hono/jwt";

const SECRET = process.env.JWT_SECRET || "sudowork-secret-key";

export interface UserPayload {
  id: number;
  phone: string;
  role: string;
  enterprise_id?: number | null;
  exp?: number;
}

declare module "hono" {
  interface ContextVariableMap {
    user: UserPayload;
  }
}

export async function getAuthUser(c: Context): Promise<UserPayload | null> {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = await verify(token, SECRET, "HS256");
    return payload as UserPayload;
  } catch {
    return null;
  }
}

/**
 * Authentication middleware - verify JWT token
 */
export async function authMiddleware(c: Context, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        msg: "未授权，请先登录",
      },
      401,
    );
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = await verify(token, SECRET, "HS256");
    c.set("user", payload as UserPayload);
    await next();
  } catch (e) {
    return c.json(
      {
        success: false,
        msg: "Token 无效或已过期",
      },
      401,
    );
  }
}

/**
 * Admin authorization middleware - verify admin role
 */
export async function adminMiddleware(c: Context, next: () => Promise<void>) {
  const user = c.get("user");

  if (!user || !["SUPER_ADMIN", "ENTERPRISE_ADMIN"].includes(user.role)) {
    return c.json(
      {
        success: false,
        msg: "权限不足",
      },
      403,
    );
  }

  await next();
}

/**
 * Super admin authorization middleware
 */
export async function superAdminMiddleware(
  c: Context,
  next: () => Promise<void>,
) {
  const user = c.get("user");

  if (!user || user.role !== "SUPER_ADMIN") {
    return c.json(
      {
        success: false,
        msg: "仅超级管理员可操作",
      },
      403,
    );
  }

  await next();
}
