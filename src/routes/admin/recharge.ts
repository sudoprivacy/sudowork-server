/**
 * Admin recharge routes
 * Handles recharge order management, refunds, and statistics
 */

import { Hono } from "hono";
import { db } from "../../db/index.js";
import { authMiddleware, adminMiddleware, getAuthUser } from "../../middleware/auth.js";
import { ORDER_STATUS, ORDER_STATUS_TEXT } from "../../utils/constants.js";

const rechargeRoutes = new Hono();

// GET /recharge/orders - Get recharge orders list with filters
rechargeRoutes.get("/recharge/orders", authMiddleware, adminMiddleware, async (c) => {
  const status = c.req.query("status");
  const orderNo = c.req.query("order_no");
  const userPhone = c.req.query("user_phone");
  const startDate = c.req.query("start_date");
  const endDate = c.req.query("end_date");
  const page = parseInt(c.req.query("page") || "1");
  const pageSize = parseInt(c.req.query("pageSize") || c.req.query("page_size") || "20");
  const offset = (page - 1) * pageSize;

  let query = `
    SELECT ro.*, u.phone as user_phone, u.nickname as user_nickname
    FROM recharge_orders ro
    LEFT JOIN users u ON ro.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  // Filter by status
  if (status !== undefined && status !== "") {
    query += " AND ro.status = ?";
    params.push(parseInt(status));
  }

  // Filter by order_no
  if (orderNo !== undefined && orderNo !== "") {
    query += " AND ro.order_no LIKE ?";
    params.push(`%${orderNo}%`);
  }

  // Filter by user_phone
  if (userPhone !== undefined && userPhone !== "") {
    query += " AND u.phone LIKE ?";
    params.push(`%${userPhone}%`);
  }

  // Filter by date range
  if (startDate !== undefined && startDate !== "") {
    query += " AND DATE(ro.created_at) >= ?";
    params.push(startDate);
  }
  if (endDate !== undefined && endDate !== "") {
    query += " AND DATE(ro.created_at) <= ?";
    params.push(endDate);
  }

  query += " ORDER BY ro.created_at DESC LIMIT ? OFFSET ?";
  params.push(pageSize, offset);

  const orders = db.prepare(query).all(...params) as any[];

  // Get total count with same filters
  let countQuery = `
    SELECT COUNT(*) as count
    FROM recharge_orders ro
    LEFT JOIN users u ON ro.user_id = u.id
    WHERE 1=1
  `;
  const countParams: any[] = [];

  if (status !== undefined && status !== "") {
    countQuery += " AND ro.status = ?";
    countParams.push(parseInt(status));
  }
  if (orderNo !== undefined && orderNo !== "") {
    countQuery += " AND ro.order_no LIKE ?";
    countParams.push(`%${orderNo}%`);
  }
  if (userPhone !== undefined && userPhone !== "") {
    countQuery += " AND u.phone LIKE ?";
    countParams.push(`%${userPhone}%`);
  }
  if (startDate !== undefined && startDate !== "") {
    countQuery += " AND DATE(ro.created_at) >= ?";
    countParams.push(startDate);
  }
  if (endDate !== undefined && endDate !== "") {
    countQuery += " AND DATE(ro.created_at) <= ?";
    countParams.push(endDate);
  }

  const total = db.prepare(countQuery).get(...countParams) as any;

  return c.json({
    success: true,
    data: {
      list: orders.map((o) => ({
        id: o.id,
        order_no: o.order_no,
        user_id: o.user_id,
        user_phone: o.user_phone,
        user_nickname: o.user_nickname,
        amount_usd: o.amount_usd,
        amount_cny: o.amount_yuan,
        exchange_rate: o.exchange_rate,
        points: o.points_amount,
        bonus_points: o.bonus_points,
        payment_method: o.payment_method,
        status: o.status,
        status_text: ORDER_STATUS_TEXT[o.status] || "未知",
        created_at: o.created_at,
        callback_time: o.callback_time,
        remark: o.remark,
      })),
      total: total.count,
      page,
      pageSize,
    },
  });
});

// GET /recharge/orders/:orderNo - Get order detail
rechargeRoutes.get("/recharge/orders/:orderNo", authMiddleware, adminMiddleware, async (c) => {
  const orderNo = c.req.param("orderNo");
  if (!orderNo) {
    return c.json({ success: false, msg: "订单号不能为空" }, 400);
  }

  const order = db
    .prepare(
      `SELECT ro.*, u.phone as user_phone, u.nickname as user_nickname
       FROM recharge_orders ro
       LEFT JOIN users u ON ro.user_id = u.id
       WHERE ro.order_no = ?`
    )
    .get(orderNo) as any;

  if (!order) {
    return c.json({ success: false, msg: "订单不存在" }, 404);
  }

  return c.json({
    success: true,
    data: {
      order_no: order.order_no,
      user_id: order.user_id,
      user_phone: order.user_phone,
      user_nickname: order.user_nickname,
      amount_usd: order.amount_usd,
      amount_cny: order.amount_yuan,
      exchange_rate: order.exchange_rate,
      points: order.points_amount,
      bonus_points: order.bonus_points,
      quota: order.quota_amount,
      payment_method: order.payment_method,
      status: order.status,
      status_text: ORDER_STATUS_TEXT[order.status] || "未知",
      created_at: order.created_at,
      callback_time: order.callback_time,
      expired_at: order.expired_at,
      remark: order.remark,
      fuiou_order_info: order.fuiou_order_info,
    },
  });
});

// GET /recharge/stats - Recharge statistics
rechargeRoutes.get("/recharge/stats", authMiddleware, adminMiddleware, async (c) => {
  // 总体统计
  const totalStats = db
    .prepare(
      `SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as total_amount_usd,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as total_amount_cny,
        COALESCE(SUM(CASE WHEN status = 2 THEN points_amount ELSE 0 END), 0) as total_points,
        COALESCE(SUM(CASE WHEN status = 2 THEN bonus_points ELSE 0 END), 0) as total_bonus,
        COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0) as success_count,
        COALESCE(SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END), 0) as failed_count,
        COALESCE(SUM(CASE WHEN status IN (0, 1) THEN 1 ELSE 0 END), 0) as pending_count
      FROM recharge_orders`
    )
    .get() as any;

  // 今日统计
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = db
    .prepare(
      `SELECT
        COUNT(*) as today_orders,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as today_amount_usd,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as today_amount_cny,
        COALESCE(SUM(CASE WHEN status = 2 THEN points_amount ELSE 0 END), 0) as today_points
      FROM recharge_orders
      WHERE date(created_at) = ?`
    )
    .get(today) as any;

  // 按支付方式统计
  const paymentStats = db
    .prepare(
      `SELECT
        payment_method,
        COUNT(*) as count,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as amount_usd,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as amount_cny
      FROM recharge_orders
      WHERE status = 2
      GROUP BY payment_method`
    )
    .all() as any[];

  // 按日期统计最近7天
  const dailyStats = db
    .prepare(
      `SELECT
        date(created_at) as date,
        COUNT(*) as orders,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_usd ELSE 0 END), 0) as amount_usd,
        COALESCE(SUM(CASE WHEN status = 2 THEN amount_yuan ELSE 0 END), 0) as amount_cny
      FROM recharge_orders
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY date(created_at)
      ORDER BY date DESC`
    )
    .all() as any[];

  return c.json({
    success: true,
    data: {
      total: {
        orders: totalStats.total_orders || 0,
        amount_usd: totalStats.total_amount_usd || 0,
        amount_cny: totalStats.total_amount_cny || 0,
        points: totalStats.total_points || 0,
        bonus: totalStats.total_bonus || 0,
        success_count: totalStats.success_count || 0,
        failed_count: totalStats.failed_count || 0,
        pending_count: totalStats.pending_count || 0,
      },
      today: {
        orders: todayStats.today_orders || 0,
        amount_usd: todayStats.today_amount_usd || 0,
        amount_cny: todayStats.today_amount_cny || 0,
        points: todayStats.today_points || 0,
      },
      by_payment: {
        ALIPAY: paymentStats.find((p) => p.payment_method === "ALIPAY") || {
          count: 0,
          amount_usd: 0,
          amount_cny: 0,
        },
        WECHAT: paymentStats.find((p) => p.payment_method === "WECHAT") || {
          count: 0,
          amount_usd: 0,
          amount_cny: 0,
        },
      },
      daily: dailyStats,
    },
  });
});

// POST /recharge/orders/:orderNo/refund - Refund order
rechargeRoutes.post("/recharge/orders/:orderNo/refund", authMiddleware, adminMiddleware, async (c) => {
  const orderNo = c.req.param("orderNo");
  if (!orderNo) {
    return c.json({ success: false, msg: "订单号不能为空" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason || "用户申请退款";

  const adminUser = (await getAuthUser(c)) as any;
  const { rechargeService } = await import("../../services/RechargeService.js");

  const result = await rechargeService.refundOrder(orderNo, reason, adminUser.id);

  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }

  return c.json({
    success: true,
    msg: "退款成功",
    data: {
      refund_no: result.refund_no,
      refund_amount: result.refund_amount,
    },
  });
});

// GET /recharge/refund-calc/:orderNo - Calculate refund amount
rechargeRoutes.get("/recharge/refund-calc/:orderNo", authMiddleware, adminMiddleware, async (c) => {
  const orderNo = c.req.param("orderNo");
  if (!orderNo) {
    return c.json({ success: false, msg: "订单号不能为空" }, 400);
  }

  const { rechargeService } = await import("../../services/RechargeService.js");
  const calc = rechargeService.calculateRefund(orderNo);

  if (!calc.success) {
    return c.json({ success: false, msg: calc.error }, 400);
  }

  return c.json({
    success: true,
    data: {
      order_points: calc.orderPoints,
      user_balance: calc.userBalance,
      used_points: calc.usedPoints,
      refund_amount: calc.refundAmount,
      refund_amount_yuan: (calc.refundAmount / 100).toFixed(2),
      deduct_points: calc.deductPoints,
      original_amount: calc.originalAmount,
      original_amount_yuan: (calc.originalAmount / 100).toFixed(2),
    },
  });
});

// POST /recharge/simulate-payment/:orderNo - Simulate payment success (test mode only)
rechargeRoutes.post("/recharge/simulate-payment/:orderNo", authMiddleware, adminMiddleware, async (c) => {
  const orderNo = c.req.param("orderNo");
  if (!orderNo) {
    return c.json({ success: false, msg: "订单号不能为空" }, 400);
  }

  const { rechargeService } = await import("../../services/RechargeService.js");
  const result = await rechargeService.simulatePaymentSuccess(orderNo);

  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }

  return c.json({
    success: true,
    msg: "模拟支付成功",
    data: { order_no: result.order_no },
  });
});

// GET /recharge-records - Get all recharge records (client + admin)
rechargeRoutes.get("/recharge-records", authMiddleware, adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const pageSize = parseInt(c.req.query("pageSize") || "20");
  const offset = (page - 1) * pageSize;

  // Filter parameters
  const keyword = c.req.query("keyword")?.trim().substring(0, 50);
  const type = c.req.query("type");
  const paymentMethod = c.req.query("payment_method");

  // Client recharge records (from recharge_records via recharge_orders)
  let clientQuery = `
    SELECT
      rr.id,
      'CLIENT' as type,
      ro.order_no,
      u.phone as user_phone,
      u.nickname as user_nickname,
      rr.balance_delta as points,
      rr.quota_delta as quota,
      ro.amount_yuan as amount_cny,
      ro.payment_method,
      ro.created_at,
      rr.created_at as processed_at
    FROM recharge_records rr
    JOIN recharge_orders ro ON rr.order_id = ro.id
    LEFT JOIN users u ON rr.user_id = u.id
    WHERE ro.status = 2
  `;
  const clientParams: any[] = [];

  if (keyword) {
    clientQuery += " AND (u.phone LIKE ? OR u.nickname LIKE ?)";
    clientParams.push(`%${keyword}%`, `%${keyword}%`);
  }

  if (paymentMethod) {
    clientQuery += " AND ro.payment_method = ?";
    clientParams.push(paymentMethod);
  }

  clientQuery += " ORDER BY rr.created_at DESC";

  const clientRecords = db.prepare(clientQuery).all(...clientParams) as any[];

  // Admin recharge records
  let adminQuery = `
    SELECT
      arr.id,
      'ADMIN' as type,
      NULL as order_no,
      u.phone as user_phone,
      u.nickname as user_nickname,
      arr.points,
      arr.quota,
      NULL as amount_cny,
      NULL as payment_method,
      arr.created_at,
      arr.created_at as processed_at,
      a.nickname as admin_nickname,
      arr.reason,
      arr.payment_reference
    FROM admin_recharge_records arr
    LEFT JOIN users u ON arr.user_id = u.id
    LEFT JOIN users a ON arr.admin_id = a.id
    WHERE 1=1
  `;
  const adminParams: any[] = [];

  if (keyword) {
    adminQuery += " AND (u.phone LIKE ? OR u.nickname LIKE ?)";
    adminParams.push(`%${keyword}%`, `%${keyword}%`);
  }

  adminQuery += " ORDER BY arr.created_at DESC";

  const adminRecords = db.prepare(adminQuery).all(...adminParams) as any[];

  // Filter by type if specified
  let allRecords: any[];
  if (type === "CLIENT") {
    allRecords = clientRecords;
  } else if (type === "ADMIN") {
    allRecords = adminRecords;
  } else {
    // Combine and sort by date (default behavior)
    allRecords = [...clientRecords, ...adminRecords].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  // Paginate
  const total = allRecords.length;
  const list = allRecords.slice(offset, offset + pageSize);

  // Format response
  const formattedList = list.map((r) => ({
    id: r.id,
    type: r.type,
    order_no: r.order_no,
    user_phone: r.user_phone,
    user_nickname: r.user_nickname,
    points: r.points,
    quota: r.quota,
    amount_cny: r.amount_cny,
    payment_method: r.payment_method,
    admin_nickname: r.admin_nickname || null,
    reason: r.reason || null,
    created_at: r.created_at,
  }));

  return c.json({
    success: true,
    data: {
      list: formattedList,
      total,
      page,
      pageSize,
    },
  });
});

export { rechargeRoutes };