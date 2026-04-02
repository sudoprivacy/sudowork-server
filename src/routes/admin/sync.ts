/**
 * Admin sync routes
 * Handles order sync and retry operations
 */

import { Hono } from "hono";
import { authMiddleware, adminMiddleware, getAuthUser } from "../../middleware/auth.js";

const syncRoutes = new Hono();

// POST /recharge/orders/:id/retry - Retry failed order
syncRoutes.post("/recharge/orders/:id/retry", authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as any;
  const orderId = c.req.param("id") as string;

  // Import recharge service
  const { rechargeService } = await import("../../services/RechargeService.js");

  const result = await rechargeService.retryFailedOrder(
    parseInt(orderId),
    adminUser.id,
  );

  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }

  return c.json({
    success: true,
    msg: "订单重试成功",
  });
});

// POST /recharge/sync - Sync all pending orders
syncRoutes.post("/recharge/sync", authMiddleware, adminMiddleware, async (c) => {
  const { rechargeService } = await import("../../services/RechargeService.js");
  const result = await rechargeService.syncAllPendingOrders();

  return c.json({
    success: true,
    data: result,
  });
});

// POST /recharge/orders/:orderNo/sync - Sync single order status
syncRoutes.post("/recharge/orders/:orderNo/sync", authMiddleware, adminMiddleware, async (c) => {
  const orderNo = c.req.param("orderNo");
  if (!orderNo) {
    return c.json({ success: false, msg: "订单号不能为空" }, 400);
  }

  const { rechargeService } = await import("../../services/RechargeService.js");
  const result = await rechargeService.syncOrderStatus(orderNo);

  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }

  return c.json({
    success: true,
    data: { order_no: orderNo, status: result.status },
  });
});

export { syncRoutes };