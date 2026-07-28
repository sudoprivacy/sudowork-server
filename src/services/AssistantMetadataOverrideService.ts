/**
 * Local metadata overlay for skill-hub assistants.
 *
 * skill-hub currently accepts assistant package version creation via multipart
 * POST, but its assistant metadata PUT endpoint is broken in production. Keep
 * the editable enterprise-facing fields in sudowork-server and merge them into
 * sudowork-server responses while still using skill-hub as the package/version
 * source of truth.
 */

import { db } from "../db/index.js";

export interface AssistantMetadataOverrideInput {
  enterpriseId: number;
  assistantId: string;
  name: string;
  profession: string;
  description?: string;
  defaultInitPrompt?: string;
  categories?: string[];
  skills?: string[];
  promptFile?: string | null;
  avatar?: string | null;
  skillhubVersion?: string;
}

export interface AssistantMetadataOverride {
  enterpriseId: number;
  assistantId: string;
  name: string;
  profession: string;
  description: string;
  defaultInitPrompt: string;
  categories: string[];
  skills: string[];
  promptFile: string | null;
  avatar: string | null;
  skillhubVersion: string | null;
  updatedAt: number;
}

interface AssistantMetadataOverrideRow {
  enterprise_id: number;
  assistant_id: string;
  name: string;
  profession: string;
  description: string | null;
  default_init_prompt: string | null;
  categories: string | null;
  skills: string | null;
  prompt_file: string | null;
  avatar: string | null;
  skillhub_version: string | null;
  updated_at: number;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function toOverride(row: AssistantMetadataOverrideRow): AssistantMetadataOverride {
  return {
    enterpriseId: row.enterprise_id,
    assistantId: row.assistant_id,
    name: row.name,
    profession: row.profession,
    description: row.description ?? "",
    defaultInitPrompt: row.default_init_prompt ?? "",
    categories: parseStringArray(row.categories),
    skills: parseStringArray(row.skills),
    promptFile: row.prompt_file,
    avatar: row.avatar,
    skillhubVersion: row.skillhub_version,
    updatedAt: row.updated_at,
  };
}

export function upsertAssistantMetadataOverride(
  input: AssistantMetadataOverrideInput,
): AssistantMetadataOverride {
  const now = nowSec();
  db.prepare(
    `INSERT INTO assistant_metadata_overrides (
       enterprise_id, assistant_id, name, profession, description, default_init_prompt,
       categories, skills, prompt_file, avatar, skillhub_version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(enterprise_id, assistant_id) DO UPDATE SET
       name = excluded.name,
       profession = excluded.profession,
       description = excluded.description,
       default_init_prompt = excluded.default_init_prompt,
       categories = excluded.categories,
       skills = excluded.skills,
       prompt_file = COALESCE(excluded.prompt_file, assistant_metadata_overrides.prompt_file),
       avatar = COALESCE(excluded.avatar, assistant_metadata_overrides.avatar),
       skillhub_version = excluded.skillhub_version,
       updated_at = excluded.updated_at`,
  ).run(
    input.enterpriseId,
    input.assistantId,
    input.name,
    input.profession,
    input.description ?? "",
    input.defaultInitPrompt ?? "",
    JSON.stringify(input.categories ?? []),
    JSON.stringify(input.skills ?? []),
    input.promptFile ?? null,
    input.avatar ?? null,
    input.skillhubVersion ?? null,
    now,
    now,
  );

  return {
    enterpriseId: input.enterpriseId,
    assistantId: input.assistantId,
    name: input.name,
    profession: input.profession,
    description: input.description ?? "",
    defaultInitPrompt: input.defaultInitPrompt ?? "",
    categories: input.categories ?? [],
    skills: input.skills ?? [],
    promptFile: input.promptFile ?? null,
    avatar: input.avatar ?? null,
    skillhubVersion: input.skillhubVersion ?? null,
    updatedAt: now,
  };
}

export function deleteAssistantMetadataOverride(enterpriseId: number, assistantId: string): void {
  db.prepare(
    `DELETE FROM assistant_metadata_overrides WHERE enterprise_id = ? AND assistant_id = ?`,
  ).run(enterpriseId, assistantId);
}

export function getAssistantMetadataOverrides(
  enterpriseId: number,
  assistantIds: string[],
): Map<string, AssistantMetadataOverride> {
  const ids = Array.from(new Set(assistantIds.filter((id) => id.length > 0)));
  if (ids.length === 0) return new Map();

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT enterprise_id, assistant_id, name, profession, description,
              default_init_prompt, categories, skills, prompt_file, avatar,
              skillhub_version, updated_at
         FROM assistant_metadata_overrides
        WHERE enterprise_id = ? AND assistant_id IN (${placeholders})`,
    )
    .all(enterpriseId, ...ids) as AssistantMetadataOverrideRow[];

  return new Map(rows.map((row) => [row.assistant_id, toOverride(row)]));
}

export function applyAssistantMetadataOverrides<T extends Record<string, unknown>>(
  enterpriseId: number,
  assistants: T[],
): T[] {
  const ids = assistants
    .map((assistant) => assistant.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const overrides = getAssistantMetadataOverrides(enterpriseId, ids);
  if (overrides.size === 0) return assistants;

  return assistants.map((assistant) => {
    const id = assistant.id;
    if (typeof id !== "string") return assistant;
    const override = overrides.get(id);
    if (!override) return assistant;

    const updatedIso = new Date(override.updatedAt * 1000).toISOString();
    const merged: Record<string, unknown> = {
      ...assistant,
      name: override.name,
      display_name: override.name,
      profession: override.profession,
      description: override.description,
      defaultInitPrompt: override.defaultInitPrompt,
      default_init_prompt: override.defaultInitPrompt,
      categories: override.categories,
      skills: override.skills,
      updatedAt: updatedIso,
      updated_at: updatedIso,
    };
    if (override.promptFile) {
      merged.promptFile = override.promptFile;
      merged.prompt_file = override.promptFile;
    }
    if (override.avatar) merged.avatar = override.avatar;
    return merged as T;
  });
}
