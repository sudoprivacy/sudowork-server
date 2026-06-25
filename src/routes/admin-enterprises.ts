/**
 * Admin enterprise management routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import { system as difySystem } from "../services/DifyClient.js";

const adminEnterpriseRoutes = new Hono();

// GET /api/v1/admin/enterprises - Enterprise list
adminEnterpriseRoutes.get(
  "/enterprises",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const enterprises = db
      .prepare("SELECT id, name, code, credit_pool, logo, app_name, top_name, about_name, app_company_name, login_desp FROM enterprises ORDER BY id DESC")
      .all();

    // Get user count for each enterprise
    const enterprisesWithCount = (enterprises as any[]).map((ent) => {
      const userCount = db
        .prepare("SELECT COUNT(*) as count FROM users WHERE enterprise_id = ?")
        .get(ent.id) as any;
      return {
        ...ent,
        userCount: userCount?.count || 0,
      };
    });

    return c.json({
      success: true,
      data: enterprisesWithCount,
    });
  },
);

// POST /api/v1/admin/enterprises - Create enterprise
adminEnterpriseRoutes.post(
  "/enterprises",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const { name, code, credit_pool, logo, app_name, top_name, about_name, app_company_name, login_desp } = await c.req.json();

    if (!name || !code) {
      return c.json(
        {
          success: false,
          msg: "企业名称和企业码不能为空",
        },
        400,
      );
    }

    // Check if code already exists
    const existing = db
      .prepare("SELECT * FROM enterprises WHERE code = ?")
      .get(code);

    if (existing) {
      return c.json(
        {
          success: false,
          msg: "企业码已存在",
        },
        400,
      );
    }

    db.run(
      "INSERT INTO enterprises (name, code, credit_pool, logo, app_name, top_name, about_name, app_company_name, login_desp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [name, code, credit_pool || 10000, logo || null, app_name || null, top_name || null, about_name || null, app_company_name || null, login_desp || null],
    );

    return c.json({
      success: true,
      msg: "企业创建成功",
    });
  },
);

// PUT /api/v1/admin/enterprises/:id - Update enterprise
adminEnterpriseRoutes.put(
  "/enterprises/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const id = c.req.param("id") as string;
    const { name, credit_pool, logo, app_name, top_name, about_name, app_company_name, login_desp } = await c.req.json();

    if (!name) {
      return c.json(
        {
          success: false,
          msg: "企业名称不能为空",
        },
        400,
      );
    }

    // Snapshot the previous name + the bound Dify tenant id BEFORE the
    // UPDATE so we can decide whether to push the rename to Dify and avoid
    // a redundant API call when the admin only edits other fields.
    const before = db
      .prepare(
        `SELECT e.name AS prev_name, b.dify_tenant_id AS dify_tenant_id
           FROM enterprises e
           LEFT JOIN dify_tenant_binding b ON b.enterprise_id = e.id
          WHERE e.id = ?`,
      )
      .get(id) as { prev_name: string | null; dify_tenant_id: string | null } | undefined;

    db.run(
      "UPDATE enterprises SET name = ?, credit_pool = ?, logo = ?, app_name = ?, top_name = ?, about_name = ?, app_company_name = ?, login_desp = ? WHERE id = ?",
      [name, credit_pool ?? 10000, logo || null, app_name || null, top_name || null, about_name || null, app_company_name || null, login_desp || null, id],
    );

    // Mirror the rename to Dify so the workspace title in the upper-left
    // of Dify Studio stays in sync. Best-effort: if Dify is unreachable or
    // the tenant is gone we log + continue — the local rename is the
    // source of truth and admins can retry later by editing again.
    if (before?.dify_tenant_id && before.prev_name !== name) {
      try {
        await difySystem.renameTenant(before.dify_tenant_id, name);
      } catch (err) {
        console.warn(
          `[admin/enterprises] dify renameTenant failed for tenant ${before.dify_tenant_id}:`,
          (err as Error).message,
        );
      }
    }

    return c.json({
      success: true,
      msg: "企业更新成功",
    });
  },
);

// DELETE /api/v1/admin/enterprises/:id - Delete enterprise
adminEnterpriseRoutes.delete(
  "/enterprises/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const id = c.req.param("id") as string;

    // Check if enterprise has users
    const userCount = db
      .prepare("SELECT COUNT(*) as count FROM users WHERE enterprise_id = ?")
      .get(id) as any;

    if (userCount?.count > 0) {
      return c.json(
        {
          success: false,
          msg: "企业下还有用户，无法删除",
        },
        400,
      );
    }

    db.run("DELETE FROM enterprises WHERE id = ?", [id]);

    return c.json({
      success: true,
      msg: "企业删除成功",
    });
  },
);

export { adminEnterpriseRoutes };