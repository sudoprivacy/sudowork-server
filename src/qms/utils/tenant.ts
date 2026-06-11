import type { Context } from "hono";
import { db as serverDb } from "../../db/index.js";
import { getAuthUser, type UserPayload } from "../../middleware/auth.js";
import { db } from "../db/index.js";

export interface TenantScope {
  tenantId: string | null;
  canViewAllTenants: boolean;
}

type TenantCandidate = Record<string, unknown> | null | undefined;

function normalizeTenantId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnterpriseTenantId(user: Pick<UserPayload, "enterprise_id">): string | undefined {
  if (!user.enterprise_id) {
    return undefined;
  }

  const enterprise = serverDb
    .prepare("SELECT code FROM enterprises WHERE id = ?")
    .get(user.enterprise_id) as { code?: string } | undefined;

  return normalizeTenantId(enterprise?.code);
}

function readTenantIdFromCandidate(candidate: TenantCandidate): string | undefined {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const direct =
    normalizeTenantId(candidate.tenant_id) ||
    normalizeTenantId(candidate.tenantId) ||
    normalizeTenantId(candidate.tenantID);
  if (direct) {
    return direct;
  }

  for (const nestedKey of ["data", "context", "user", "account", "auth", "tenant"]) {
    const nested = candidate[nestedKey];
    if (nested && typeof nested === "object") {
      const nestedTenantId = readTenantIdFromCandidate(nested as TenantCandidate);
      if (nestedTenantId) {
        return nestedTenantId;
      }
    }
  }

  return undefined;
}

export function getTenantScope(c: Context, requestedTenantId?: string | null): TenantScope {
  const canViewAllTenants = c.get("qmsCanViewAllTenants") === true;
  const currentTenantId = c.get("qmsTenantId") || null;

  if (!canViewAllTenants) {
    return {
      canViewAllTenants: false,
      tenantId: currentTenantId,
    };
  }

  return {
    canViewAllTenants: true,
    tenantId: requestedTenantId || null,
  };
}

export function tenantFilter(c: Context, requestedTenantId?: string | null) {
  const scope = getTenantScope(c, requestedTenantId);
  return scope.tenantId ? db`AND tenant_id = ${scope.tenantId}` : db``;
}

export function tenantWhereClause(
  c: Context,
  params: unknown[],
  column = "tenant_id",
  requestedTenantId?: string | null,
): string {
  const scope = getTenantScope(c, requestedTenantId);
  if (!scope.tenantId) {
    return "";
  }

  params.push(scope.tenantId);
  return `${column} = $${params.length}`;
}

export function requireTenantForScopedAdmin(c: Context): Response | null {
  if (c.get("qmsCanViewAllTenants") === true) {
    return null;
  }

  if (c.get("qmsTenantId")) {
    return null;
  }

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

export async function getTenantIdFromOptionalJwt(c: Context): Promise<string | undefined> {
  const user = await getAuthUser(c);
  if (!user) {
    return undefined;
  }

  const payloadTenantId = normalizeTenantId((user as UserPayload & { tenant_id?: string }).tenant_id);
  return payloadTenantId || getEnterpriseTenantId(user);
}

export function resolveTenantId(
  fallbackTenantId?: string | null,
  ...candidates: TenantCandidate[]
): string | undefined {
  for (const candidate of candidates) {
    const tenantId = readTenantIdFromCandidate(candidate);
    if (tenantId) {
      return tenantId;
    }
  }

  return normalizeTenantId(fallbackTenantId);
}

export function withResolvedTenantId<T extends Record<string, unknown>>(
  record: T,
  fallbackTenantId?: string | null,
  ...extraCandidates: TenantCandidate[]
): T {
  const tenantId = resolveTenantId(
    fallbackTenantId,
    record,
    ...extraCandidates,
  );

  return {
    ...record,
    tenant_id: tenantId ?? record.tenant_id ?? null,
  };
}
