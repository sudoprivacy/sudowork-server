/**
 * Admin points management routes
 * Handles points adjustment, recharge, and quota sync
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { sudorouterService } from '../../services/SudorouterService.js';
import { authMiddleware, adminMiddleware, getAuthUser } from '../../middleware/auth.js';
import { logOperation } from '../../utils/logger.js';
import type { User } from '../../types/index.js';

const pointsRoutes = new Hono();

// POST /users/:id/points - Adjust user points
pointsRoutes.post('/users/:id/points', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;
  const id = c.req.param('id');
  const { amount, reason, operation, sync_sudorouter } = await c.req.json();

  if (!amount || amount <= 0) {
    return c.json(
      {
        success: false,
        msg: '积分数量必须大于 0',
      },
      400,
    );
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;

  if (!user) {
    return c.json({ success: false, msg: '用户不存在' }, 404);
  }

  const actualAmount = operation === 'subtract' ? -amount : amount;
  const newBalance = user.balance + actualAmount;

  if (newBalance < 0) {
    return c.json(
      {
        success: false,
        msg: '积分不足',
      },
      400,
    );
  }

  // Calculate quota change
  const quotaDelta = sudorouterService.pointsToQuota(Math.abs(actualAmount));

  // Start transaction
  db.run('BEGIN EXCLUSIVE TRANSACTION');

  try {
    // 1. Sync sudorouter if user is bound and sync is requested
    let sudorouterSuccess = true;
    let sudorouterError: string | null = null;

    if (
      user.sudorouter_user_id &&
      sync_sudorouter !== false &&
      sudorouterService.isConfigured()
    ) {
      const quotaResult = await sudorouterService.updateUserQuotaWithLog(
        user.sudorouter_user_id,
        operation === 'subtract' ? -quotaDelta : quotaDelta,
        reason || `管理员${operation === 'subtract' ? '扣减' : '充值'}积分`,
      );

      sudorouterSuccess = quotaResult.success;
      sudorouterError = quotaResult.error || null;

      // Log sudorouter API call
      logOperation({
        userId: adminUser.id,
        userPhone: adminUser.phone,
        action: 'SUDOROUTER_QUOTA_UPDATE',
        resource: 'sudorouter_quota',
        resourceId: user.sudorouter_user_id,
        method: quotaResult.request.method,
        path: quotaResult.request.url,
        requestData: quotaResult.request.body,
        responseData: quotaResult.response.data,
        responseStatus: quotaResult.response.status,
        durationMs: quotaResult.duration_ms,
        errorMessage: sudorouterSuccess ? undefined : sudorouterError,
      });
    }

    // 2. Update local user data
    const newQuota =
      operation === 'subtract'
        ? Math.max(0, (user.quota || 0) - quotaDelta)
        : (user.quota || 0) + quotaDelta;

    db.run('UPDATE users SET balance = ?, quota = ? WHERE id = ?', [
      newBalance,
      newQuota,
      id,
    ]);

    // 3. Write ledger record
    const ledgerType =
      operation === 'subtract'
        ? user.sudorouter_user_id && !sudorouterSuccess
          ? 'ADMIN_DEDUCT_PENDING'
          : 'CONSUME'
        : user.sudorouter_user_id && !sudorouterSuccess
          ? 'ADMIN_RECHARGE_PENDING'
          : 'BONUS';

    db.run(
      'INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)',
      [id, actualAmount, ledgerType, reason || `管理员${operation === 'subtract' ? '扣减' : '充值'}`],
    );

    // 4. Log operation
    logOperation({
      userId: adminUser.id,
      userPhone: adminUser.phone,
      action: 'ADMIN_POINTS_ADJUST',
      resource: 'user',
      resourceId: parseInt(id),
      method: 'POST',
      path: `/api/v1/admin/users/${id}/points`,
      requestData: { amount, operation, reason },
      responseData: { newBalance, newQuota, sudorouterSynced: sudorouterSuccess },
    });

    db.run('COMMIT');

    return c.json({
      success: true,
      msg: sudorouterSuccess
        ? '积分调整成功'
        : '积分调整成功，但 sudorouter 同步失败，请检查',
      data: {
        newBalance,
        newQuota,
        amount: actualAmount,
        sudorouter_synced: sudorouterSuccess,
        sudorouter_error: sudorouterError,
      },
    });
  } catch (error) {
    db.run('ROLLBACK');
    console.error('[Admin] Points adjustment failed:', error);
    return c.json(
      {
        success: false,
        msg: '积分调整失败',
      },
      500,
    );
  }
});

// POST /users/:id/recharge - Admin recharge (SUPER_ADMIN only)
pointsRoutes.post('/users/:id/recharge', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;

  // Only SUPER_ADMIN can recharge users
  if (adminUser.role !== 'SUPER_ADMIN') {
    return c.json(
      {
        success: false,
        msg: '只有超级管理员可以为用户充值',
      },
      403,
    );
  }

  const id = c.req.param('id');
  const { points, reason, payment_reference } = await c.req.json();

  // Validate
  if (!points || points <= 0) {
    return c.json({ success: false, msg: '充值积分必须大于 0' }, 400);
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  if (!user) {
    return c.json({ success: false, msg: '用户不存在' }, 404);
  }

  if (!user.sudorouter_user_id) {
    return c.json({ success: false, msg: '用户未绑定 sudorouter 账号' }, 400);
  }

  // Calculate quota
  const quotaDelta = sudorouterService.pointsToQuota(points);

  // Begin transaction
  db.run('BEGIN EXCLUSIVE TRANSACTION');

  try {
    // 1. Update sudorouter quota
    const quotaResult = await sudorouterService.updateUserQuotaWithLog(
      user.sudorouter_user_id,
      quotaDelta,
      reason || '后台充值',
    );

    if (!quotaResult.success) {
      db.run('ROLLBACK');
      return c.json(
        {
          success: false,
          msg: `sudorouter 额度更新失败: ${quotaResult.error}`,
        },
        500,
      );
    }

    // 2. Update local user data
    const newQuota = (user.quota || 0) + quotaDelta;
    const newBalance = user.balance + points;

    db.run('UPDATE users SET balance = ?, quota = ? WHERE id = ?', [
      newBalance,
      newQuota,
      id,
    ]);

    // 3. Write admin recharge record
    db.run(
      `INSERT INTO admin_recharge_records (
        user_id, admin_id, points, quota, reason,
        payment_reference, sudorouter_user_id, sudorouter_success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        adminUser.id,
        points,
        quotaDelta,
        reason,
        payment_reference,
        user.sudorouter_user_id,
        true,
      ],
    );

    // 4. Write ledger
    const ledgerType = reason === '活动赠送' ? 'BONUS' : 'ADMIN_RECHARGE';
    db.run(
      'INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)',
      [id, points, ledgerType, reason || '后台充值'],
    );

    // 5. Log operation
    logOperation({
      userId: adminUser.id,
      userPhone: adminUser.phone,
      action: 'ADMIN_RECHARGE',
      resource: 'user',
      resourceId: parseInt(id),
      method: 'POST',
      path: `/api/v1/admin/users/${id}/recharge`,
      requestData: { points, reason, payment_reference },
      responseData: { points, quota: quotaDelta, newBalance, newQuota },
    });

    db.run('COMMIT');

    return c.json({
      success: true,
      msg: '充值成功',
      data: { points, quota: quotaDelta, newBalance, newQuota },
    });
  } catch (error) {
    db.run('ROLLBACK');
    console.error('[Admin] Recharge failed:', error);
    return c.json({ success: false, msg: '充值失败' }, 500);
  }
});

// POST /users/:id/sync-quota - Sync user quota
pointsRoutes.post('/users/:id/sync-quota', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;
  const id = c.req.param('id');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  if (!user) {
    return c.json({ success: false, msg: '用户不存在' }, 404);
  }

  if (!user.sudorouter_user_id) {
    return c.json({ success: false, msg: '用户未绑定 sudorouter' }, 400);
  }

  // Get latest quota from sudorouter
  const sudorouterUser = await sudorouterService.getUser(user.sudorouter_user_id);
  if (!sudorouterUser) {
    return c.json(
      { success: false, msg: '获取 sudorouter 用户信息失败' },
      500,
    );
  }

  const quota = sudorouterUser.quota || 0;
  const usedQuota = sudorouterUser.used_quota || 0;
  const balance = sudorouterService.quotaToPoints(quota);

  // Update local data
  db.run(
    'UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?',
    [quota, usedQuota, balance, id],
  );

  // Log operation
  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'USER_SYNC_QUOTA',
    resource: 'user',
    resourceId: parseInt(id),
    method: 'POST',
    path: `/api/v1/admin/users/${id}/sync-quota`,
    requestData: { sudorouter_user_id: user.sudorouter_user_id },
    responseData: { quota, used_quota: usedQuota, balance },
  });

  return c.json({
    success: true,
    msg: '额度同步成功',
    data: {
      quota,
      used_quota: usedQuota,
      balance,
      total_points: sudorouterService.quotaToPoints(quota + usedQuota),
    },
  });
});

export { pointsRoutes };