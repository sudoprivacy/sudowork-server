/**
 * User routes
 */

import { Hono } from "hono";
import { db } from "../db/index.js";
import { sudorouterService } from "../services/SudorouterService.js";
import { getAuthUser } from "../middleware/auth.js";

const userRoutes = new Hono();

// GET /api/v1/user/profile - Get user profile
userRoutes.get("/profile", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare(
      "SELECT u.*, e.code as enterprise_code FROM users u JOIN enterprises e ON u.enterprise_id = e.id WHERE u.id = ?",
    )
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 直接从本地数据库读取额度信息
  const quota = user.quota || 0;
  const usedQuota = user.used_quota || 0;
  const remainingPoints = sudorouterService.quotaToPoints(quota);
  const usedPoints = sudorouterService.quotaToPoints(usedQuota);

  // 从 ledger 表查询实际获得的赠送积分（而非动态计算）
  const bonusResult = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE user_id = ? AND type = 'BONUS'")
    .get(user.id) as any;
  const bonusPoints = bonusResult?.total || 0;

  return c.json({
    success: true,
    data: {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      role: user.role,
      status: user.status,
      enterprise_id: user.enterprise_id,
      enterprise_code: user.enterprise_code,
      // 积分信息
      bonus_points: bonusPoints,
      remaining_points: remainingPoints,
      used_points: usedPoints,
      // 原始额度信息
      quota: quota,
      used_quota: usedQuota,
    },
  });
});

// 用户中心合并接口 - 一次性返回积分、今日统计和使用流水
userRoutes.get("/dashboard", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 默认积分数据
  let totalPoints = 0;
  let usedPoints = 0;
  let remainingPoints = 0;

  // 从 ledger 表查询实际获得的赠送积分
  const bonusResult = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE user_id = ? AND type = 'BONUS'")
    .get(user.id) as any;
  const bonusPoints = bonusResult?.total || 0;

  // 今日使用统计
  let todayTokens = 0;
  let todayCostPoints = 0;
  let todayRequests = 0;

  // 使用流水
  let usageLogs: any[] = [];
  let totalLogs = 0;

  // 从 sudorouter 获取数据
  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    // 并行调用：获取用户信息 + 获取使用日志
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const now = Math.floor(Date.now() / 1000);
    const monthAgo = now - 30 * 24 * 60 * 60;

    const [getUserResult, logsResult] = await Promise.all([
      sudorouterService.getUserWithLog(user.sudorouter_user_id),
      sudorouterService.getUsageLogs(user.sudorouter_user_id, monthAgo, now, 1, 100),
    ]);

    // 处理用户信息
    if (getUserResult.success && getUserResult.data) {
      const sudorouterUser = getUserResult.data;
      totalPoints = sudorouterService.quotaToPoints(
        (sudorouterUser.quota || 0) + (sudorouterUser.used_quota || 0),
      );
      usedPoints = sudorouterService.quotaToPoints(
        sudorouterUser.used_quota || 0,
      );
      remainingPoints = sudorouterService.quotaToPoints(
        sudorouterUser.quota || 0,
      );

      // 更新本地数据库
      db.run(
        "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
        [
          sudorouterUser.quota,
          sudorouterUser.used_quota,
          remainingPoints,
          user.id,
        ],
      );

      // 记录 API 调用日志
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.phone,
          "SUDOROUTER_GET_USER",
          "sudorouter_api",
          user.sudorouter_user_id,
          "GET",
          getUserResult.request.url,
          JSON.stringify({ user_id: user.sudorouter_user_id }),
          JSON.stringify({
            success: true,
            quota: sudorouterUser.quota,
            used_quota: sudorouterUser.used_quota,
          }),
          getUserResult.response.status,
          getUserResult.duration_ms,
        ],
      );
    }

    // 处理使用日志（过滤掉 manage 类型和空模型名的记录）
    if (logsResult && logsResult.data) {
      // 过滤有效的使用记录（与今日统计过滤条件一致）
      const validLogs = logsResult.data.data.filter(
        (log: any) => log.type !== "manage" && log.model_name,
      );

      totalLogs = validLogs.length;
      usageLogs = validLogs.map((log: any) => ({
        id: log.id,
        model: log.model_name,
        timestamp: new Date(log.created_at * 1000).toISOString(),
        prompt_tokens: log.prompt_tokens || 0,
        completion_tokens: log.completion_tokens || 0,
        created_at: log.created_at,
      }));

      // 计算今日统计（从同一份数据中计算，避免重复调用）
      for (const log of validLogs) {
        if (log.created_at >= todayStart) {
          todayRequests += 1;
          todayTokens +=
            (log.prompt_tokens || 0) + (log.completion_tokens || 0);
          todayCostPoints += sudorouterService.quotaToPoints(log.quota || 0);
        }
      }

      // 记录 API 调用日志
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.phone,
          "SUDOROUTER_GET_USAGE_LOGS",
          "sudorouter_api",
          user.sudorouter_user_id,
          "GET",
          "/api/log/",
          JSON.stringify({
            user_id: user.sudorouter_user_id,
            time_from: monthAgo,
            time_to: now,
          }),
          JSON.stringify({ success: true, count: totalLogs }),
        ],
      );
    }
  }

  return c.json({
    success: true,
    data: {
      points: {
        total: totalPoints,
        used: usedPoints,
        remaining: remainingPoints,
        bonus: bonusPoints,
      },
      usage_today: {
        tokens: todayTokens,
        cost_points: Math.round(todayCostPoints * 1000) / 1000,
        requests: todayRequests,
      },
      ledger: {
        list: usageLogs,
        total: totalLogs,
      },
    },
  });
});

// GET /api/v1/user/ledger - Get user ledger
userRoutes.get("/ledger", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 时间范围参数
  const timeFrom = c.req.query("time_from");
  const timeTo = c.req.query("time_to");

  // 如果有 sudorouter 用户ID，从 sudorouter 获取使用日志
  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    const from = timeFrom
      ? parseInt(timeFrom)
      : Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const to = timeTo ? parseInt(timeTo) : Math.floor(Date.now() / 1000);

    const logs = await sudorouterService.getUsageLogs(
      user.sudorouter_user_id,
      from,
      to,
      1,
      100,
    );

    // 记录 Sudorouter API 调用日志
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.phone,
        "SUDOROUTER_GET_USAGE_LOGS",
        "sudorouter_api",
        user.sudorouter_user_id,
        "GET",
        "/api/log/",
        JSON.stringify({
          user_id: user.sudorouter_user_id,
          time_from: from,
          time_to: to,
          page_size: 100,
        }),
        JSON.stringify({ success: !!logs, count: logs?.data?.count || 0 }),
      ],
    );

    if (logs && logs.data) {
      const formattedLogs = logs.data.data.map((log: any) => ({
        id: log.id,
        user_id: user.id,
        amount: -sudorouterService.quotaToPoints(log.quota || 0),
        type: "CONSUME",
        memo: `${log.model_name || "unknown"} (${log.prompt_tokens || 0}+${log.completion_tokens || 0} tokens)`,
        timestamp: new Date(log.created_at * 1000).toISOString(),
        model: log.model_name,
        prompt_tokens: log.prompt_tokens,
        completion_tokens: log.completion_tokens,
        quota: log.quota,
      }));

      return c.json({
        success: true,
        data: formattedLogs,
        total: logs.data.count,
      });
    }
  }

  // 回退到本地流水
  const allLogs = db
    .prepare(
      "SELECT * FROM ledger WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20",
    )
    .all(payload.id);
  return c.json({ success: true, data: allLogs });
});

// GET /api/v1/user/stats - Get user statistics
userRoutes.get("/stats", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 默认积分数据
  let totalPoints = 0;
  let usedPoints = 0;
  let remainingPoints = 0;

  // 从 ledger 表查询实际获得的赠送积分
  const bonusResult = db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE user_id = ? AND type = 'BONUS'")
    .get(user.id) as any;
  const bonusPoints = bonusResult?.total || 0;

  // 今日使用统计
  let todayTokens = 0;
  let todayCostPoints = 0;
  let todayRequests = 0;

  // 从 sudorouter 获取用户信息
  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    const getUserResult = await sudorouterService.getUserWithLog(
      user.sudorouter_user_id,
    );
    if (getUserResult.success && getUserResult.data) {
      const sudorouterUser = getUserResult.data;
      totalPoints = sudorouterService.quotaToPoints(
        (sudorouterUser.quota || 0) + (sudorouterUser.used_quota || 0),
      );
      usedPoints = sudorouterService.quotaToPoints(
        sudorouterUser.used_quota || 0,
      );
      remainingPoints = sudorouterService.quotaToPoints(
        sudorouterUser.quota || 0,
      );

      // 更新本地数据库
      db.run(
        "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
        [
          sudorouterUser.quota,
          sudorouterUser.used_quota,
          remainingPoints,
          user.id,
        ],
      );

      // 记录 Sudorouter API 调用日志
      db.run(
        `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data, response_status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.phone,
          "SUDOROUTER_GET_USER",
          "sudorouter_api",
          user.sudorouter_user_id,
          "GET",
          getUserResult.request.url,
          JSON.stringify({ user_id: user.sudorouter_user_id }),
          JSON.stringify({
            success: true,
            quota: sudorouterUser.quota,
            used_quota: sudorouterUser.used_quota,
          }),
          getUserResult.response.status,
          getUserResult.duration_ms,
        ],
      );
    }

    // 获取今日使用日志
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const now = Math.floor(Date.now() / 1000);

    const todayLogs = await sudorouterService.getUsageLogs(
      user.sudorouter_user_id,
      todayStart,
      now,
      1,
      1000,
    );

    // 记录获取使用日志的 API 调用
    db.run(
      `INSERT INTO operation_logs (user_id, user_phone, action, resource, resource_id, method, path, request_data, response_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.phone,
        "SUDOROUTER_GET_USAGE_LOGS",
        "sudorouter_api",
        user.sudorouter_user_id,
        "GET",
        "/api/log/",
        JSON.stringify({
          user_id: user.sudorouter_user_id,
          time_from: todayStart,
          time_to: now,
        }),
        JSON.stringify({
          success: !!todayLogs,
          count: todayLogs?.data?.count || 0,
        }),
      ],
    );

    if (todayLogs && todayLogs.data && todayLogs.data.data) {
      for (const log of todayLogs.data.data) {
        // 只统计模型使用记录，排除管理操作(manage)类型的日志
        if (log.type !== "manage" && log.model_name) {
          todayRequests += 1;
          todayTokens += (log.prompt_tokens || 0) + (log.completion_tokens || 0);
          todayCostPoints += sudorouterService.quotaToPoints(log.quota || 0);
        }
      }
    }
  }

  return c.json({
    success: true,
    data: {
      points: {
        total: totalPoints,
        used: usedPoints,
        remaining: remainingPoints,
        bonus: bonusPoints,
      },
      usage_today: {
        tokens: todayTokens,
        cost_points: Math.round(todayCostPoints * 1000) / 1000,
        requests: todayRequests,
      },
    },
  });
});

// POST /api/v1/user/update-profile - Update user profile
userRoutes.post("/update-profile", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id) {
    return c.json({ success: false, msg: "未授权" }, 401);
  }

  const { nickname } = await c.req.json();
  if (!nickname || nickname.trim().length === 0) {
    return c.json({ success: false, msg: "昵称不能为空" }, 400);
  }

  // 更新昵称
  db.run("UPDATE users SET nickname = ? WHERE id = ?", [
    nickname.trim(),
    payload.id,
  ]);

  return c.json({ success: true, msg: "昵称已更新" });
});

export { userRoutes };