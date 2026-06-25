/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Domain logic for "agents" (a.k.a. assistants in the user-facing UI) backed
 * by a Dify App. SudoWork is the source of truth for:
 *   - the app↔assistant binding         (table: dify_app_binding)
 *   - visibility ACL                    (table: assistant_acl)
 *   - knowledge-base attachment         (table: dify_dataset_binding)
 *
 * Dify owns the App definition (prompt/workflow/model) and dataset content.
 * The assistant_id here is the sudohub assistant uuid; we mirror it into
 * dify_app_binding so a user-facing assistant card maps deterministically to
 * a Dify app on dispatch.
 *
 * For P0+P1 we generate a local assistant_id when sudohub integration is not
 * yet wired up. Once sudohub supports the dify_app_id field this service will
 * also call the sudohub API to persist the assistant document.
 */

import { randomUUID } from "node:crypto";

import { db } from "../db/index.js";
import { system as difySystem } from "./DifyClient.js";
import { ensureTenantBinding, getTenantBinding } from "./DifyTenantService.js";
import * as sudohub from "./SudohubClient.js";

export type AgentMode =
  | "chat"
  | "agent-chat"
  | "agent"
  | "advanced-chat"
  | "workflow"
  | "completion";

export interface AgentSummary {
  assistantId: string;
  enterpriseId: number;
  difyTenantId: string;
  difyAppId: string;
  difyAppMode: string;
  createdAt: number;
  updatedAt: number;
}

export type AclSubjectType = "user" | "department" | "role" | "all";

export interface AclEntry {
  subjectType: AclSubjectType;
  subjectId: string | null;
}

interface UserSummary {
  id: number;
  role: string;
  enterpriseId: number | null;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

interface CreateAgentInput {
  enterpriseId: number;
  name: string;
  description?: string;
  mode?: AgentMode;
  icon?: string;
  icon_type?: string;
  icon_background?: string;
  /** sudowork-server admin account id for audit / created_by. */
  actorDifyAccountId?: string;
  /** If sudohub already minted an assistant id, pass it here for binding. */
  assistantId?: string;
}

export async function createAgent(input: CreateAgentInput): Promise<AgentSummary> {
  const binding = await ensureTenantBinding(input.enterpriseId);

  const created = await difySystem.createApp(
    binding.dify_tenant_id,
    {
      name: input.name,
      description: input.description,
      mode: input.mode || "agent-chat",
      icon: input.icon,
      icon_type: input.icon_type,
      icon_background: input.icon_background,
    },
    input.actorDifyAccountId,
  );

  const assistantId = input.assistantId || randomUUID();
  const now = nowSec();

  db.prepare(
    `INSERT INTO dify_app_binding (
       enterprise_id, assistant_id, dify_tenant_id, dify_app_id, dify_app_mode,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.enterpriseId,
    assistantId,
    binding.dify_tenant_id,
    created.app_id,
    created.mode,
    now,
    now,
  );

  return {
    assistantId,
    enterpriseId: input.enterpriseId,
    difyTenantId: binding.dify_tenant_id,
    difyAppId: created.app_id,
    difyAppMode: created.mode,
    createdAt: now,
    updatedAt: now,
  };
}

export function listAgentsForEnterprise(enterpriseId: number): AgentSummary[] {
  const rows = db
    .prepare(
      `SELECT enterprise_id, assistant_id, dify_tenant_id, dify_app_id, dify_app_mode,
              created_at, updated_at
         FROM dify_app_binding WHERE enterprise_id = ? ORDER BY created_at DESC`,
    )
    .all(enterpriseId) as Array<{
    enterprise_id: number;
    assistant_id: string;
    dify_tenant_id: string;
    dify_app_id: string;
    dify_app_mode: string;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map((r) => ({
    assistantId: r.assistant_id,
    enterpriseId: r.enterprise_id,
    difyTenantId: r.dify_tenant_id,
    difyAppId: r.dify_app_id,
    difyAppMode: r.dify_app_mode,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function findAgent(enterpriseId: number, assistantId: string): AgentSummary | null {
  const row = db
    .prepare(
      `SELECT enterprise_id, assistant_id, dify_tenant_id, dify_app_id, dify_app_mode,
              created_at, updated_at
         FROM dify_app_binding WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .get(enterpriseId, assistantId) as
    | {
        enterprise_id: number;
        assistant_id: string;
        dify_tenant_id: string;
        dify_app_id: string;
        dify_app_mode: string;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    assistantId: row.assistant_id,
    enterpriseId: row.enterprise_id,
    difyTenantId: row.dify_tenant_id,
    difyAppId: row.dify_app_id,
    difyAppMode: row.dify_app_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Cascade-delete a tenant assistant across all three sides:
 *   1. sudohub assistant record (so it disappears from the admin list)
 *   2. Dify App (only when the assistant has Dify enhancement)
 *   3. Local bindings + ACL (dify_app_binding, dify_dataset_binding, assistant_acl)
 *
 * 2026-06-23 fix: the previous implementation early-returned when the
 * assistant had no `dify_app_binding` row (i.e. plain assistants and
 * "纯知识库" assistants), which left the sudohub record and local rows
 * orphaned — the admin saw the assistant come right back on next list.
 *
 * Failure policy: Dify App delete is best-effort (404 / network errors are
 * logged and ignored). sudohub delete failures bubble up so the admin sees
 * a real error rather than a silent partial delete; bindings are only
 * cleared after sudohub confirms.
 */
export async function deleteAgent(enterpriseId: number, assistantId: string): Promise<void> {
  // Look up the optional Dify App binding first; absence is fine.
  const agent = findAgent(enterpriseId, assistantId);

  // 1. Dify App (only if bound)
  if (agent) {
    try {
      await difySystem.deleteApp(agent.difyTenantId, agent.difyAppId);
    } catch (err) {
      console.warn("dify deleteApp failed (continuing local cleanup):", err);
    }
  }

  // 2. sudohub assistant — must succeed or we abort so the admin can retry.
  // Tolerate 404 (already gone) but treat other errors as fatal.
  try {
    await sudohub.deleteAssistant(assistantId);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (!/404|not.?found/i.test(msg)) {
      throw new Error(`sudohub deleteAssistant failed: ${msg}`);
    }
    console.warn("sudohub delete returned 404, assistant already gone:", assistantId);
  }

  // 3. Local bookkeeping — always runs after both upstream deletes attempt.
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM dify_app_binding WHERE enterprise_id = ? AND assistant_id = ?`).run(
      enterpriseId,
      assistantId,
    );
    db.prepare(`DELETE FROM assistant_acl WHERE enterprise_id = ? AND assistant_id = ?`).run(
      enterpriseId,
      assistantId,
    );
    db.prepare(
      `DELETE FROM dify_dataset_binding WHERE enterprise_id = ? AND assistant_id = ?`,
    ).run(enterpriseId, assistantId);
  });
  tx();
}

export function replaceAcl(
  enterpriseId: number,
  assistantId: string,
  entries: AclEntry[],
): AclEntry[] {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM assistant_acl WHERE enterprise_id = ? AND assistant_id = ?`).run(
      enterpriseId,
      assistantId,
    );
    const stmt = db.prepare(
      `INSERT INTO assistant_acl (enterprise_id, assistant_id, subject_type, subject_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
    );
    const now = nowSec();
    for (const entry of entries) {
      const subjectId = entry.subjectType === "all" ? null : entry.subjectId;
      stmt.run(enterpriseId, assistantId, entry.subjectType, subjectId, now);
    }
  });
  tx();
  return listAcl(enterpriseId, assistantId);
}

export function listAcl(enterpriseId: number, assistantId: string): AclEntry[] {
  const rows = db
    .prepare(
      `SELECT subject_type, subject_id FROM assistant_acl WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .all(enterpriseId, assistantId) as Array<{ subject_type: AclSubjectType; subject_id: string | null }>;
  return rows.map((r) => ({ subjectType: r.subject_type, subjectId: r.subject_id }));
}

/**
 * Write the list of datasets a (pure-RAG) assistant relies on. Replaces the
 * full set atomically.
 *
 * Two callers shapes the contract:
 *   - "纯知识库" 助手：本表是关联关系的唯一所有者；运行时由
 *     `EnhancementInvocationService.ragOnlyAnswer` 读取并触发 Dify dataset
 *     retrieve。
 *   - "Dify 增强" 助手：禁止往这里写（互斥语义，详见
 *     `2026-06-17-dify-integration-design.md`「知识增强：两个维度」）。
 *
 * Implementation notes:
 *   - 不再依赖 `dify_app_binding`（纯知识库助手没有 App 记录）。dify_tenant_id
 *     从 `dify_tenant_binding` 拿。
 *   - 互斥校验在 service 层做：若该助手已有 `dify_app_binding`，拒绝写入。
 */
export function replaceDatasets(
  enterpriseId: number,
  assistantId: string,
  datasetIds: string[],
): string[] {
  const hasDifyApp = db
    .prepare(
      `SELECT 1 FROM dify_app_binding WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .get(enterpriseId, assistantId);
  if (hasDifyApp && datasetIds.length > 0) {
    throw new Error(
      `assistant ${assistantId} has Dify enhancement; dataset attachment is exclusive — clear enhancement first`,
    );
  }
  const tenant = getTenantBinding(enterpriseId);
  if (!tenant && datasetIds.length > 0) {
    throw new Error(
      `enterprise ${enterpriseId} has no Dify tenant binding; cannot attach datasets`,
    );
  }
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM dify_dataset_binding WHERE enterprise_id = ? AND assistant_id = ?`,
    ).run(enterpriseId, assistantId);
    if (datasetIds.length === 0) return;
    const stmt = db.prepare(
      `INSERT INTO dify_dataset_binding (
         enterprise_id, assistant_id, dify_tenant_id, dify_dataset_id, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    const now = nowSec();
    const seen = new Set<string>();
    for (const id of datasetIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      stmt.run(enterpriseId, assistantId, tenant!.dify_tenant_id, id, now);
    }
  });
  tx();
  return listDatasets(enterpriseId, assistantId);
}

export function listDatasets(enterpriseId: number, assistantId: string): string[] {
  const rows = db
    .prepare(
      `SELECT dify_dataset_id FROM dify_dataset_binding WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .all(enterpriseId, assistantId) as Array<{ dify_dataset_id: string }>;
  return rows.map((r) => r.dify_dataset_id);
}

/**
 * Derive the set of agents a regular user is allowed to see.
 *
 * Rule (per design doc §6.3): an agent is visible if its ACL contains at
 * least one row that matches the user. Departments/roles are reserved for
 * later; today we only honor `user` and `all`.
 *
 * Admins always see every agent in their enterprise.
 */
export function listVisibleAgents(user: UserSummary): AgentSummary[] {
  if (user.enterpriseId == null) return [];
  if (user.role === "SUPER_ADMIN" || user.role === "ENTERPRISE_ADMIN") {
    return listAgentsForEnterprise(user.enterpriseId);
  }
  const rows = db
    .prepare(
      `SELECT b.enterprise_id, b.assistant_id, b.dify_tenant_id, b.dify_app_id,
              b.dify_app_mode, b.created_at, b.updated_at
         FROM dify_app_binding b
         JOIN assistant_acl a
           ON a.enterprise_id = b.enterprise_id
          AND a.assistant_id = b.assistant_id
        WHERE b.enterprise_id = ?
          AND (
            a.subject_type = 'all'
            OR (a.subject_type = 'user' AND a.subject_id = ?)
          )
        GROUP BY b.assistant_id
        ORDER BY b.created_at DESC`,
    )
    .all(user.enterpriseId, String(user.id)) as Array<{
    enterprise_id: number;
    assistant_id: string;
    dify_tenant_id: string;
    dify_app_id: string;
    dify_app_mode: string;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map((r) => ({
    assistantId: r.assistant_id,
    enterpriseId: r.enterprise_id,
    difyTenantId: r.dify_tenant_id,
    difyAppId: r.dify_app_id,
    difyAppMode: r.dify_app_mode,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function userCanSeeAgent(user: UserSummary, assistantId: string): boolean {
  if (user.enterpriseId == null) return false;
  if (user.role === "SUPER_ADMIN" || user.role === "ENTERPRISE_ADMIN") {
    const owned = findAgent(user.enterpriseId, assistantId);
    return owned != null;
  }
  const row = db
    .prepare(
      `SELECT 1 FROM dify_app_binding b
         JOIN assistant_acl a
           ON a.enterprise_id = b.enterprise_id
          AND a.assistant_id = b.assistant_id
        WHERE b.enterprise_id = ?
          AND b.assistant_id = ?
          AND (
            a.subject_type = 'all'
            OR (a.subject_type = 'user' AND a.subject_id = ?)
          )
        LIMIT 1`,
    )
    .get(user.enterpriseId, assistantId, String(user.id));
  return row != null;
}
