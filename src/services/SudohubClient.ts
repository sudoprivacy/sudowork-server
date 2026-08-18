/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Thin client for the sudohub assistant catalog.
 *
 * The current sudohub authentication uses a static shared header
 * (`Authorization: sud0@sudo`); we centralize that here so the rest of the
 * codebase never has to spell out the URL or header again.
 *
 * Endpoint contract (per https://sudoworkhub.sudoprivacy.com/api/docs):
 *
 *   POST   /api/assistants                       multipart create
 *   GET    /api/assistants/cursor                user-facing list (status=1)
 *   GET    /api/assistants/admin/cursor          admin list (all statuses)
 *   GET    /api/assistants/{id}                  detail
 *   PUT    /api/assistants/{id}                  JSON metadata update
 *   DELETE /api/assistants/{id}                  delete
 *   POST   /api/assistants/{id}/approve          status 0 → 1
 *
 * We intentionally keep this client small. It does NOT model the assistant
 * shape with strict types — sudohub's OpenAPI is stub-only and the shape
 * evolves on their side. Callers receive whatever JSON sudohub returned.
 */

// Env names: SudohubClient was introduced after `external-proxy.ts`, which
// had already shipped using `SKILLHUB_BASE_URL` / `SKILLHUB_API_TOKEN`.
// Deployments configured against the original names would silently fall back
// to the public `sudoworkhub.sudoprivacy.com` (unreachable in airgapped
// customer sites) and hit a 10s socket timeout. Accept either name to keep
// existing .env files working without forcing every customer to rename.
const SUDOHUB_BASE_URL = (
  process.env.SUDOHUB_BASE_URL ||
  process.env.SKILLHUB_BASE_URL ||
  "https://sudoworkhub.sudoprivacy.com"
).replace(/\/+$/, "");
const SUDOHUB_AUTH =
  process.env.SUDOHUB_AUTH_TOKEN ||
  process.env.SKILLHUB_API_TOKEN ||
  "sud0@sudo";

export class SudohubClientError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(`[sudohub ${status}] ${message}`);
    this.status = status;
    this.detail = detail;
  }
}

function headersJson(): Record<string, string> {
  return { Authorization: SUDOHUB_AUTH, "Content-Type": "application/json" };
}

function headersBare(): Record<string, string> {
  return { Authorization: SUDOHUB_AUTH };
}

function normalizeTenantIds(
  tenantIds: string[] | undefined,
): string[] | undefined {
  if (tenantIds === undefined) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tenantIds) {
    const tenantId = raw.trim();
    if (!tenantId || seen.has(tenantId)) continue;
    seen.add(tenantId);
    out.push(tenantId);
  }
  return out;
}

async function parseBody(resp: Response): Promise<unknown> {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { success: resp.ok, raw: text };
  }
}

async function expectOk(resp: Response, label: string): Promise<unknown> {
  const body = await parseBody(resp);
  if (!resp.ok) {
    throw new SudohubClientError(resp.status, `${label} failed`, body);
  }
  return body;
}

// ============================================================================
// Cursor list
// ============================================================================

export interface AssistantListQuery {
  cursor?: string;
  limit?: number;
  query?: string;
  category?: string;
  tenantId?: string;
  /** admin-only */
  status?: number;
}

function buildCursorQs(args: AssistantListQuery): string {
  const params = new URLSearchParams();
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.limit != null) params.set("limit", String(args.limit));
  if (args.query) params.set("query", args.query);
  if (args.category) params.set("category", args.category);
  if (args.tenantId) params.set("tenant_id", args.tenantId);
  if (args.status != null) params.set("status", String(args.status));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export async function listAssistants(
  args: AssistantListQuery = {},
): Promise<unknown> {
  const resp = await fetch(
    `${SUDOHUB_BASE_URL}/api/assistants/cursor${buildCursorQs(args)}`,
    {
      method: "GET",
      headers: headersJson(),
    },
  );
  return expectOk(resp, "GET /api/assistants/cursor");
}

export async function listAssistantsAdmin(
  args: AssistantListQuery = {},
): Promise<unknown> {
  const resp = await fetch(
    `${SUDOHUB_BASE_URL}/api/assistants/admin/cursor${buildCursorQs(args)}`,
    {
      method: "GET",
      headers: headersJson(),
    },
  );
  return expectOk(resp, "GET /api/assistants/admin/cursor");
}

/**
 * sudohub does not currently expose POST /api/assistants/by-ids. Until they
 * do, we walk through the admin cursor and filter client-side. This is fine
 * for the small per-tenant assistant counts expected at launch (<200) and is
 * the only way to get `tenant_id`-scoped lookup with sudohub's current API.
 *
 * Callers should treat this as a temporary inefficiency to swap out the day
 * sudohub adds the batch endpoint.
 */
export async function listAssistantsByIds(args: {
  ids: string[];
  tenantId?: string;
}): Promise<unknown[]> {
  if (args.ids.length === 0) return [];
  const wanted = new Set(args.ids);
  const out: unknown[] = [];
  let cursor: string | undefined;
  // Hard cap to keep cost bounded; sudohub's max limit is 100.
  for (let page = 0; page < 20; page++) {
    // sudohub returns { success, data: { assistants, has_more, next_cursor } }.
    // has_more / next_cursor live INSIDE data, not at the top level.
    const body = (await listAssistantsAdmin({
      cursor,
      limit: 100,
      tenantId: args.tenantId,
    })) as {
      data?:
        | Array<{ id: string }>
        | {
            assistants?: Array<{ id: string }>;
            next_cursor?: string | null;
            has_more?: boolean;
          };
      next_cursor?: string | null;
      has_more?: boolean;
    } | null;
    const dataField = body?.data;
    const rows: Array<{ id: string }> = Array.isArray(dataField)
      ? dataField
      : Array.isArray((dataField as { assistants?: unknown })?.assistants)
        ? (dataField as { assistants: Array<{ id: string }> }).assistants
        : [];
    for (const row of rows) {
      if (row && typeof row.id === "string" && wanted.has(row.id))
        out.push(row);
    }
    if (out.length === wanted.size) break;
    const hasMore = Array.isArray(dataField)
      ? body?.has_more
      : (dataField as { has_more?: boolean })?.has_more;
    const nextCursor = Array.isArray(dataField)
      ? body?.next_cursor
      : (dataField as { next_cursor?: string | null })?.next_cursor;
    if (!hasMore || !nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

// ============================================================================
// Single-record CRUD
// ============================================================================

export async function getAssistant(assistantId: string): Promise<unknown> {
  const resp = await fetch(
    `${SUDOHUB_BASE_URL}/api/assistants/${assistantId}`,
    {
      method: "GET",
      headers: headersJson(),
    },
  );
  return expectOk(resp, `GET /api/assistants/${assistantId}`);
}

export async function deleteAssistant(assistantId: string): Promise<void> {
  const resp = await fetch(
    `${SUDOHUB_BASE_URL}/api/assistants/${assistantId}`,
    {
      method: "DELETE",
      headers: headersJson(),
    },
  );
  if (!resp.ok && resp.status !== 204) {
    const body = await parseBody(resp);
    throw new SudohubClientError(
      resp.status,
      `DELETE /api/assistants/${assistantId} failed`,
      body,
    );
  }
}

export async function approveAssistant(assistantId: string): Promise<unknown> {
  const resp = await fetch(
    `${SUDOHUB_BASE_URL}/api/assistants/${assistantId}/approve`,
    {
      method: "POST",
      headers: headersJson(),
    },
  );
  return expectOk(resp, `POST /api/assistants/${assistantId}/approve`);
}

// ============================================================================
// Create / version-create (multipart) + metadata update (JSON)
// ============================================================================

export interface CreateAssistantInput {
  name: string;
  profession: string;
  version?: string;
  changelog?: string;
  description?: string;
  defaultInitPrompt?: string;
  promptsI18n?: Record<string, string[]>;
  /** New skillhub multi-tenant field. When set, this is authoritative. */
  tenantIds?: string[];
  tenantId?: string;
  sortOrder?: number;
  /** 0=审核中, 1=已发布 */
  status?: number;
  categories?: string[];
  /** sudohub skill UUID array */
  skills?: string[];
  /** prompt markdown as in-memory bytes; if both `promptFile` and `promptFileBytes` set, bytes wins. */
  promptFileBytes?: Uint8Array | Buffer;
  promptFileName?: string;
  /** Avatar PNG bytes (optional). */
  avatarBytes?: Uint8Array | Buffer;
  avatarFileName?: string;
  /** Optional resource zip. */
  sourceZipBytes?: Uint8Array | Buffer;
  sourceZipFileName?: string;
}

export interface CreateAssistantVersionInput extends CreateAssistantInput {
  version: string;
  sourceZipBytes: Uint8Array | Buffer;
}

function bytesToBlobPart(bytes: Uint8Array | Buffer): ArrayBuffer {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function describeFormValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "name" in value &&
    "size" in value
  ) {
    const maybeFile = value as { name?: unknown; size?: unknown };
    if (
      typeof maybeFile.name === "string" &&
      typeof maybeFile.size === "number"
    ) {
      return `<file ${maybeFile.name} ${maybeFile.size}B>`;
    }
  }
  return value;
}

function appendMultipart(form: FormData, input: CreateAssistantInput) {
  form.append("name", input.name);
  form.append("profession", input.profession);
  if (input.version) form.append("version", input.version);
  if (input.changelog) form.append("changelog", input.changelog);
  if (input.description) form.append("description", input.description);
  if (input.defaultInitPrompt)
    form.append("defaultInitPrompt", input.defaultInitPrompt);
  if (input.promptsI18n !== undefined) {
    form.append("promptsI18n", JSON.stringify(input.promptsI18n));
  }
  const tenantIds = normalizeTenantIds(input.tenantIds);
  if (tenantIds !== undefined)
    form.append("tenantIds", JSON.stringify(tenantIds));
  if (input.tenantId) form.append("tenantId", input.tenantId);
  if (input.sortOrder != null)
    form.append("sortOrder", String(input.sortOrder));
  if (input.status != null) form.append("status", String(input.status));
  if (input.categories && input.categories.length > 0) {
    // sudohub accepts JSON string OR comma-separated. We pick JSON because
    // it's lossless for unusual characters in category names.
    form.append("categories", JSON.stringify(input.categories));
  }
  if (input.skills && input.skills.length > 0) {
    form.append("skills", input.skills.join(","));
  }
  if (input.promptFileBytes) {
    const blob = new Blob([bytesToBlobPart(input.promptFileBytes)], {
      type: "text/markdown",
    });
    form.append("prompt_file", blob, input.promptFileName || "prompt.md");
  }
  if (input.avatarBytes) {
    const blob = new Blob([bytesToBlobPart(input.avatarBytes)], {
      type: "image/png",
    });
    form.append("avatar", blob, input.avatarFileName || "avatar.png");
  }
  if (input.sourceZipBytes) {
    const blob = new Blob([bytesToBlobPart(input.sourceZipBytes)], {
      type: "application/zip",
    });
    form.append("source_url", blob, input.sourceZipFileName || "source.zip");
  }
}

export async function createAssistant(input: CreateAssistantInput): Promise<{
  id: string;
  raw: unknown;
}> {
  return postAssistantMultipart(input, "createAssistant");
}

export async function createAssistantVersion(
  input: CreateAssistantVersionInput,
): Promise<{
  id: string;
  raw: unknown;
}> {
  return postAssistantMultipart(input, "createAssistantVersion");
}

async function postAssistantMultipart(
  input: CreateAssistantInput,
  label: "createAssistant" | "createAssistantVersion",
): Promise<{ id: string; raw: unknown }> {
  const form = new FormData();
  appendMultipart(form, input);
  // Log the form contents (sans file bytes) so we can compare against the
  // server's reported validation failure when sudohub returns 4xx.
  const dumped: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    dumped[k] = describeFormValue(v);
  }
  console.log(`[sudohub.${label}] POST /api/assistants payload:`, dumped);

  const resp = await fetch(`${SUDOHUB_BASE_URL}/api/assistants`, {
    method: "POST",
    headers: headersBare(),
    body: form,
  });
  const body = await parseBody(resp);
  if (!resp.ok) {
    console.error(
      `[sudohub.${label}] sudohub ${resp.status} body:`,
      JSON.stringify(body),
    );
    throw new SudohubClientError(
      resp.status,
      "POST /api/assistants failed",
      body,
    );
  }
  // Observed sudohub shape (as of 2026-06-20):
  //   { success: true, data: { assistant: { id, name, ... }, version: ... } }
  // We also accept the historical shapes `{ id }` / `{ data: { id } }` so
  // a sudohub version bump doesn't break us at the call site.
  const ok = body as {
    id?: string;
    assistant_id?: string;
    data?: {
      id?: string;
      assistant_id?: string;
      assistant?: { id?: string };
    };
  } | null;
  const id =
    ok?.id ||
    ok?.assistant_id ||
    ok?.data?.id ||
    ok?.data?.assistant_id ||
    ok?.data?.assistant?.id;
  if (!id) {
    console.error(
      `[sudohub.${label}] missing id; raw body:`,
      JSON.stringify(body),
    );
    throw new SudohubClientError(500, "sudohub response missing id", body);
  }
  return { id, raw: body };
}

export interface UpdateAssistantInput {
  name?: string;
  profession?: string;
  description?: string;
  defaultInitPrompt?: string;
  promptsI18n?: Record<string, string[]>;
  /** New skillhub multi-tenant field. When set, this is authoritative. */
  tenantIds?: string[];
  tenantId?: string;
  sortOrder?: number;
  status?: number;
  categories?: string[];
  skills?: string[];
}

/**
 * Replace-mode metadata update — passes only the fields the caller provided.
 * skill-hub's assistant PUT route calls `request.get_json()`, so files/version
 * data must go through POST /api/assistants instead.
 */
export async function updateAssistant(
  assistantId: string,
  input: UpdateAssistantInput,
): Promise<unknown> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.profession !== undefined) payload.profession = input.profession;
  if (input.description !== undefined) payload.description = input.description;
  if (input.defaultInitPrompt !== undefined) {
    payload.defaultInitPrompt = input.defaultInitPrompt;
  }
  if (input.promptsI18n !== undefined) payload.promptsI18n = input.promptsI18n;
  const tenantIds = normalizeTenantIds(input.tenantIds);
  if (tenantIds !== undefined) payload.tenantIds = tenantIds;
  if (input.tenantId !== undefined) payload.tenantId = input.tenantId;
  if (input.sortOrder != null) payload.sortOrder = input.sortOrder;
  if (input.status != null) payload.status = input.status;
  if (input.categories !== undefined) payload.categories = input.categories;
  if (input.skills !== undefined) payload.skills = input.skills;

  const resp = await fetch(
    `${SUDOHUB_BASE_URL}/api/assistants/${assistantId}`,
    {
      method: "PUT",
      headers: headersJson(),
      body: JSON.stringify(payload),
    },
  );
  if (!resp.ok) {
    const body = await parseBody(resp);
    console.error(
      `[sudohub.updateAssistant] sudohub ${resp.status} body:`,
      JSON.stringify(body),
    );
    throw new SudohubClientError(
      resp.status,
      `PUT /api/assistants/${assistantId} failed`,
      body,
    );
  }
  return parseBody(resp);
}

export const SUDOHUB_BASE = SUDOHUB_BASE_URL;
