/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Helper to resolve the effective `enterprise_id` for an admin request.
 *
 * Rules:
 *   - SUPER_ADMIN must explicitly pass an enterprise_id (via query, body, or
 *     form field). Missing or non-numeric → 400. We also validate that the
 *     enterprise actually exists.
 *   - ENTERPRISE_ADMIN auto-binds to their own JWT enterprise_id. If they
 *     pass a *different* enterprise_id they get 403 (defense-in-depth so the
 *     server doesn't trust the client to scope itself).
 *
 * All `/admin/dify/*` routes that used to read `user.enterprise_id` directly
 * should call this helper instead. That single change is what lets a super
 * admin operate across tenants without breaking the existing enterprise-admin
 * "auto-scope to my company" semantics.
 */

import type { Context } from "hono";

import { db } from "../db/index.js";

export type ResolveSource =
  | { kind: "query"; param: string }
  | { kind: "body"; value: unknown };

export type ResolveResult =
  | { ok: true; enterpriseId: number }
  | { ok: false; status: 400 | 403; msg: string };

function parseEnterpriseId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function enterpriseExists(id: number): boolean {
  const row = db.prepare("SELECT id FROM enterprises WHERE id = ?").get(id);
  return row != null;
}

export function resolveAdminEnterpriseId(c: Context, source: ResolveSource): ResolveResult {
  const user = c.get("user");

  let requested: number | null;
  if (source.kind === "query") {
    requested = parseEnterpriseId(c.req.query(source.param));
  } else {
    requested = parseEnterpriseId(source.value);
  }

  if (user.role === "SUPER_ADMIN") {
    if (requested == null) {
      return {
        ok: false,
        status: 400,
        msg: "super admin must specify enterprise_id",
      };
    }
    if (!enterpriseExists(requested)) {
      return { ok: false, status: 400, msg: `enterprise ${requested} not found` };
    }
    return { ok: true, enterpriseId: requested };
  }

  // Enterprise admin / other authenticated roles fall through to JWT scope.
  if (user.enterprise_id == null) {
    return { ok: false, status: 400, msg: "user has no enterprise" };
  }

  if (requested != null && requested !== user.enterprise_id) {
    return { ok: false, status: 403, msg: "cannot operate on another enterprise" };
  }

  return { ok: true, enterpriseId: user.enterprise_id };
}

/**
 * Sugar for the most common pattern: resolve from query param `enterprise_id`.
 */
export function resolveFromQuery(c: Context): ResolveResult {
  return resolveAdminEnterpriseId(c, { kind: "query", param: "enterprise_id" });
}

/**
 * Sugar for body-driven resolution (PUT / POST handlers parsing JSON).
 */
export function resolveFromBody(
  c: Context,
  body: { enterprise_id?: number | string } | null | undefined,
): ResolveResult {
  return resolveAdminEnterpriseId(c, { kind: "body", value: body?.enterprise_id });
}
