/**
 * Miscellaneous routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { getAuthUser } from "../middleware/auth.js";
import { getConfigItemsForEnterprise } from "../services/ConfigItemService.js";
import { join } from "node:path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

const miscRoutes = new Hono();

// GET /api/v1/router/models - Get available models
miscRoutes.get("/router/models", (c) => {
  return c.json({
    success: true,
    data: [
      {
        label: "Claude 3.5 Sonnet (Global)",
        value: "claude-3-5-sonnet",
      },
      { label: "GPT-4o (Global)", value: "gpt-4o" },
      { label: "DeepSeek V3", value: "deepseek-v3" },
    ],
  });
});

// POST /api/v1/usage/report - Usage Reporting Endpoint
miscRoutes.post("/usage/report", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const { inputTokens, outputTokens, model } = await c.req.json();
  const totalTokens = (inputTokens || 0) + (outputTokens || 0);

  // Rate: 1000 tokens = 1 point
  const points = Math.ceil((totalTokens / 1000) * 100) / 100;

  if (points <= 0) {
    return c.json({ success: true, deducted: 0, newBalance: 0 });
  }

  // 查询当前用户余额
  const user = db
    .prepare("SELECT balance FROM users WHERE id = ?")
    .get(payload.id) as any;

  if (!user) {
    return c.json({ success: false, msg: "用户不存在" }, 404);
  }

  // 检查余额是否足够
  if (user.balance < points) {
    return c.json(
      {
        success: false,
        msg: "余额不足",
        data: { balance: user.balance, required: points },
      },
      400,
    );
  }

  // 使用事务确保原子性
  db.run("BEGIN TRANSACTION");
  try {
    // Deduct balance
    db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [
      points,
      payload.id,
    ]);

    // Add ledger entry
    db.run(
      "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
      [
        payload.id,
        -points,
        "CONSUME",
        `Used ${model || "model"} (${totalTokens} tokens)`,
      ],
    );

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    console.error("[Usage Report] 扣费失败:", error);
    return c.json({ success: false, msg: "扣费失败" }, 500);
  }

  // Return new balance
  const updatedUser = db
    .prepare("SELECT balance FROM users WHERE id = ?")
    .get(payload.id) as any;

  return c.json({
    success: true,
    deducted: points,
    newBalance: updatedUser?.balance || 0,
  });
});

// GET /api/v1/config/items - Get config items for the authenticated user's enterprise
miscRoutes.get("/config/items", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  if (!payload.enterprise_id) {
    return c.json({ success: true, data: [] });
  }

  const items = await getConfigItemsForEnterprise(payload.enterprise_id);
  return c.json({ success: true, data: items });
});

// GET /api/v1/tenant/config - Get tenant config by code (requires auth)
miscRoutes.get("/tenant/config", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const code = c.req.query("code");

  if (!code) {
    return c.json({ success: false, msg: "租户码不能为空" }, 400);
  }

  const enterprise = db
    .prepare("SELECT logo, app_name, top_name, about_name, app_company_name, login_desp FROM enterprises WHERE code = ?")
    .get(code) as any;

  if (!enterprise) {
    return c.json({ success: false, msg: "租户不存在" }, 404);
  }

  // Convert logo to base64
  let logoBase64 = null;
  if (enterprise.logo) {
    const logoPath = join(UPLOAD_DIR, "enterprises", enterprise.logo);
    const file = Bun.file(logoPath);
    if (await file.exists()) {
      const buffer = await file.arrayBuffer();
      const mimeType = getMimeType(enterprise.logo);
      logoBase64 = `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
    }
  }

  return c.json({
    success: true,
    data: {
      logo: logoBase64,
      app_name: enterprise.app_name,
      top_name: enterprise.top_name,
      about_name: enterprise.about_name,
      app_company_name: enterprise.app_company_name,
      login_desp: enterprise.login_desp,
    },
  });
});

// Helper: get MIME type from file extension
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "image/png";
  }
}

export { miscRoutes };