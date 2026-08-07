import { Hono } from "hono";
import {
  adminMiddleware,
  authMiddleware,
  getAuthUser,
} from "../../middleware/auth.js";
import { creditApplicationService } from "../../services/CreditApplicationService.js";
import type { UserPayload } from "../../middleware/auth.js";

const adminCreditApplicationRoutes = new Hono();

function getEnterpriseScope(adminUser: UserPayload): number | null | undefined {
  return adminUser.role === "ENTERPRISE_ADMIN"
    ? (adminUser.enterprise_id ?? null)
    : undefined;
}

function getAdminRole(
  adminUser: UserPayload,
): "SUPER_ADMIN" | "ENTERPRISE_ADMIN" {
  return adminUser.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ENTERPRISE_ADMIN";
}

adminCreditApplicationRoutes.get(
  "/credit-applications",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as UserPayload;
    const page = parseInt(c.req.query("page") || "1", 10);
    const pageSize = parseInt(
      c.req.query("pageSize") || c.req.query("page_size") || "20",
      10,
    );
    const enterpriseId = c.req.query("enterprise_id")
      ? Number(c.req.query("enterprise_id"))
      : undefined;
    const data = creditApplicationService.listAdminApplications({
      keyword: c.req.query("keyword")?.trim().slice(0, 50),
      enterpriseId,
      enterpriseScope: getEnterpriseScope(adminUser),
      status: c.req.query("status") || undefined,
      page,
      pageSize,
    });
    return c.json({ success: true, data });
  },
);

adminCreditApplicationRoutes.get(
  "/credit-applications/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as UserPayload;
    const application = creditApplicationService.getAdminApplication(
      Number(c.req.param("id")),
      getEnterpriseScope(adminUser),
    );
    if (!application) {
      return c.json({ success: false, msg: "申请记录不存在" }, 404);
    }
    return c.json({ success: true, data: application });
  },
);

adminCreditApplicationRoutes.post(
  "/credit-applications/:id/approve",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as UserPayload;
    const body = await c.req.json().catch(() => ({}));
    const result = await creditApplicationService.approveApplication({
      applicationId: Number(c.req.param("id")),
      adminId: Number(adminUser.id),
      adminRole: getAdminRole(adminUser),
      adminEnterpriseId: adminUser.enterprise_id ?? null,
      approvedPoints:
        body.approved_points === undefined
          ? undefined
          : Number(body.approved_points),
      adminComment: body.admin_comment,
    });
    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }
    return c.json({ success: true, msg: "审批通过", data: result.data });
  },
);

adminCreditApplicationRoutes.post(
  "/credit-applications/:id/reject",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as UserPayload;
    const body = await c.req.json().catch(() => ({}));
    const result = creditApplicationService.rejectApplication({
      applicationId: Number(c.req.param("id")),
      adminId: Number(adminUser.id),
      adminRole: getAdminRole(adminUser),
      adminEnterpriseId: adminUser.enterprise_id ?? null,
      adminComment: body.admin_comment,
    });
    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }
    return c.json({ success: true, msg: "已拒绝" });
  },
);

adminCreditApplicationRoutes.post(
  "/credit-applications/:id/retry-sync",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as UserPayload;
    const application = creditApplicationService.getAdminApplication(
      Number(c.req.param("id")),
      getEnterpriseScope(adminUser),
    );
    if (!application) {
      return c.json({ success: false, msg: "申请记录不存在" }, 404);
    }
    if (application.status !== "SYNC_FAILED") {
      return c.json({ success: false, msg: "只有同步失败的申请可以重试" }, 400);
    }
    const result = await creditApplicationService.approveApplication({
      applicationId: application.id,
      adminId: Number(adminUser.id),
      adminRole: getAdminRole(adminUser),
      adminEnterpriseId: adminUser.enterprise_id ?? null,
      approvedPoints: application.approved_points ?? application.requested_points,
      adminComment: application.admin_comment ?? "重试同步",
    });
    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }
    return c.json({ success: true, msg: "重试成功", data: result.data });
  },
);

export { adminCreditApplicationRoutes };
