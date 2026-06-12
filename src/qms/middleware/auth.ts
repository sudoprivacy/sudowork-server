/**
 * QMS auth bridge.
 *
 * Telemetry ingestion keeps the QMS API-key contract. Admin-facing QMS routes
 * reuse sudowork-server JWTs and roles instead of the old QMS user/session
 * system.
 */

import type { Context, Next } from "hono";
import { db as serverDb } from "../../db/index.js";
import {
  authMiddleware,
  type UserPayload,
} from "../../middleware/auth.js";
import { config } from "../config/index.js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userRole: "admin" | "viewer";
    qmsTenantId: string | null;
    qmsCanViewAllTenants: boolean;
  }
}

function getEnterpriseTenantId(user: UserPayload): string | null {
  if (!user.enterprise_id) {
    return null;
  }

  const enterprise = serverDb
    .prepare("SELECT code FROM enterprises WHERE id = ?")
    .get(user.enterprise_id) as { code?: string } | undefined;

  return enterprise?.code || null;
}

/**
 * JWT authentication middleware for QMS admin APIs.
 */
export async function jwtAuth(c: Context, next: Next) {
  const authResponse = await authMiddleware(c, async () => {});
  if (authResponse) {
    return authResponse;
  }

  const user = c.get("user");
  if (!user || !["SUPER_ADMIN", "ENTERPRISE_ADMIN"].includes(user.role)) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      },
      403,
    );
  }

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const tenantId = isSuperAdmin ? null : getEnterpriseTenantId(user);

  if (!isSuperAdmin && !tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: "TENANT_NOT_FOUND",
          message: "Current administrator is not associated with a tenant",
        },
      },
      403,
    );
  }

  c.set("userId", String(user.id));
  c.set("userRole", isSuperAdmin ? "admin" : "viewer");
  c.set("qmsTenantId", tenantId);
  c.set("qmsCanViewAllTenants", isSuperAdmin);

  await next();
}

/**
 * API Key authentication middleware for telemetry and crash ingestion.
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKeyHeader = config.auth.apiKeyHeader;
  const apiKey = c.req.header(apiKeyHeader);
  const defaultApiKey = config.auth.defaultApiKey;

  if (!apiKey) {
    return c.json(
      {
        success: false,
        error: {
          code: "MISSING_API_KEY",
          message: `Missing ${apiKeyHeader} header`,
        },
      },
      401,
    );
  }

  if (!defaultApiKey) {
    return c.json(
      {
        success: false,
        error: {
          code: "API_KEY_NOT_CONFIGURED",
          message: "QMS API key not configured on server",
        },
      },
      500,
    );
  }

  if (apiKey !== defaultApiKey) {
    return c.json(
      {
        success: false,
        error: { code: "INVALID_API_KEY", message: "Invalid API key" },
      },
      401,
    );
  }

  await next();
}

/**
 * QMS-compatible role middleware.
 *
 * SUPER_ADMIN maps to the old QMS admin role. ENTERPRISE_ADMIN is read-only and
 * only passes routes that explicitly allow viewer access.
 */
export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const userRole = c.get("userRole");

    if (!userRole || !roles.includes(userRole)) {
      return c.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Insufficient permissions" },
        },
        403,
      );
    }

    await next();
  };
}
