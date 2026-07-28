/**
 * External API Proxy Routes
 * Proxy requests to sudoworkhub.sudoprivacy.com
 */

import { Hono } from "hono";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { applyAssistantMetadataOverrides } from "../services/AssistantMetadataOverrideService.js";

const SKILLHUB_BASE_URL = (
  process.env.SKILLHUB_BASE_URL || "https://sudoworkhub.sudoprivacy.com"
).replace(/\/+$/, "");
const SKILLHUB_API_TOKEN = process.env.SKILLHUB_API_TOKEN || "sud0@sudo";

const proxyRoutes = new Hono();
const PROXY_HEADERS = {
  Authorization: SKILLHUB_API_TOKEN,
  "Content-Type": "application/json",
};

async function parseProxyResponse(response: Response) {
  const rawText = await response.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return { success: response.ok, message: rawText };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function enterpriseIdForTenantCode(tenantId?: string): number | undefined {
  if (!tenantId) return undefined;
  const row = db
    .prepare(`SELECT id FROM enterprises WHERE code = ?`)
    .get(tenantId) as { id: number } | undefined;
  return row?.id;
}

function mergeAssistantOverridesIntoCursorResponse(
  body: unknown,
  enterpriseId?: number,
): unknown {
  if (!enterpriseId) return body;

  const root = asRecord(body);
  if (!root) return body;

  if (Array.isArray(root.data)) {
    root.data = applyAssistantMetadataOverrides(
      enterpriseId,
      root.data.filter((item): item is Record<string, unknown> => !!asRecord(item)),
    );
    return root;
  }

  const data = asRecord(root.data);
  if (data && Array.isArray(data.assistants)) {
    data.assistants = applyAssistantMetadataOverrides(
      enterpriseId,
      data.assistants.filter((item): item is Record<string, unknown> => !!asRecord(item)),
    );
  }
  return root;
}

// Proxy skills API
proxyRoutes.get("/skills/cursor", authMiddleware, adminMiddleware, async (c) => {
  const tenantId = c.req.query("tenant_id");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit");
  const query = c.req.query("query");
  const categories = c.req.query("categories");

  const params = new URLSearchParams();
  if (tenantId) params.append("tenant_id", tenantId);
  if (cursor) params.append("cursor", cursor);
  if (limit) params.append("limit", limit);
  if (query) params.append("query", query);
  if (categories) params.append("categories", categories);

  const url = `${SKILLHUB_BASE_URL}/api/skills/admin/cursor?${params.toString()}`;

  console.log("=== 专属技能请求 ===");
  console.log("完整URL:", url);
  console.log("请求参数:", Object.fromEntries(params));
  console.log("Authorization: 已配置, Content-Type: application/json");

  const response = await fetch(url, {
    method: "GET",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status as 200);
});

// Proxy assistants API
proxyRoutes.get("/assistants/cursor", authMiddleware, adminMiddleware, async (c) => {
  const tenantId = c.req.query("tenant_id");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit");
  const query = c.req.query("query");
  const category = c.req.query("category");

  const params = new URLSearchParams();
  if (tenantId) params.append("tenant_id", tenantId);
  if (cursor) params.append("cursor", cursor);
  if (limit) params.append("limit", limit);
  if (query) params.append("query", query);
  if (category) params.append("category", category);

  const url = `${SKILLHUB_BASE_URL}/api/assistants/admin/cursor?${params.toString()}`;

  console.log("=== 专属智能体请求 ===");
  console.log("完整URL:", url);
  console.log("请求参数:", Object.fromEntries(params));
  console.log("Authorization: 已配置, Content-Type: application/json");

  const response = await fetch(url, {
    method: "GET",
    headers: PROXY_HEADERS,
  });

  const data = mergeAssistantOverridesIntoCursorResponse(
    await parseProxyResponse(response),
    enterpriseIdForTenantCode(tenantId),
  );
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status as 200);
});

// Approve skill API
proxyRoutes.post("/skills/:skillId/approve", authMiddleware, adminMiddleware, async (c) => {
  const skillId = c.req.param("skillId");
  const url = `${SKILLHUB_BASE_URL}/api/skills/${skillId}/approve`;

  console.log("=== 审批专属技能请求 ===");
  console.log("完整URL:", url);
  console.log("skillId:", skillId);
  console.log("Authorization: 已配置, Content-Type: application/json");

  const response = await fetch(url, {
    method: "POST",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status as 200);
});

// Delete skill API
proxyRoutes.delete("/skills/:skillId", authMiddleware, adminMiddleware, async (c) => {
  const skillId = c.req.param("skillId");
  const url = `${SKILLHUB_BASE_URL}/api/skills/${skillId}`;

  console.log("=== 删除专属技能请求 ===");
  console.log("完整URL:", url);
  console.log("skillId:", skillId);
  console.log("Authorization: 已配置, Content-Type: application/json");

  const response = await fetch(url, {
    method: "DELETE",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status as 200);
});

// Approve assistant API
proxyRoutes.post("/assistants/:assistantId/approve", authMiddleware, adminMiddleware, async (c) => {
  const assistantId = c.req.param("assistantId");
  const url = `${SKILLHUB_BASE_URL}/api/assistants/${assistantId}/approve`;

  console.log("=== 审批专属智能体请求 ===");
  console.log("完整URL:", url);
  console.log("assistantId:", assistantId);
  console.log("Authorization: 已配置, Content-Type: application/json");

  const response = await fetch(url, {
    method: "POST",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status as 200);
});

// Delete assistant API
proxyRoutes.delete("/assistants/:assistantId", authMiddleware, adminMiddleware, async (c) => {
  const assistantId = c.req.param("assistantId");
  const url = `${SKILLHUB_BASE_URL}/api/assistants/${assistantId}`;

  console.log("=== 删除专属智能体请求 ===");
  console.log("完整URL:", url);
  console.log("assistantId:", assistantId);
  console.log("Authorization: 已配置, Content-Type: application/json");

  const response = await fetch(url, {
    method: "DELETE",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status as 200);
});

export { proxyRoutes };
