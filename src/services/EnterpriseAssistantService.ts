/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compose-create an "enterprise assistant": a sudohub assistant optionally
 * enhanced with a Dify app. This is the single entry point used by the
 * admin form in sudowork-server's management UI.
 *
 * The transaction is application-level (three distinct systems can fail
 * independently), so we run reverse compensation on failure:
 *
 *   1. sudohub  POST /api/assistants    →   assistant_id
 *   2. (if enhanced) Dify  POST /sudowork/system/apps → dify_app_id
 *   3. (if enhanced) local dify_app_binding insert
 *   4. local assistant_acl rewrite
 *
 * Compensation order on partial failure:
 *   step 4 fails → undo 3 → undo 2 (delete Dify App) → undo 1 (delete sudohub)
 *   step 3 fails → undo 2 → undo 1
 *   step 2 fails → undo 1
 *   step 1 fails → nothing to undo
 *
 * The compensation is best-effort: if a rollback HTTP call itself fails we
 * log it and continue, because the caller already lost the original write
 * and there's nothing useful to do on the user-facing side.
 */

import JSZip from "jszip";
import { db } from "../db/index.js";
import * as sudohub from "./SudohubClient.js";
import { system as difySystem } from "./DifyClient.js";
import { ensureTenantBinding } from "./DifyTenantService.js";
import { replaceAcl, type AclEntry } from "./DifyAgentService.js";

export type EnhancementMode = "agent-chat" | "workflow";

export interface CreateEnterpriseAssistantInput {
  enterpriseId: number;
  /** sudohub multipart fields */
  name: string;
  profession: string;
  description?: string;
  defaultInitPrompt?: string;
  categories?: string[];
  skills?: string[];
  promptFileBytes?: Uint8Array | Buffer;
  promptFileName?: string;
  avatarBytes?: Uint8Array | Buffer;
  avatarFileName?: string;
  sourceZipBytes?: Uint8Array | Buffer;
  sourceZipFileName?: string;
  /** ACL visibility entries. Empty array = enterprise-wide visible. */
  aclEntries: AclEntry[];

  /** Enhancement toggle. If absent the assistant has no Dify binding. */
  enhancement?: {
    mode: EnhancementMode;
    /** Optional: when admin wants the Dify app created with a different name */
    overrideAppName?: string;
  };

  /**
   * "纯知识库" 关联 dataset 列表（与 enhancement 互斥）。
   * 2026-06-22 P2.5.1：知识增强分两个维度，dataset 关联是独立维度。
   * 调用方必须保证 `enhancement` 与 `datasetIds.length > 0` 不同时为真。
   */
  datasetIds?: string[];

  /** sudowork admin actor account id (passed to Dify as X-Sudowork-Actor). */
  actorDifyAccountId?: string;

  /** sudohub tenant id (= enterprise code). Required so sudohub scopes correctly. */
  tenantCode: string;
}

export interface EnterpriseAssistantSummary {
  assistantId: string;
  enterpriseId: number;
  tenantCode: string;
  difyAppId?: string;
  difyTenantId?: string;
  difyAppMode?: string;
  enhancement?: { mode: EnhancementMode } | null;
  /** Pure-RAG path: dataset ids attached. Empty when enhancement is on. */
  datasetIds?: string[];
}

interface CompensationLog {
  step: string;
  rollback: () => Promise<void>;
}

async function safeRollback(log: CompensationLog[]): Promise<void> {
  // Walk in reverse so that newer writes are undone first.
  for (const entry of log.reverse()) {
    try {
      await entry.rollback();
    } catch (err) {
      console.warn(`compensation failed for step '${entry.step}':`, err);
    }
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Build a minimal sudohub-compatible source.zip from the admin-provided prompt
 * (and optional avatar). The sudowork client's install handler does not require
 * a manifest.json — it just extracts the zip and picks the first `.md` file as
 * the rule file (preferring `{assistantName}.md`). Mirroring that contract here
 * lets admin-created assistants land in the client's install flow without
 * forcing the admin to upload a zip themselves.
 *
 * If the caller explicitly supplied a source zip we keep it untouched. If there
 * is no prompt either we return undefined and let the caller decide whether to
 * fail or proceed (sudohub itself will reject creation without prompt_file).
 */
async function ensureSourceZip(input: CreateEnterpriseAssistantInput): Promise<{
  bytes: Uint8Array;
  fileName: string;
} | undefined> {
  if (input.sourceZipBytes) {
    const bytes =
      input.sourceZipBytes instanceof Uint8Array
        ? input.sourceZipBytes
        : new Uint8Array(input.sourceZipBytes);
    return { bytes, fileName: input.sourceZipFileName || "source.zip" };
  }
  if (!input.promptFileBytes) return undefined;

  // The client's install resolver prefers `{assistantName}.md` (case-sensitive)
  // — match that so the rule-file scan picks our file deterministically.
  const promptEntryName = `${input.name}.md`;
  const zip = new JSZip();
  zip.file(
    promptEntryName,
    input.promptFileBytes instanceof Uint8Array
      ? input.promptFileBytes
      : new Uint8Array(input.promptFileBytes),
  );
  if (input.avatarBytes && input.avatarFileName) {
    zip.file(
      input.avatarFileName,
      input.avatarBytes instanceof Uint8Array
        ? input.avatarBytes
        : new Uint8Array(input.avatarBytes),
    );
  }
  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes: buffer, fileName: `${input.name}.zip` };
}

/**
 * Translate enhancement mode to a Dify app mode for App creation. As of
 * 2026-06-22 P2.5.1 the mapping is 1:1 (agent-chat → agent-chat, workflow →
 * workflow); rag-only was retired and moved to the independent dataset
 * dimension. See `2026-06-17-dify-integration-design.md` § "知识增强：两个维度".
 */
function resolveDifyAppModeForCreation(mode: EnhancementMode): string {
  switch (mode) {
    case "workflow":
      return "workflow";
    case "agent-chat":
    default:
      return "agent-chat";
  }
}

/**
 * Persisted dify_app_mode mirrors the enhancement enum 1:1 now that rag-only
 * is gone.
 */
function persistedMode(mode: EnhancementMode): string {
  return mode;
}

export async function createEnterpriseAssistant(
  input: CreateEnterpriseAssistantInput,
): Promise<EnterpriseAssistantSummary> {
  const log: CompensationLog[] = [];
  let assistantId: string | undefined;
  let difyAppId: string | undefined;
  let difyTenantId: string | undefined;

  const datasetIds = Array.from(new Set(input.datasetIds ?? [])).filter((id) => id && id.length > 0);
  if (input.enhancement && datasetIds.length > 0) {
    throw new Error(
      "enhancement and dataset attachment are mutually exclusive (see design doc 「知识增强：两个维度」)",
    );
  }

  try {
    // Synthesize a minimal source.zip from the prompt when the admin didn't
    // upload one. Without this, sudohub records source_url=null and the
    // sudowork client suppresses the install button on the personal-mode
    // 专属助手 tab.
    const sourceZip = await ensureSourceZip(input);

    // Step 1: sudohub
    const created = await sudohub.createAssistant({
      name: input.name,
      profession: input.profession,
      description: input.description,
      defaultInitPrompt: input.defaultInitPrompt,
      tenantId: input.tenantCode,
      categories: input.categories,
      skills: input.skills,
      // status=1 by default — admin-curated enterprise assistant goes live
      // immediately. We may later expose a "draft" toggle if needed.
      status: 1,
      promptFileBytes: input.promptFileBytes,
      promptFileName: input.promptFileName,
      avatarBytes: input.avatarBytes,
      avatarFileName: input.avatarFileName,
      sourceZipBytes: sourceZip?.bytes ?? input.sourceZipBytes,
      sourceZipFileName: sourceZip?.fileName ?? input.sourceZipFileName,
    });
    assistantId = created.id;
    log.push({
      step: "sudohub.createAssistant",
      rollback: () => sudohub.deleteAssistant(created.id),
    });

    // Step 2a + 2b: Dify enhancement branch (optional, exclusive with 2c).
    if (input.enhancement) {
      const binding = await ensureTenantBinding(input.enterpriseId);
      difyTenantId = binding.dify_tenant_id;
      const difyAppMode = resolveDifyAppModeForCreation(input.enhancement.mode);

      const created2 = await difySystem.createApp(
        binding.dify_tenant_id,
        {
          name: input.enhancement.overrideAppName || input.name,
          description: input.description,
          mode: difyAppMode as
            | "chat"
            | "agent-chat"
            | "agent"
            | "advanced-chat"
            | "workflow"
            | "completion",
        },
        input.actorDifyAccountId,
      );
      difyAppId = created2.app_id;
      log.push({
        step: "dify.createApp",
        rollback: async () => difySystem.deleteApp(binding.dify_tenant_id, created2.app_id),
      });

      const stored = persistedMode(input.enhancement.mode);
      db.prepare(
        `INSERT INTO dify_app_binding (
           enterprise_id, assistant_id, dify_tenant_id, dify_app_id, app_api_key, dify_app_mode,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.enterpriseId,
        assistantId,
        binding.dify_tenant_id,
        created2.app_id,
        created2.app_api_key,
        stored,
        nowSec(),
        nowSec(),
      );
      log.push({
        step: "db.dify_app_binding.insert",
        rollback: async () => {
          db.prepare(
            `DELETE FROM dify_app_binding WHERE enterprise_id = ? AND assistant_id = ?`,
          ).run(input.enterpriseId, assistantId!);
        },
      });
    }

    // Step 2c: pure-RAG dataset attachment (exclusive with 2a/2b).
    if (!input.enhancement && datasetIds.length > 0) {
      const binding = await ensureTenantBinding(input.enterpriseId);
      difyTenantId = binding.dify_tenant_id;
      const now = nowSec();
      const stmt = db.prepare(
        `INSERT INTO dify_dataset_binding (
           enterprise_id, assistant_id, dify_tenant_id, dify_dataset_id, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      );
      const inserted: string[] = [];
      try {
        for (const id of datasetIds) {
          stmt.run(input.enterpriseId, assistantId, binding.dify_tenant_id, id, now);
          inserted.push(id);
        }
      } catch (err) {
        // Roll back partial inserts before letting the outer compensation kick in.
        if (inserted.length > 0) {
          db.prepare(
            `DELETE FROM dify_dataset_binding WHERE enterprise_id = ? AND assistant_id = ?`,
          ).run(input.enterpriseId, assistantId);
        }
        throw err;
      }
      log.push({
        step: "db.dify_dataset_binding.insert",
        rollback: async () => {
          db.prepare(
            `DELETE FROM dify_dataset_binding WHERE enterprise_id = ? AND assistant_id = ?`,
          ).run(input.enterpriseId, assistantId!);
        },
      });
    }

    // Step 3: ACL
    if (input.aclEntries && input.aclEntries.length > 0) {
      replaceAcl(input.enterpriseId, assistantId, input.aclEntries);
      log.push({
        step: "db.assistant_acl.replace",
        rollback: async () => {
          db.prepare(
            `DELETE FROM assistant_acl WHERE enterprise_id = ? AND assistant_id = ?`,
          ).run(input.enterpriseId, assistantId!);
        },
      });
    }

    return {
      assistantId,
      enterpriseId: input.enterpriseId,
      tenantCode: input.tenantCode,
      difyAppId,
      difyTenantId,
      difyAppMode: input.enhancement ? persistedMode(input.enhancement.mode) : undefined,
      enhancement: input.enhancement ? { mode: input.enhancement.mode } : null,
      datasetIds: input.enhancement ? [] : datasetIds,
    };
  } catch (err) {
    await safeRollback(log);
    throw err;
  }
}

/**
 * Toggle the Dify enhancement on an existing sudohub assistant.
 *
 * Adding: creates a new Dify App + binding + (optionally) replaces ACL.
 * Removing: deletes Dify App + binding; ACL is untouched (caller may wipe it
 * separately if desired).
 */
export async function setEnhancement(args: {
  enterpriseId: number;
  assistantId: string;
  enable: boolean;
  mode?: EnhancementMode;
  actorDifyAccountId?: string;
  appName?: string;
}): Promise<{ difyAppId?: string; difyAppMode?: string }> {
  if (args.enable) {
    if (!args.mode) throw new Error("enhancement mode required when enabling");

    // 2026-06-22 P2.5.1: mutex with the pure-RAG dataset path. Enabling
    // enhancement on a dataset-bound assistant would create a duplicate
    // knowledge ingestion point — refuse and tell the caller to detach
    // datasets first.
    const hasDatasets = db
      .prepare(
        `SELECT 1 FROM dify_dataset_binding WHERE enterprise_id = ? AND assistant_id = ?`,
      )
      .get(args.enterpriseId, args.assistantId);
    if (hasDatasets) {
      throw new Error(
        `assistant ${args.assistantId} has datasets attached; clear them before enabling Dify enhancement`,
      );
    }

    const binding = await ensureTenantBinding(args.enterpriseId);

    // Already enabled? Two sub-cases:
    //   1. Same mode  → no-op (idempotent save in the admin UI).
    //   2. Different mode → REJECT. Agent and Workflow are two distinct Dify
    //      App types and there is no in-place conversion on the Dify side;
    //      silently rewriting `dify_app_mode` here would leave a binding row
    //      whose runtime endpoint (chat-messages vs workflows/run) no longer
    //      matches the actual App, breaking every subsequent invocation.
    //      The intended flow is: disable enhancement (which deletes the App),
    //      then re-enable with the new mode. The admin UI locks the select
    //      to enforce this; this server-side check is the safety net.
    const existing = db
      .prepare(
        `SELECT dify_app_id, dify_app_mode FROM dify_app_binding
           WHERE enterprise_id = ? AND assistant_id = ?`,
      )
      .get(args.enterpriseId, args.assistantId) as
      | { dify_app_id: string; dify_app_mode: string }
      | undefined;
    if (existing) {
      const desired = persistedMode(args.mode);
      if (existing.dify_app_mode !== desired) {
        throw new Error(
          `cannot change enhancement mode in place (${existing.dify_app_mode} → ${desired}); ` +
            `disable enhancement first (which deletes the Dify App), then re-enable with the new mode`,
        );
      }
      return { difyAppId: existing.dify_app_id, difyAppMode: existing.dify_app_mode };
    }

    const created = await difySystem.createApp(
      binding.dify_tenant_id,
      {
        name: args.appName || `Enhancement for ${args.assistantId}`,
        mode: resolveDifyAppModeForCreation(args.mode) as
          | "chat"
          | "agent-chat"
          | "agent"
          | "advanced-chat"
          | "workflow"
          | "completion",
      },
      args.actorDifyAccountId,
    );
    db.prepare(
      `INSERT INTO dify_app_binding (
         enterprise_id, assistant_id, dify_tenant_id, dify_app_id, app_api_key, dify_app_mode,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      args.enterpriseId,
      args.assistantId,
      binding.dify_tenant_id,
      created.app_id,
      created.app_api_key,
      persistedMode(args.mode),
      nowSec(),
      nowSec(),
    );
    return { difyAppId: created.app_id, difyAppMode: persistedMode(args.mode) };
  }

  // Disable: drop binding + delete Dify App.
  const row = db
    .prepare(
      `SELECT dify_tenant_id, dify_app_id FROM dify_app_binding
         WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .get(args.enterpriseId, args.assistantId) as
    | { dify_tenant_id: string; dify_app_id: string }
    | undefined;
  if (!row) return {};
  try {
    await difySystem.deleteApp(row.dify_tenant_id, row.dify_app_id);
  } catch (err) {
    console.warn("dify deleteApp during enhancement removal failed:", err);
  }
  db.prepare(
    `DELETE FROM dify_app_binding WHERE enterprise_id = ? AND assistant_id = ?`,
  ).run(args.enterpriseId, args.assistantId);
  return {};
}

export interface EnhancementInfo {
  enabled: boolean;
  mode?: EnhancementMode;
  difyAppId?: string;
  difyTenantId?: string;
}

export function getEnhancement(enterpriseId: number, assistantId: string): EnhancementInfo {
  const row = db
    .prepare(
      `SELECT dify_tenant_id, dify_app_id, dify_app_mode
         FROM dify_app_binding
        WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .get(enterpriseId, assistantId) as
    | { dify_tenant_id: string; dify_app_id: string; dify_app_mode: string }
    | undefined;
  if (!row) return { enabled: false };
  const stored = row.dify_app_mode;
  // Defensive: legacy rows may still carry `rag-only` if the migration script
  // hasn't run yet. Treat them as agent-chat so callers don't crash; the
  // migration will rewrite them later.
  const mode: EnhancementMode = stored === "workflow" ? "workflow" : "agent-chat";
  return {
    enabled: true,
    mode,
    difyAppId: row.dify_app_id,
    difyTenantId: row.dify_tenant_id,
  };
}
