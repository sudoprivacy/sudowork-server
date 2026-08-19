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
import {
  applyAssistantMetadataOverrides,
  deleteAssistantMetadataOverride,
  upsertAssistantMetadataOverride,
} from "./AssistantMetadataOverrideService.js";

/**
 * Mode the admin actively selects when enabling Dify enhancement on an
 * assistant. Restricted to Dify-App-backed modes because rag-only assistants
 * are created via a separate flow (attaching datasets directly, no Dify App
 * is provisioned).
 */
export type EnhancementMode = "agent-chat" | "workflow";

/**
 * Mode the client / probe sees. Extends `EnhancementMode` with `rag-only` —
 * which is what `getEnhancement` returns when an assistant has dataset
 * bindings but no Dify App binding. The runtime enhancement invocation
 * (`EnhancementInvocationService`) routes `rag-only` to the dataset retrieval
 * path; setEnhancement / Dify App creation never produce this mode.
 */
export type EnhancementProbeMode = EnhancementMode | "rag-only";

type AssistantPromptsI18n = Record<string, string[]>;

export interface CreateEnterpriseAssistantInput {
  enterpriseId: number;
  /** sudohub multipart fields */
  name: string;
  profession: string;
  description?: string;
  defaultInitPrompt?: string;
  promptsI18n?: AssistantPromptsI18n;
  categories?: string[];
  skills?: string[];
  /** Complete skillhub tenant visibility list. Owner tenant must be first. */
  tenantIds?: string[];
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

export interface UpdateEnterpriseAssistantInput {
  enterpriseId: number;
  assistantId: string;
  tenantCode: string;
  name: string;
  profession: string;
  description?: string;
  defaultInitPrompt?: string;
  promptsI18n?: AssistantPromptsI18n;
  categories?: string[];
  skills?: string[];
  /** Complete skillhub tenant visibility list. Owner tenant must be first. */
  tenantIds?: string[];
  promptFileBytes?: Uint8Array | Buffer;
  promptFileName?: string;
  avatarBytes?: Uint8Array | Buffer;
  avatarFileName?: string;
  sourceZipBytes?: Uint8Array | Buffer;
  sourceZipFileName?: string;
}

export interface EnterpriseAssistantSummary {
  assistantId: string;
  enterpriseId: number;
  tenantCode: string;
  tenantIds?: string[];
  difyAppId?: string;
  difyTenantId?: string;
  difyAppMode?: string;
  enhancement?: { mode: EnhancementMode } | null;
  /** Pure-RAG path: dataset ids attached. Empty when enhancement is on. */
  datasetIds?: string[];
}

export interface EnterpriseAssistantUpdateSummary {
  assistantId: string;
  enterpriseId: number;
  tenantCode: string;
  tenantIds?: string[];
  version: string;
  raw: unknown;
}

export interface EnterpriseAssistantDetail {
  assistant: Record<string, unknown>;
  promptText: string | null;
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

type SourceZipBuildInput = {
  name: string;
  promptFileBytes?: Uint8Array | Buffer;
  promptFileName?: string;
  avatarBytes?: Uint8Array | Buffer;
  avatarFileName?: string;
  sourceZipBytes?: Uint8Array | Buffer;
  sourceZipFileName?: string;
  bumpMarker?: boolean;
  metadata?: Record<string, unknown>;
};

function normalizeZipEntryName(name: string): string {
  return name.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function detectSingleTopLevelPrefix(zip: JSZip): string {
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipEntryName(entry.name))
    .filter(
      (entryName) =>
        !entryName.includes("__MACOSX") && !entryName.endsWith(".DS_Store"),
    )
    .filter(Boolean);
  const topLevels = Array.from(
    new Set(entries.map((entryName) => entryName.split("/")[0])),
  );
  if (
    topLevels.length === 1 &&
    entries.every((entryName) => entryName.includes("/"))
  ) {
    return `${topLevels[0]}/`;
  }
  return "";
}

function writeAssistantPackageMetadata(
  zip: JSZip,
  prefix: string,
  metadata?: Record<string, unknown>,
): void {
  if (!metadata) return;
  const content = JSON.stringify(metadata, null, 2);
  zip.file(`${prefix}_sudowork_meta.json`, content);
  zip.file(`${prefix}_moss_meta.json`, content);
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
async function ensureSourceZip(input: SourceZipBuildInput): Promise<
  | {
      bytes: Uint8Array;
      fileName: string;
    }
  | undefined
> {
  if (input.sourceZipBytes && !input.bumpMarker && !input.metadata) {
    const bytes =
      input.sourceZipBytes instanceof Uint8Array
        ? input.sourceZipBytes
        : new Uint8Array(input.sourceZipBytes);
    return { bytes, fileName: input.sourceZipFileName || "source.zip" };
  }
  if (input.sourceZipBytes) {
    const bytes =
      input.sourceZipBytes instanceof Uint8Array
        ? input.sourceZipBytes
        : new Uint8Array(input.sourceZipBytes);
    const zip = await JSZip.loadAsync(bytes);
    const prefix = detectSingleTopLevelPrefix(zip);
    if (input.bumpMarker) {
      zip.file(
        `${prefix}_sudowork_update.json`,
        JSON.stringify({ updated_at: new Date().toISOString() }, null, 2),
      );
    }
    writeAssistantPackageMetadata(zip, prefix, input.metadata);
    const buffer = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    return {
      bytes: buffer,
      fileName: input.sourceZipFileName || `${input.name}.zip`,
    };
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
  if (input.bumpMarker) {
    zip.file(
      "_sudowork_update.json",
      JSON.stringify({ updated_at: new Date().toISOString() }, null, 2),
    );
  }
  writeAssistantPackageMetadata(zip, "", input.metadata);
  const buffer = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getStringField(
  obj: Record<string, unknown> | null,
  keys: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function getNumberField(
  obj: Record<string, unknown> | null,
  keys: string[],
): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function getStringArrayField(
  obj: Record<string, unknown> | null,
  keys: string[],
): string[] {
  if (!obj) return [];
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

function normalizeTenantCodes(
  values: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function getAssistantTenantCodes(
  obj: Record<string, unknown> | null,
  fallbackTenantCode?: string,
): string[] {
  const plural = getStringArrayField(obj, ["tenantIds", "tenant_ids"]);
  if (plural.length > 0) return normalizeTenantCodes(plural);
  return normalizeTenantCodes([
    getStringField(obj, ["tenantId", "tenant_id"]),
    fallbackTenantCode,
  ]);
}

function assertAssistantOwnedByTenant(
  assistant: Record<string, unknown> | null,
  assistantId: string,
  tenantCode: string,
): string[] {
  const tenantCodes = getAssistantTenantCodes(assistant, tenantCode);
  const ownerTenant = tenantCodes[0];
  if (ownerTenant && ownerTenant !== tenantCode) {
    throw new Error(
      `assistant ${assistantId} belongs to tenant ${ownerTenant}, not ${tenantCode}`,
    );
  }
  return tenantCodes.length > 0 ? tenantCodes : [tenantCode];
}

function withTenantFields(
  assistant: Record<string, unknown>,
  tenantCodes: string[],
): Record<string, unknown> {
  return {
    ...assistant,
    tenantId: tenantCodes[0] ?? null,
    tenantIds: tenantCodes,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function normalizePromptsI18n(value: unknown): AssistantPromptsI18n {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { "zh-CN": [] };
  }
  return {
    "zh-CN": normalizeStringArray((value as Record<string, unknown>)["zh-CN"]),
  };
}

function getPromptsI18nField(
  obj: Record<string, unknown> | null,
  keys: string[] = ["promptsI18n", "prompts_i18n"],
): AssistantPromptsI18n {
  if (!obj) return { "zh-CN": [] };
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") {
      try {
        return normalizePromptsI18n(JSON.parse(value));
      } catch {
        return { "zh-CN": [] };
      }
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return normalizePromptsI18n(value);
    }
  }
  return { "zh-CN": [] };
}

function normalizeSudohubAssistant(
  raw: unknown,
): Record<string, unknown> | null {
  const root = asRecord(raw);
  const data = asRecord(root?.data);
  const assistant = asRecord(data?.assistant);
  if (assistant) {
    const latestVersion =
      data?.latestVersion ??
      data?.latest_version ??
      assistant.latestVersion ??
      assistant.latest_version;
    return {
      ...assistant,
      versions: data?.versions ?? assistant.versions,
      latestVersion,
    };
  }
  return data || root;
}

function firstVersionFrom(value: unknown): string | undefined {
  const record = asRecord(value);
  return getStringField(record, ["version"]);
}

function extractLatestVersion(
  record: Record<string, unknown> | null,
): string | undefined {
  if (!record) return undefined;
  const direct = getStringField(record, ["version", "latest_version"]);
  if (direct) return direct;
  const latest =
    firstVersionFrom(record.latestVersion) ||
    firstVersionFrom(record.latest_version);
  if (latest) return latest;
  const versions = Array.isArray(record.versions) ? record.versions : [];
  return firstVersionFrom(versions[0]);
}

function bumpPatchVersion(current?: string): string {
  const fallback = "1.0.1";
  if (!current) return fallback;
  const trimmed = current.trim();
  const match = trimmed.match(/^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!match) return fallback;
  const prefix = match[1] ?? "";
  const majorRaw = match[2];
  const minorRaw = match[3];
  const patchRaw = match[4];
  if (!majorRaw) return fallback;
  const major = Number.parseInt(majorRaw, 10);
  const minor = Number.parseInt(minorRaw ?? "0", 10);
  const patch = Number.parseInt(patchRaw ?? "0", 10);
  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return fallback;
  }
  return `${prefix}${major}.${minor}.${patch + 1}`;
}

function packageFileName(name: string, version: string): string {
  const safeName = (name.trim() || "assistant")
    .replace(/[\\/]/g, "_")
    .slice(0, 80);
  return `${safeName}-${version}.zip`;
}

function resolveHubFileUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${sudohub.SUDOHUB_BASE}${url}`;
  return `${sudohub.SUDOHUB_BASE}/${url}`;
}

async function downloadHubFile(url: string): Promise<Uint8Array> {
  const resolved = resolveHubFileUrl(url);
  const resp = await fetch(resolved);
  if (!resp.ok) {
    throw new Error(`download ${resolved} failed with ${resp.status}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

function extractSourceUrl(
  record: Record<string, unknown> | null,
): string | undefined {
  if (!record) return undefined;
  const direct = getStringField(record, ["sourceUrl", "source_url"]);
  if (direct) return direct;
  const latest =
    asRecord(record.latestVersion) || asRecord(record.latest_version);
  const latestSource = getStringField(latest, ["sourceUrl", "source_url"]);
  if (latestSource) return latestSource;
  const versions = Array.isArray(record.versions) ? record.versions : [];
  return getStringField(asRecord(versions[0]), ["sourceUrl", "source_url"]);
}

function extractPromptUrl(
  record: Record<string, unknown> | null,
): string | undefined {
  return getStringField(record, ["promptFile", "prompt_file"]);
}

function resolveUploadedAssistantObjectUrl(
  current: Record<string, unknown> | null,
  assistantId: string,
  fileName: string,
): string {
  const objectKey = `assistant-hub/${assistantId}/${fileName}`;
  const samples = [
    extractPromptUrl(current),
    getStringField(current, ["avatar"]),
    extractSourceUrl(current),
  ].filter((url): url is string => typeof url === "string" && url.length > 0);
  for (const sample of samples) {
    const marker = "/assistant-hub/";
    const idx = sample.indexOf(marker);
    if (/^https?:\/\//i.test(sample) && idx >= 0) {
      return `${sample.slice(0, idx)}/${objectKey}`;
    }
  }

  const localContentBase = (
    process.env.SUDOHUB_CONTENT_BASE_URL ||
    process.env.SKILLHUB_CONTENT_BASE_URL ||
    ""
  ).replace(/\/+$/, "");
  if (localContentBase) {
    return `${localContentBase}/api/skills/content/${objectKey}`;
  }

  const cosBase = (
    process.env.SUDOHUB_COS_BASE_URL ||
    process.env.SKILLHUB_COS_BASE_URL ||
    "https://sudowork-hub-1309794936.cos.ap-beijing.myqcloud.com"
  ).replace(/\/+$/, "");
  return `${cosBase}/${objectKey}`;
}

interface AssistantPackageMetadataInput {
  assistantId?: string;
  name: string;
  profession: string;
  description?: string;
  defaultInitPrompt?: string;
  promptsI18n?: AssistantPromptsI18n;
  categories?: string[];
  skills?: string[];
  tenantId?: string;
  tenantIds?: string[];
  avatar?: string | null;
  version: string;
  ruleFile?: string;
}

function buildAssistantPackageMetadata(
  input: AssistantPackageMetadataInput,
): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const description = input.description ?? "";
  const skills = input.skills ?? [];
  const categories = input.categories ?? [];
  const tenantIds = normalizeTenantCodes([
    input.tenantId,
    ...(input.tenantIds ?? []),
  ]);
  const tenantId = tenantIds[0] ?? input.tenantId ?? null;
  const metadata: Record<string, unknown> = {
    name: input.name,
    display_name: input.name,
    profession: input.profession,
    nameI18n: {
      "zh-CN": input.name,
      "en-US": input.name,
    },
    descriptionI18n: {
      "zh-CN": description,
      "en-US": description,
    },
    promptsI18n: normalizePromptsI18n(input.promptsI18n),
    avatar: input.avatar,
    emoji: null,
    presetAgentType: "claude",
    source_type: "tenant",
    tag: "tenant",
    tenantId,
    tenantIds,
    tenant_id: tenantId,
    tenant_ids: tenantIds,
    skills,
    defaultEnabledSkills: skills,
    enabledSkills: skills,
    categories,
    is_builtin: false,
    enabled: true,
    defaultInitPrompt: input.defaultInitPrompt ?? null,
    installed_version: input.version,
    installed_at: nowIso,
    updated_at: nowIso,
    ruleFile: input.ruleFile,
  };
  if (input.assistantId) metadata.id = input.assistantId;
  return metadata;
}

async function buildUpdateSourceZip(
  input: UpdateEnterpriseAssistantInput,
  current: Record<string, unknown> | null,
  nextVersion: string,
): Promise<{ bytes: Uint8Array; fileName: string } | undefined> {
  const fileName = packageFileName(input.name, nextVersion);
  const metadata = buildAssistantPackageMetadata({
    assistantId: input.assistantId,
    name: input.name,
    profession: input.profession,
    description: input.description,
    defaultInitPrompt: input.defaultInitPrompt,
    promptsI18n: input.promptsI18n,
    categories: input.categories,
    skills: input.skills,
    tenantId: input.tenantCode,
    tenantIds: input.tenantIds,
    avatar: input.avatarBytes
      ? input.avatarFileName || "avatar.png"
      : getStringField(current, ["avatar"]),
    version: nextVersion,
    ruleFile: input.promptFileBytes ? `${input.name}.md` : undefined,
  });
  const explicitZip = await ensureSourceZip({
    name: input.name,
    promptFileBytes: input.promptFileBytes,
    promptFileName: input.promptFileName,
    avatarBytes: input.avatarBytes,
    avatarFileName: input.avatarFileName,
    sourceZipBytes: input.sourceZipBytes,
    sourceZipFileName: fileName,
    bumpMarker: true,
    metadata,
  });
  if (explicitZip) return explicitZip;

  const sourceUrl = extractSourceUrl(current);
  if (sourceUrl) {
    try {
      const existingSource = await downloadHubFile(sourceUrl);
      return ensureSourceZip({
        name: input.name,
        sourceZipBytes: existingSource,
        sourceZipFileName: fileName,
        bumpMarker: true,
        metadata,
      });
    } catch (err) {
      console.warn(
        "sudohub existing source_url download failed; trying prompt_file:",
        err,
      );
    }
  }

  const promptUrl = extractPromptUrl(current);
  if (!promptUrl) return undefined;
  const existingPrompt = await downloadHubFile(promptUrl);
  return ensureSourceZip({
    name: input.name,
    promptFileBytes: existingPrompt,
    promptFileName: `${input.name}.md`,
    sourceZipFileName: fileName,
    bumpMarker: true,
    metadata,
  });
}

async function readPromptTextFromSourceZip(
  bytes: Uint8Array,
  assistantName?: string,
): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes);
  const markdownFiles = Object.values(zip.files).filter(
    (entry) => !entry.dir && /\.md$/i.test(entry.name),
  );
  if (markdownFiles.length === 0) return null;

  const preferredFileName = assistantName ? `${assistantName}.md` : "";
  const preferred =
    preferredFileName.length > 0
      ? markdownFiles.find(
          (entry) => entry.name.split("/").pop() === preferredFileName,
        )
      : undefined;
  const selected = preferred ?? markdownFiles[0];
  if (!selected) return null;
  return selected.async("string");
}

async function loadAssistantPromptText(
  record: Record<string, unknown>,
): Promise<string | null> {
  const promptUrl = extractPromptUrl(record);
  if (promptUrl) {
    try {
      return new TextDecoder().decode(await downloadHubFile(promptUrl));
    } catch (err) {
      console.warn(
        "sudohub prompt_file download failed; trying source_url:",
        err,
      );
    }
  }

  const sourceUrl = extractSourceUrl(record);
  if (!sourceUrl) return null;
  try {
    const assistantName = getStringField(record, ["name"]);
    return readPromptTextFromSourceZip(
      await downloadHubFile(sourceUrl),
      assistantName,
    );
  } catch (err) {
    console.warn("sudohub source_url prompt extraction failed:", err);
    return null;
  }
}

export async function getEnterpriseAssistantDetail(input: {
  enterpriseId: number;
  assistantId: string;
  tenantCode: string;
}): Promise<EnterpriseAssistantDetail> {
  const currentRaw = await sudohub.getAssistant(input.assistantId);
  const current = normalizeSudohubAssistant(currentRaw);
  if (!current) {
    throw new Error(`assistant ${input.assistantId} not found`);
  }

  const tenantCodes = assertAssistantOwnedByTenant(
    current,
    input.assistantId,
    input.tenantCode,
  );

  const assistant = withTenantFields(
    applyAssistantMetadataOverrides(input.enterpriseId, [current])[0] ??
      current,
    tenantCodes,
  );
  const promptText = await loadAssistantPromptText(assistant);
  return { assistant, promptText };
}

export async function createEnterpriseAssistant(
  input: CreateEnterpriseAssistantInput,
): Promise<EnterpriseAssistantSummary> {
  const log: CompensationLog[] = [];
  let assistantId: string | undefined;
  let difyAppId: string | undefined;
  let difyTenantId: string | undefined;

  const datasetIds = Array.from(new Set(input.datasetIds ?? [])).filter(
    (id) => id && id.length > 0,
  );
  const promptsI18n = normalizePromptsI18n(input.promptsI18n);
  const tenantIds = normalizeTenantCodes([
    input.tenantCode,
    ...(input.tenantIds ?? []),
  ]);
  if (input.enhancement && datasetIds.length > 0) {
    throw new Error(
      "enhancement and dataset attachment are mutually exclusive (see design doc 「知识增强：两个维度」)",
    );
  }

  try {
    // Synthesize a minimal source.zip from the prompt when the admin didn't
    // upload one. Without this, sudohub records source_url=null and the
    // sudowork client suppresses the install button on the personal-mode
    // 专属智能体 tab.
    const sourceZip = await ensureSourceZip({
      name: input.name,
      promptFileBytes: input.promptFileBytes,
      promptFileName: input.promptFileName,
      avatarBytes: input.avatarBytes,
      avatarFileName: input.avatarFileName,
      sourceZipBytes: input.sourceZipBytes,
      sourceZipFileName: input.sourceZipFileName,
      metadata: buildAssistantPackageMetadata({
        name: input.name,
        profession: input.profession,
        description: input.description,
        defaultInitPrompt: input.defaultInitPrompt,
        promptsI18n,
        categories: input.categories,
        skills: input.skills,
        tenantId: input.tenantCode,
        tenantIds,
        avatar: input.avatarBytes
          ? input.avatarFileName || "avatar.png"
          : undefined,
        version: "1.0.0",
        ruleFile: input.promptFileBytes ? `${input.name}.md` : undefined,
      }),
    });

    // Step 1: sudohub
    const created = await sudohub.createAssistant({
      name: input.name,
      profession: input.profession,
      description: input.description,
      defaultInitPrompt: input.defaultInitPrompt,
      promptsI18n,
      tenantIds,
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

    const createdRecord = normalizeSudohubAssistant(created.raw);
    const promptFileUrl =
      getStringField(createdRecord, ["promptFile", "prompt_file"]) ??
      (input.promptFileBytes
        ? resolveUploadedAssistantObjectUrl(
            createdRecord,
            created.id,
            input.promptFileName || "prompt.md",
          )
        : null);
    const avatarUrl =
      getStringField(createdRecord, ["avatar"]) ??
      (input.avatarBytes
        ? resolveUploadedAssistantObjectUrl(
            createdRecord,
            created.id,
            "avatar.png",
          )
        : null);
    upsertAssistantMetadataOverride({
      enterpriseId: input.enterpriseId,
      assistantId: created.id,
      name: input.name,
      profession: input.profession,
      description: input.description ?? "",
      defaultInitPrompt: input.defaultInitPrompt ?? "",
      promptsI18n,
      categories: input.categories ?? [],
      skills: input.skills ?? [],
      promptFile: promptFileUrl,
      avatar: avatarUrl,
      skillhubVersion: extractLatestVersion(createdRecord) ?? "1.0.0",
    });
    log.push({
      step: "db.assistant_metadata_overrides.upsert",
      rollback: async () => {
        deleteAssistantMetadataOverride(input.enterpriseId, created.id);
      },
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
        rollback: async () =>
          difySystem.deleteApp(binding.dify_tenant_id, created2.app_id),
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
          stmt.run(
            input.enterpriseId,
            assistantId,
            binding.dify_tenant_id,
            id,
            now,
          );
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
      tenantIds,
      difyAppId,
      difyTenantId,
      difyAppMode: input.enhancement
        ? persistedMode(input.enhancement.mode)
        : undefined,
      enhancement: input.enhancement ? { mode: input.enhancement.mode } : null,
      datasetIds: input.enhancement ? [] : datasetIds,
    };
  } catch (err) {
    await safeRollback(log);
    throw err;
  }
}

export async function updateEnterpriseAssistant(
  input: UpdateEnterpriseAssistantInput,
): Promise<EnterpriseAssistantUpdateSummary> {
  const currentRaw = await sudohub.getAssistant(input.assistantId);
  const current = normalizeSudohubAssistant(currentRaw);
  const currentTenantCodes = assertAssistantOwnedByTenant(
    current,
    input.assistantId,
    input.tenantCode,
  );
  const tenantIds =
    input.tenantIds !== undefined
      ? normalizeTenantCodes([input.tenantCode, ...input.tenantIds])
      : currentTenantCodes;

  let nextVersion = bumpPatchVersion(extractLatestVersion(current));
  let sourceZip: { bytes: Uint8Array; fileName: string } | undefined;
  const currentWithOverrides = current
    ? (applyAssistantMetadataOverrides(input.enterpriseId, [current])[0] ??
      current)
    : current;
  const promptsI18n =
    input.promptsI18n === undefined
      ? getPromptsI18nField(currentWithOverrides)
      : normalizePromptsI18n(input.promptsI18n);
  const inputForVersion: UpdateEnterpriseAssistantInput = {
    ...input,
    promptsI18n,
    tenantIds,
  };

  const status = getNumberField(current, ["status"]) ?? 1;
  const sortOrder = getNumberField(current, ["sortOrder", "sort_order"]);

  let versionResult: { id: string; raw: unknown } | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      sourceZip = await buildUpdateSourceZip(
        inputForVersion,
        currentWithOverrides,
        nextVersion,
      );
      if (!sourceZip) {
        throw new Error(
          "unable to build assistant source package for version bump",
        );
      }
      versionResult = await sudohub.createAssistantVersion({
        name: input.name,
        profession: input.profession,
        description: input.description ?? "",
        defaultInitPrompt: input.defaultInitPrompt ?? "",
        promptsI18n,
        tenantIds,
        tenantId: input.tenantCode,
        categories: input.categories ?? [],
        skills: input.skills ?? [],
        status,
        sortOrder,
        version: nextVersion,
        changelog: "Updated from sudowork-server admin",
        promptFileBytes: input.promptFileBytes,
        promptFileName: input.promptFileName,
        avatarBytes: input.avatarBytes,
        avatarFileName: input.avatarFileName,
        sourceZipBytes: sourceZip.bytes,
        sourceZipFileName: sourceZip.fileName,
      });
      break;
    } catch (err) {
      if (
        err instanceof sudohub.SudohubClientError &&
        /version .*already exists/i.test(JSON.stringify(err.detail))
      ) {
        nextVersion = bumpPatchVersion(nextVersion);
        continue;
      }
      throw err;
    }
  }
  if (!versionResult) {
    throw new Error("unable to create a unique assistant package version");
  }
  if (versionResult.id !== input.assistantId) {
    throw new Error(
      `skill-hub version creation returned assistant ${versionResult.id}, expected ${input.assistantId}`,
    );
  }

  await sudohub.updateAssistant(input.assistantId, {
    tenantIds,
    tenantId: input.tenantCode,
  });

  const promptFileUrl = input.promptFileBytes
    ? resolveUploadedAssistantObjectUrl(
        currentWithOverrides,
        input.assistantId,
        input.promptFileName || "prompt.md",
      )
    : (getStringField(currentWithOverrides, ["promptFile", "prompt_file"]) ??
      null);
  const avatarUrl = input.avatarBytes
    ? resolveUploadedAssistantObjectUrl(
        currentWithOverrides,
        input.assistantId,
        "avatar.png",
      )
    : (getStringField(currentWithOverrides, ["avatar"]) ?? null);
  const override = upsertAssistantMetadataOverride({
    enterpriseId: input.enterpriseId,
    assistantId: input.assistantId,
    name: input.name,
    profession: input.profession,
    description: input.description ?? "",
    defaultInitPrompt: input.defaultInitPrompt ?? "",
    promptsI18n,
    categories: input.categories ?? [],
    skills: input.skills ?? [],
    promptFile: promptFileUrl,
    avatar: avatarUrl,
    skillhubVersion: nextVersion,
  });

  return {
    assistantId: input.assistantId,
    enterpriseId: input.enterpriseId,
    tenantCode: input.tenantCode,
    tenantIds,
    version: nextVersion,
    raw: {
      skillhubVersion: versionResult.raw,
      metadataOverride: override,
    },
  };
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
      { dify_app_id: string; dify_app_mode: string } | undefined;
    if (existing) {
      const desired = persistedMode(args.mode);
      if (existing.dify_app_mode !== desired) {
        throw new Error(
          `cannot change enhancement mode in place (${existing.dify_app_mode} → ${desired}); ` +
            `disable enhancement first (which deletes the Dify App), then re-enable with the new mode`,
        );
      }
      return {
        difyAppId: existing.dify_app_id,
        difyAppMode: existing.dify_app_mode,
      };
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
    { dify_tenant_id: string; dify_app_id: string } | undefined;
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
  mode?: EnhancementProbeMode;
  difyAppId?: string;
  difyTenantId?: string;
}

/**
 * Probe enhancement state for an assistant. Three outcomes:
 *
 *   1. `dify_app_binding` exists  → `{enabled: true, mode: 'agent-chat' | 'workflow'}` (Dify-App-backed)
 *   2. only `dify_dataset_binding` → `{enabled: true, mode: 'rag-only'}`           (纯知识库 path)
 *   3. neither                    → `{enabled: false}`
 *
 * Outcome (2) used to be reported as `enabled: false` — which silently
 * disabled the entire RAG-only feature on the client side because the
 * client's `augmentUserContent` short-circuits on `!enabled`. The runtime
 * dataset retrieval path (`invokeBlocking` fall-through to `ragOnlyAnswer`)
 * was therefore unreachable end-to-end. We now report `rag-only` explicitly
 * so the client invokes `/enhancement/invoke` and the server's RAG branch
 * fires.
 */
export function getEnhancement(
  enterpriseId: number,
  assistantId: string,
): EnhancementInfo {
  const appRow = db
    .prepare(
      `SELECT dify_tenant_id, dify_app_id, dify_app_mode
         FROM dify_app_binding
        WHERE enterprise_id = ? AND assistant_id = ?`,
    )
    .get(enterpriseId, assistantId) as
    | { dify_tenant_id: string; dify_app_id: string; dify_app_mode: string }
    | undefined;
  if (appRow) {
    const stored = appRow.dify_app_mode;
    // Defensive: legacy rows may still carry `rag-only` if the migration
    // script hasn't run yet. Treat them as agent-chat so callers don't
    // crash; the migration will rewrite them later.
    const mode: EnhancementProbeMode =
      stored === "workflow" ? "workflow" : "agent-chat";
    return {
      enabled: true,
      mode,
      difyAppId: appRow.dify_app_id,
      difyTenantId: appRow.dify_tenant_id,
    };
  }
  const hasDatasets = db
    .prepare(
      `SELECT 1 FROM dify_dataset_binding
        WHERE enterprise_id = ? AND assistant_id = ?
        LIMIT 1`,
    )
    .get(enterpriseId, assistantId);
  if (hasDatasets) {
    return { enabled: true, mode: "rag-only" };
  }
  return { enabled: false };
}
