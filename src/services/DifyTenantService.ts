/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Idempotency wrapper around DifyClient.provisionTenant.
 *
 * Concurrency note: SQLite serializes writers, and our binding is keyed on
 * enterprise_id (PK). The first caller wins the INSERT; subsequent callers
 * read the existing row. A duplicate Dify tenant can still slip through if
 * two provisioning HTTP calls race — that's acceptable because we choose
 * the binding we successfully insert and the orphaned tenant is harmless.
 */

import { db } from "../db/index.js";
import { DifyClientError, provisionTenant } from "./DifyClient.js";

export interface TenantBindingRow {
  enterprise_id: number;
  dify_tenant_id: string;
  dify_system_account_id: string | null;
  api_key: string;
  created_at: number;
  updated_at: number;
}

function loadBinding(enterpriseId: number): TenantBindingRow | null {
  const row = db
    .prepare(`SELECT * FROM dify_tenant_binding WHERE enterprise_id = ?`)
    .get(enterpriseId) as TenantBindingRow | undefined;
  return row || null;
}

/**
 * Read-only accessor for the tenant binding. Returns null if the enterprise
 * has never provisioned a Dify tenant yet. Use this when you only need the
 * tenant id (e.g., writing a dataset binding) and don't want to trigger an
 * on-demand provision.
 */
export function getTenantBinding(enterpriseId: number): TenantBindingRow | null {
  return loadBinding(enterpriseId);
}

function loadEnterprise(enterpriseId: number): { id: number; code: string; name: string } {
  const row = db
    .prepare(`SELECT id, code, name FROM enterprises WHERE id = ?`)
    .get(enterpriseId) as { id: number; code: string; name: string } | undefined;
  if (!row) throw new Error(`enterprise ${enterpriseId} not found`);
  return row;
}

export async function ensureTenantBinding(enterpriseId: number): Promise<TenantBindingRow> {
  const existing = loadBinding(enterpriseId);
  if (existing) return existing;

  const enterprise = loadEnterprise(enterpriseId);
  const provisioned = await provisionTenant({
    enterpriseCode: enterprise.code,
    enterpriseName: enterprise.name,
  });

  const now = Math.floor(Date.now() / 1000);

  try {
    db.prepare(
      `INSERT INTO dify_tenant_binding (
         enterprise_id, dify_tenant_id, dify_system_account_id,
         api_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      enterpriseId,
      provisioned.dify_tenant_id,
      provisioned.system_account_id,
      provisioned.service_api_key,
      now,
      now,
    );
  } catch (err) {
    // Lost the race: another request already inserted. Return that row.
    const racedRow = loadBinding(enterpriseId);
    if (racedRow) return racedRow;
    throw err instanceof Error
      ? err
      : new DifyClientError(500, "ensureTenantBinding failed", err);
  }

  const stored = loadBinding(enterpriseId);
  if (!stored) {
    throw new DifyClientError(500, "binding insert succeeded but row not visible");
  }
  return stored;
}

export function findBinding(enterpriseId: number): TenantBindingRow | null {
  return loadBinding(enterpriseId);
}
