/**
 * Recharge Service
 * Handles recharge business logic
 */

import { db } from "../db/index.js";
import { sudorouterService } from "./SudorouterService.js";
import { fuiouPayService } from "./FuiouPayService.js";
import type { CallbackPayload } from "./FuiouPayService.js";

// ==================== Type Definitions ====================

export interface RechargePackage {
  amount: number;       // 美元金额
  points: number;
  bonus: number;
  description: string;
}

export interface CreateOrderResult {
  success: boolean;
  order?: {
    order_no: string;
    amount_usd: number;
    amount_cny: number;
    points: number;
    quota: number;
    expired_at: string;
  };
  error?: string;
}

export interface PayOrderResult {
  success: boolean;
  qr_code_url?: string;
  order_info?: string;
  error?: string;
}

export interface CallbackResult {
  success: boolean;
  order_no?: string;
  error?: string;
}

// ==================== Recharge Packages ====================

export const RECHARGE_PACKAGES: RechargePackage[] = [
  { amount: 1, points: 1000, bonus: 0, description: "基础充值" },
  { amount: 5, points: 5000, bonus: 500, description: "充5送500积分" },
  { amount: 10, points: 10000, bonus: 1000, description: "充10送1000积分" },
  { amount: 20, points: 20000, bonus: 3000, description: "充20送3000积分" },
  { amount: 50, points: 50000, bonus: 10000, description: "充50送10000积分" },
];

// Points conversion: 1 元 = 1000 积分 (业务规则)
// 额度换算使用 sudorouterService.pointsToQuota() 方法保持一致

// ==================== RechargeService Class ====================

class RechargeService {
  /**
   * Get recharge packages list
   */
  getPackages(): RechargePackage[] {
    return RECHARGE_PACKAGES;
  }

  /**
   * Create recharge order
   */
  createOrder(
    userId: number,
    userPhone: string,
    enterpriseId: number | null,
    amountUsd: number,
    paymentMethod: "ALIPAY" | "WECHAT"
  ): CreateOrderResult {
    // Validate amount (美元)
    const minAmount = parseInt(process.env.RECHARGE_MIN_AMOUNT || "1");
    if (!amountUsd || amountUsd < minAmount || amountUsd > 10000) {
      return { success: false, error: `充值金额无效（${minAmount}-10000美元）` };
    }

    // Get exchange rate and calculate CNY amount
    const exchangeRate = parseFloat(process.env.USD_TO_CNY_RATE || "7.3");
    const amountCny = amountUsd * exchangeRate;
    const amountCents = Math.round(amountCny * 100);

    // Calculate points and quota
    // 1 美元 = 1000 积分
    const POINTS_PER_USD = 1000;
    const packageInfo = RECHARGE_PACKAGES.find((p) => p.amount === amountUsd);
    const bonusPoints = packageInfo?.bonus || 0;
    const basePoints = amountUsd * POINTS_PER_USD;
    const totalPoints = basePoints + bonusPoints;
    const totalQuota = sudorouterService.pointsToQuota(totalPoints);

    // Generate order number
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    const orderNo = `USR${userId}NO${Date.now()}${randomStr}`;
    const orderDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    // Expiration time (30 minutes)
    const expireMinutes = parseInt(process.env.RECHARGE_ORDER_EXPIRE_MINUTES || "30");
    const expiredAt = new Date(Date.now() + expireMinutes * 60 * 1000).toISOString();

    // Create order
    try {
      db.run(
        `INSERT INTO recharge_orders (
          order_no, user_id, user_phone, enterprise_id,
          amount_usd, amount_yuan, amount_cents, exchange_rate,
          quota_amount, points_amount, bonus_points,
          payment_method, order_date, status, expired_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          orderNo,
          userId,
          userPhone,
          enterpriseId,
          amountUsd,
          amountCny,
          amountCents,
          exchangeRate,
          totalQuota,
          totalPoints,
          bonusPoints,
          paymentMethod,
          orderDate,
          expiredAt,
        ]
      );

      return {
        success: true,
        order: {
          order_no: orderNo,
          amount_usd: amountUsd,
          amount_cny: amountCny,
          points: totalPoints,
          quota: totalQuota,
          expired_at: expiredAt,
        },
      };
    } catch (error: any) {
      console.error("[RechargeService] Failed to create order:", error);
      return { success: false, error: "创建订单失败" };
    }
  }

  /**
   * Pay order (get QR code)
   */
  async payOrder(userId: number, orderNo: string): Promise<PayOrderResult> {
    // Query order
    const order = db
      .prepare("SELECT * FROM recharge_orders WHERE order_no = ? AND user_id = ?")
      .get(orderNo, userId) as any;

    if (!order) {
      return { success: false, error: "订单不存在" };
    }

    if (order.status !== 0) {
      return { success: false, error: "订单状态无效" };
    }

    // Check expiration
    if (new Date(order.expired_at) < new Date()) {
      db.run("UPDATE recharge_orders SET status = 5 WHERE id = ?", [order.id]);
      return { success: false, error: "订单已过期" };
    }

    try {
      // Test environment: force 1 cent
      const isTest = fuiouPayService.isTestMode();
      const payCents = isTest ? 1 : order.amount_cents;

      console.log("[RechargeService] Creating Fuiou order:", {
        order_no: order.order_no,
        amount: payCents,
        isTest,
      });

      const result = await fuiouPayService.createOrder({
        orderId: order.order_no,
        orderDate: order.order_date,
        orderAmt: payCents.toString(),
        orderPayType: order.payment_method,
        goodsName: `TUC${order.amount_usd}USD`,
        goodsDetail: `充值${order.amount_usd}美元 (¥${order.amount_yuan.toFixed(2)})`,
      });

      console.log("[RechargeService] Fuiou createOrder result:", JSON.stringify(result));

      if (!result.success) {
        return { success: false, error: result.error || "支付请求失败" };
      }

      // Get QR code URL from response
      const qrCodeUrl = result.data?.orderInfo || "";
      const orderInfo = result.data?.orderInfo || "";

      if (!qrCodeUrl) {
        console.error("[RechargeService] No QR code URL in response:", result.data);
        return { success: false, error: "支付二维码获取失败" };
      }

      // Update order status to "paying"
      db.run(
        "UPDATE recharge_orders SET status = 1, fuiou_order_info = ? WHERE id = ?",
        [orderInfo, order.id]
      );

      return {
        success: true,
        qr_code_url: qrCodeUrl,
        order_info: orderInfo,
      };
    } catch (error: any) {
      console.error("[RechargeService] Fuiou payment failed:", error);
      return { success: false, error: error.message || "支付请求失败" };
    }
  }

  /**
   * Handle payment callback
   *
   * Security validation:
   * 1. Merchant code verification (in FuiouPayService)
   * 2. RSA decrypt verification (in FuiouPayService)
   * 3. Amount verification
   * 4. Concurrency safety (using transaction)
   */
  async handleCallback(payload: CallbackPayload): Promise<CallbackResult> {
    try {
      // 1. Verify and decrypt callback
      const callbackMessage = await fuiouPayService.handleCallback(payload);

      // 2. Query order
      const order = db
        .prepare("SELECT * FROM recharge_orders WHERE order_no = ?")
        .get(callbackMessage.orderId) as any;

      if (!order) {
        console.error(`[Recharge] Order not found: ${callbackMessage.orderId}`);
        return { success: false, error: "订单不存在" };
      }

      // 3. Use transaction (prevent concurrency)
      db.run("BEGIN EXCLUSIVE TRANSACTION");

      try {
        // Re-check order status (after row lock)
        const lockedOrder = db
          .prepare("SELECT * FROM recharge_orders WHERE id = ?")
          .get(order.id) as any;

        if (lockedOrder.status === 2) {
          db.run("ROLLBACK");
          return { success: true, order_no: order.order_no }; // Already processed
        }

        // 4. Verify amount
        const callbackAmount = parseInt(callbackMessage.orderAmt);
        const isTest = fuiouPayService.isTestMode();
        const expectedAmount = isTest ? 1 : lockedOrder.amount_cents;

        if (callbackAmount !== expectedAmount && !isTest) {
          console.error(
            `[Recharge] Amount mismatch: callback=${callbackAmount}, order=${expectedAmount}`
          );
          db.run("ROLLBACK");
          return { success: false, error: "金额不一致" };
        }

        // 5. Check payment status
        if (callbackMessage.orderSt === "2") {
          // Payment failed
          db.run(
            "UPDATE recharge_orders SET status = 3, callback_data = ?, callback_time = ? WHERE id = ?",
            [JSON.stringify(payload), new Date().toISOString(), lockedOrder.id]
          );
          db.run("COMMIT");
          return { success: true, order_no: order.order_no };
        }

        if (callbackMessage.orderSt !== "1") {
          console.log(`[Recharge] Unknown order status: ${callbackMessage.orderSt}`);
          db.run("ROLLBACK");
          return { success: true, order_no: order.order_no };
        }

        // 6. Payment success, process recharge
        const result = await this.processRecharge(lockedOrder, payload);

        if (result.success) {
          db.run("COMMIT");
        } else {
          db.run("ROLLBACK");
        }

        return result;
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    } catch (error: any) {
      console.error("[Recharge] Callback error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process recharge logic (internal method)
   */
  private async processRecharge(order: any, payload: CallbackPayload): Promise<CallbackResult> {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(order.user_id) as any;

    if (!user || !user.sudorouter_user_id) {
      console.error(`[Recharge] User not found or not bound to sudorouter`);
      db.run(
        "UPDATE recharge_orders SET status = 3, remark = '用户信息异常' WHERE id = ?",
        [order.id]
      );
      return { success: false, error: "用户信息异常" };
    }

    // Update sudorouter quota
    const quotaResult = await sudorouterService.updateUserQuotaWithLog(
      user.sudorouter_user_id,
      order.quota_amount,
      `充值订单: ${order.order_no}`
    );

    if (!quotaResult.success) {
      console.error(`[Recharge] Sudorouter update failed:`, quotaResult.error);
      db.run(
        "UPDATE recharge_orders SET status = 3, remark = ? WHERE id = ?",
        [quotaResult.error, order.id]
      );
      return { success: false, error: quotaResult.error };
    }

    // Record values before recharge
    const quotaBefore = user.quota || 0;
    const balanceBefore = user.balance || 0;
    const quotaAfter = quotaBefore + order.quota_amount;
    const balanceAfter = balanceBefore + order.points_amount;

    // Update user quota
    db.run("UPDATE users SET quota = ?, balance = ? WHERE id = ?", [
      quotaAfter,
      balanceAfter,
      user.id,
    ]);

    // Write recharge record
    db.run(
      `INSERT INTO recharge_records (
        order_id, user_id, quota_before, quota_after, quota_delta,
        balance_before, balance_after, balance_delta,
        sudorouter_user_id, sudorouter_success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        user.id,
        quotaBefore,
        quotaAfter,
        order.quota_amount,
        balanceBefore,
        balanceAfter,
        order.points_amount,
        user.sudorouter_user_id,
        true,
      ]
    );

    // Write ledger - base points
    const basePoints = order.points_amount - order.bonus_points;
    db.run(
      "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
      [
        user.id,
        basePoints,
        "RECHARGE",
        `充值订单: ${order.order_no}, 金额: $${order.amount_usd}`,
      ]
    );

    // Write ledger - bonus points if any
    if (order.bonus_points > 0) {
      db.run(
        "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
        [
          user.id,
          order.bonus_points,
          "BONUS",
          `充值赠送: 订单 ${order.order_no}, 充值$${order.amount_usd}赠送`,
        ]
      );
    }

    // Update order status to success
    db.run(
      `UPDATE recharge_orders
       SET status = 2, callback_data = ?, callback_time = ?,
           callback_amount_cents = ?, updated_at = ?
       WHERE id = ?`,
      [
        JSON.stringify(payload),
        new Date().toISOString(),
        parseInt(payload.message || "0"),
        new Date().toISOString(),
        order.id,
      ]
    );

    // Write operation log
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.phone,
        "RECHARGE_SUCCESS",
        "recharge_order",
        order.id,
        "CALLBACK",
        "/api/v1/recharge/callback",
        JSON.stringify({
          order_no: order.order_no,
          amount_usd: order.amount_usd,
          amount_cny: order.amount_yuan,
          quota: order.quota_amount,
        }),
        JSON.stringify({ success: true, quota_after: quotaAfter, balance_after: balanceAfter }),
      ]
    );

    console.log(
      `[Recharge] Success: user=${user.phone}, amount=$${order.amount_usd} (¥${order.amount_yuan.toFixed(2)}), points=+${basePoints}, bonus=+${order.bonus_points}`
    );

    return { success: true, order_no: order.order_no };
  }

  /**
   * Query order status
   */
  queryOrder(userId: number, orderNo: string): any {
    const order = db
      .prepare("SELECT * FROM recharge_orders WHERE order_no = ? AND user_id = ?")
      .get(orderNo, userId) as any;

    if (!order) {
      return null;
    }

    const statusText = ["待支付", "支付中", "支付成功", "支付失败", "已退款", "已取消"];

    return {
      order_no: order.order_no,
      amount_usd: order.amount_usd,
      amount_cny: order.amount_yuan,
      exchange_rate: order.exchange_rate,
      points: order.points_amount,
      status: order.status,
      status_text: statusText[order.status] || "未知",
      payment_method: order.payment_method,
      created_at: order.created_at,
      expired_at: order.expired_at,
    };
  }

  /**
   * Get user recharge list
   */
  getOrderList(userId: number, page: number = 1, pageSize: number = 20): any {
    const offset = (page - 1) * pageSize;

    const orders = db
      .prepare(
        `SELECT * FROM recharge_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(userId, pageSize, offset) as any[];

    const total = db
      .prepare("SELECT COUNT(*) as count FROM recharge_orders WHERE user_id = ?")
      .get(userId) as any;

    const statusText = ["待支付", "支付中", "支付成功", "支付失败", "已退款", "已取消"];

    return {
      list: orders.map((o) => ({
        order_no: o.order_no,
        amount_usd: o.amount_usd,
        amount_cny: o.amount_yuan,
        exchange_rate: o.exchange_rate,
        points: o.points_amount,
        status: o.status,
        status_text: statusText[o.status] || "未知",
        payment_method: o.payment_method,
        created_at: o.created_at,
      })),
      total: total.count,
      page,
      pageSize,
    };
  }

  /**
   * Cancel order
   */
  cancelOrder(userId: number, orderNo: string): { success: boolean; error?: string } {
    const order = db
      .prepare("SELECT * FROM recharge_orders WHERE order_no = ? AND user_id = ?")
      .get(orderNo, userId) as any;

    if (!order) {
      return { success: false, error: "订单不存在" };
    }

    if (order.status !== 0 && order.status !== 1) {
      return { success: false, error: "订单状态不可取消" };
    }

    db.run("UPDATE recharge_orders SET status = 5 WHERE id = ?", [order.id]);

    return { success: true };
  }

  /**
   * Retry failed order (admin)
   */
  async retryFailedOrder(orderId: number, adminId: number): Promise<{ success: boolean; error?: string }> {
    const order = db
      .prepare("SELECT * FROM recharge_orders WHERE id = ?")
      .get(orderId) as any;

    if (!order) {
      return { success: false, error: "订单不存在" };
    }

    if (order.status !== 3) {
      return { success: false, error: "只能重试失败的订单" };
    }

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(order.user_id) as any;

    if (!user || !user.sudorouter_user_id) {
      return { success: false, error: "用户信息异常" };
    }

    // Begin transaction
    db.run("BEGIN EXCLUSIVE TRANSACTION");

    try {
      // Update sudorouter quota
      const quotaResult = await sudorouterService.updateUserQuotaWithLog(
        user.sudorouter_user_id,
        order.quota_amount,
        `充值订单重试: ${order.order_no}`
      );

      if (!quotaResult.success) {
        db.run("ROLLBACK");
        return { success: false, error: `Sudorouter 更新失败: ${quotaResult.error}` };
      }

      // Update order status
      db.run(
        "UPDATE recharge_orders SET status = 2, remark = '后台重试成功' WHERE id = ?",
        [orderId]
      );

      // Update user quota
      const newQuota = (user.quota || 0) + order.quota_amount;
      const newBalance = user.balance + order.points_amount;

      db.run("UPDATE users SET quota = ?, balance = ? WHERE id = ?", [
        newQuota,
        newBalance,
        user.id,
      ]);

      // Write recharge record
      db.run(
        `INSERT INTO recharge_records (
          order_id, user_id, quota_before, quota_after, quota_delta,
          balance_before, balance_after, balance_delta,
          sudorouter_user_id, sudorouter_success
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          user.id,
          user.quota,
          newQuota,
          order.quota_amount,
          user.balance,
          newBalance,
          order.points_amount,
          user.sudorouter_user_id,
          true,
        ]
      );

      // Write ledger
      const basePoints = order.points_amount - order.bonus_points;
      db.run(
        "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
        [user.id, basePoints, "RECHARGE", `充值订单重试: ${order.order_no}`]
      );

      if (order.bonus_points > 0) {
        db.run(
          "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
          [user.id, order.bonus_points, "BONUS", `充值赠送(重试): ${order.order_no}`]
        );
      }

      // Write operation log
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminId,
          "",
          "RECHARGE_RETRY",
          "recharge_order",
          orderId,
          "POST",
          `/api/v1/admin/recharge/orders/${orderId}/retry`,
          JSON.stringify({ order_no: order.order_no }),
          JSON.stringify({ success: true, newBalance, newQuota }),
        ]
      );

      db.run("COMMIT");

      return { success: true };
    } catch (error) {
      db.run("ROLLBACK");
      return { success: false, error: "订单重试失败" };
    }
  }
}

// Export singleton
export const rechargeService = new RechargeService();