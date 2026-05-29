/**
 * External API Proxy Routes
 * Proxy requests to sudoworkhub.sudoprivacy.com
 */

import { Hono } from "hono";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const proxyRoutes = new Hono();
const PROXY_HEADERS = {
  Authorization: "sud0@sudo",
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

  const url = `https://sudoworkhub.sudoprivacy.com/api/skills/admin/cursor?${params.toString()}`;

  console.log("=== 专属技能请求 ===");
  console.log("完整URL:", url);
  console.log("请求参数:", Object.fromEntries(params));
  console.log("Authorization: sud0@sudo, Content-Type: application/json");

  const response = await fetch(url, {
    method: "GET",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status);
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

  const url = `https://sudoworkhub.sudoprivacy.com/api/assistants/admin/cursor?${params.toString()}`;

  console.log("=== 专属助手请求 ===");
  console.log("完整URL:", url);
  console.log("请求参数:", Object.fromEntries(params));
  console.log("Authorization: sud0@sudo, Content-Type: application/json");

  const response = await fetch(url, {
    method: "GET",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status);
});

// Approve skill API
proxyRoutes.post("/skills/:skillId/approve", authMiddleware, adminMiddleware, async (c) => {
  const skillId = c.req.param("skillId");
  const url = `https://sudoworkhub.sudoprivacy.com/api/skills/${skillId}/approve`;

  console.log("=== 审批专属技能请求 ===");
  console.log("完整URL:", url);
  console.log("skillId:", skillId);
  console.log("Authorization: sud0@sudo, Content-Type: application/json");

  const response = await fetch(url, {
    method: "POST",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status);
});

// Delete skill API
proxyRoutes.delete("/skills/:skillId", authMiddleware, adminMiddleware, async (c) => {
  const skillId = c.req.param("skillId");
  const url = `https://sudoworkhub.sudoprivacy.com/api/skills/${skillId}`;

  console.log("=== 删除专属技能请求 ===");
  console.log("完整URL:", url);
  console.log("skillId:", skillId);
  console.log("Authorization: sud0@sudo, Content-Type: application/json");

  const response = await fetch(url, {
    method: "DELETE",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status);
});

// Approve assistant API
proxyRoutes.post("/assistants/:assistantId/approve", authMiddleware, adminMiddleware, async (c) => {
  const assistantId = c.req.param("assistantId");
  const url = `https://sudoworkhub.sudoprivacy.com/api/assistants/${assistantId}/approve`;

  console.log("=== 审批专属助手请求 ===");
  console.log("完整URL:", url);
  console.log("assistantId:", assistantId);
  console.log("Authorization: sud0@sudo, Content-Type: application/json");

  const response = await fetch(url, {
    method: "POST",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status);
});

// Delete assistant API
proxyRoutes.delete("/assistants/:assistantId", authMiddleware, adminMiddleware, async (c) => {
  const assistantId = c.req.param("assistantId");
  const url = `https://sudoworkhub.sudoprivacy.com/api/assistants/${assistantId}`;

  console.log("=== 删除专属助手请求 ===");
  console.log("完整URL:", url);
  console.log("assistantId:", assistantId);
  console.log("Authorization: sud0@sudo, Content-Type: application/json");

  const response = await fetch(url, {
    method: "DELETE",
    headers: PROXY_HEADERS,
  });

  const data = await parseProxyResponse(response);
  console.log("响应状态:", response.status);
  console.log("响应数据:", JSON.stringify(data, null, 2));
  return c.json(data, response.status);
});

export { proxyRoutes };
