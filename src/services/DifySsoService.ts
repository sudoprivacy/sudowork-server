/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mint a short-lived JWT that the SudoWork admin browser carries to Dify's
 * /sudowork/sso/exchange endpoint. Dify verifies the signature, claims the
 * jti against its Redis nonce store, then issues normal console cookies.
 *
 * We use `hono/jwt` (HS256) so signing stays consistent with the rest of
 * sudowork-server; the secret here is DIFY_SSO_SECRET, distinct from the
 * standard JWT_SECRET because that one is bound to SudoWork's own auth.
 */

import { randomUUID } from "node:crypto";
import { sign } from "hono/jwt";

import { db } from "../db/index.js";

const SSO_SECRET = process.env.DIFY_SSO_SECRET || "";
const DEFAULT_TTL_SECONDS = 5 * 60;
const DIFY_BASE_URL = (process.env.DIFY_BASE_URL || "http://localhost:5001").replace(/\/+$/, "");

export interface SsoTokenInput {
  sudoworkUserId: number | string;
  email?: string;
  name?: string;
  enterpriseCode: string;
  difyTenantId: string;
  role?: "admin" | "owner" | "editor" | "normal";
}

export interface SsoLink {
  url: string;
  expiresAt: number;
  jti: string;
}

function ensureSecret(): string {
  if (!SSO_SECRET) {
    throw new Error("DIFY_SSO_SECRET not configured: cannot mint SSO tokens");
  }
  return SSO_SECRET;
}

/**
 * Resolve the Dify tenant id from the local binding table; throws if the
 * enterprise has not been provisioned yet (caller should provision first).
 */
export function getDifyTenantIdForEnterprise(enterpriseId: number): string {
  const row = db
    .prepare(`SELECT dify_tenant_id FROM dify_tenant_binding WHERE enterprise_id = ?`)
    .get(enterpriseId) as { dify_tenant_id: string } | undefined;
  if (!row) {
    throw new Error(`enterprise ${enterpriseId} not provisioned in Dify`);
  }
  return row.dify_tenant_id;
}

export async function mintSsoToken(
  input: SsoTokenInput,
  opts: { ttlSeconds?: number } = {},
): Promise<{ token: string; jti: string; exp: number }> {
  const secret = ensureSecret();
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;
  const jti = randomUUID();
  const role = input.role || "admin";

  const payload = {
    sub: String(input.sudoworkUserId),
    email: input.email || undefined,
    name: input.name || undefined,
    enterprise_code: input.enterpriseCode,
    dify_tenant_id: input.difyTenantId,
    role,
    iat: now,
    exp,
    jti,
  };

  const token = await sign(payload, secret, "HS256");
  return { token, jti, exp };
}

export async function buildSsoLink(
  input: SsoTokenInput,
  opts: { next?: string; ttlSeconds?: number } = {},
): Promise<SsoLink> {
  const { token, jti, exp } = await mintSsoToken(input, { ttlSeconds: opts.ttlSeconds });
  const nextParam = opts.next ? `&next=${encodeURIComponent(opts.next)}` : "";
  return {
    url: `${DIFY_BASE_URL}/sudowork/sso/exchange?token=${encodeURIComponent(token)}${nextParam}`,
    expiresAt: exp,
    jti,
  };
}
