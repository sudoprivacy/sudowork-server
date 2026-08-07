import { Hono } from "hono";
import { getAuthUser } from "../middleware/auth.js";
import { creditApplicationService } from "../services/CreditApplicationService.js";

const creditApplicationRoutes = new Hono();

creditApplicationRoutes.post("/", async (c) => {
  const payload = await getAuthUser(c);
  if (!payload?.id) return c.json({ success: false, msg: "未授权" }, 401);

  const body = await c.req.json().catch(() => ({}));
  const result = creditApplicationService.createApplication({
    userId: Number(payload.id),
    requestedPoints: Number(body.requested_points),
    reason: body.reason,
  });
  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }
  return c.json({ success: true, data: result.data });
});

creditApplicationRoutes.get("/", async (c) => {
  const payload = await getAuthUser(c);
  if (!payload?.id) return c.json({ success: false, msg: "未授权" }, 401);

  const page = parseInt(c.req.query("page") || "1", 10);
  const pageSize = parseInt(c.req.query("pageSize") || "20", 10);
  const data = creditApplicationService.listUserApplications({
    userId: Number(payload.id),
    page,
    pageSize,
  });
  return c.json({ success: true, data });
});

creditApplicationRoutes.get("/:id", async (c) => {
  const payload = await getAuthUser(c);
  if (!payload?.id) return c.json({ success: false, msg: "未授权" }, 401);

  const application = creditApplicationService.getUserApplication(
    Number(payload.id),
    Number(c.req.param("id")),
  );
  if (!application) {
    return c.json({ success: false, msg: "申请记录不存在" }, 404);
  }
  return c.json({ success: true, data: application });
});

export { creditApplicationRoutes };
