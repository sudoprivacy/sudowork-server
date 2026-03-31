/**
 * Recharge routes
 * User-facing recharge endpoints
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { rechargeService } from "../services/RechargeService.js";
import { getAuthUser } from "../middleware/auth.js";

const rechargeRoutes = new Hono();

// GET /api/v1/recharge/packages - Get recharge packages
rechargeRoutes.get("/packages", async (c) => {
  const packages = rechargeService.getPackages();
  const exchangeRate = parseFloat(process.env.USD_TO_CNY_RATE || "7.3");

  // Add CNY amount to each package
  const packagesWithCny = packages.map(p => ({
    ...p,
    amount_cny: Math.round(p.amount * exchangeRate * 100) / 100,
    exchange_rate: exchangeRate,
  }));

  return c.json({ success: true, data: packagesWithCny });
});

// POST /api/v1/recharge/create - Create recharge order
rechargeRoutes.post("/create", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const body = await c.req.json();
  const { amount, payment_method } = body;

  if (!amount || !payment_method) {
    return c.json({ success: false, msg: "金额和支付方式不能为空" }, 400);
  }

  if (payment_method !== "ALIPAY" && payment_method !== "WECHAT") {
    return c.json({ success: false, msg: "支付方式无效" }, 400);
  }

  // Get user info
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id) as any;
  if (!user) {
    return c.json({ success: false, msg: "用户不存在" }, 404);
  }

  const result = rechargeService.createOrder(
    user.id,
    user.phone,
    user.enterprise_id,
    amount,
    payment_method
  );

  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }

  return c.json({ success: true, data: result.order });
});

// POST /api/v1/recharge/pay - Pay order (get QR code)
rechargeRoutes.post("/pay", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const body = await c.req.json();
  const { order_no } = body;

  if (!order_no) {
    return c.json({ success: false, msg: "订单号不能为空" }, 400);
  }

  const result = await rechargeService.payOrder(payload.id, order_no);

  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }

  return c.json({
    success: true,
    data: {
      order_no,
      qr_code_url: result.qr_code_url,
      order_info: result.order_info,
    },
  });
});

// POST /api/v1/recharge/callback - Fuiou payment callback
rechargeRoutes.post("/callback", async (c) => {
  const payload = await c.req.json();

  console.log("[Recharge] Received Fuiou callback:", JSON.stringify(payload));

  const result = await rechargeService.handleCallback(payload);

  if (result.success) {
    return c.text("success");
  } else {
    console.error("[Recharge] Callback failed:", result.error);
    return c.text("fail", 500);
  }
});

// GET /api/v1/recharge/query/:orderNo - Query order status
rechargeRoutes.get("/query/:orderNo", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const orderNo = c.req.param("orderNo");
  const order = rechargeService.queryOrder(payload.id, orderNo);

  if (!order) {
    return c.json({ success: false, msg: "订单不存在" }, 404);
  }

  return c.json({ success: true, data: order });
});

// GET /api/v1/recharge/list - Get recharge list
rechargeRoutes.get("/list", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const page = parseInt(c.req.query("page") || "1");
  const pageSize = parseInt(c.req.query("pageSize") || "20");

  const result = rechargeService.getOrderList(payload.id, page, pageSize);

  return c.json({ success: true, data: result });
});

// POST /api/v1/recharge/cancel/:orderNo - Cancel order
rechargeRoutes.post("/cancel/:orderNo", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const orderNo = c.req.param("orderNo");
  const result = rechargeService.cancelOrder(payload.id, orderNo);

  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }

  return c.json({ success: true, msg: "订单已取消" });
});

export { rechargeRoutes };