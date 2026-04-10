/**
 * Admin user management routes
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { sudorouterService } from '../../services/SudorouterService.js';
import { authMiddleware, adminMiddleware, getAuthUser } from '../../middleware/auth.js';
import { logOperation } from '../../utils/logger.js';
import type { User, UserWithEnterprise } from '../../types/index.js';

const usersRoutes = new Hono();

// GET /users - User list
usersRoutes.get('/users', authMiddleware, adminMiddleware, async (c) => {
  const enterpriseId = c.req.query('enterprise_id');
  const status = c.req.query('status');
  const role = c.req.query('role');
  const keyword = c.req.query('keyword')?.trim().substring(0, 50);

  let query = `
    SELECT u.*, e.name as enterprise_name, ic.code as invitation_code
    FROM users u
    LEFT JOIN enterprises e ON u.enterprise_id = e.id
    LEFT JOIN invitation_codes ic ON u.invitation_code_id = ic.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (enterpriseId) {
    query += ' AND u.enterprise_id = ?';
    params.push(enterpriseId);
  }

  if (status) {
    query += ' AND u.status = ?';
    params.push(parseInt(status));
  }

  if (role) {
    query += ' AND u.role = ?';
    params.push(role);
  }

  if (keyword) {
    query += ' AND (u.phone LIKE ? OR u.nickname LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  query += ' ORDER BY u.created_at DESC';

  const users = db.prepare(query).all(...params) as UserWithEnterprise[];

  return c.json({
    success: true,
    data: users,
  });
});

// POST /users - Create user
usersRoutes.post('/users', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;
  const { phone, nickname, enterprise_id, invitation_code_id } = await c.req.json();

  if (!phone || !enterprise_id) {
    return c.json(
      {
        success: false,
        msg: '手机号和所属企业不能为空',
      },
      400,
    );
  }

  if (!invitation_code_id) {
    return c.json(
      {
        success: false,
        msg: '请选择邀请码',
      },
      400,
    );
  }

  // Check if phone already exists
  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

  if (existing) {
    return c.json(
      {
        success: false,
        msg: '手机号已存在',
      },
      400,
    );
  }

  // Validate invitation code
  const invitationCode = db
    .prepare('SELECT * FROM invitation_codes WHERE id = ? AND status = 0')
    .get(invitation_code_id) as { id: number; code: string; enterprise_id: number; status: number } | undefined;

  if (!invitationCode) {
    return c.json(
      {
        success: false,
        msg: '邀请码不存在或已被使用',
      },
      400,
    );
  }

  if (invitationCode.enterprise_id !== parseInt(enterprise_id)) {
    return c.json(
      {
        success: false,
        msg: '邀请码不属于所选企业',
      },
      400,
    );
  }

  // Check sudorouter service configuration
  if (!sudorouterService.isConfigured()) {
    return c.json(
      {
        success: false,
        msg: '系统未完成配置，请联系管理员',
      },
      500,
    );
  }

  // Call sudorouter to create user
  const createUserResult = await sudorouterService.createUserWithLog(phone, nickname);
  if (!createUserResult.success || !createUserResult.data) {
    logOperation({
      userId: adminUser.id,
      userPhone: adminUser.phone,
      action: 'SUDOROUTER_CREATE_USER_FAILED',
      resource: 'sudorouter_user',
      method: createUserResult.request.method,
      path: createUserResult.request.url,
      requestData: createUserResult.request.body,
      responseData: createUserResult.response.data,
      responseStatus: createUserResult.response.status,
      durationMs: createUserResult.duration_ms,
      errorMessage: createUserResult.error || '创建用户失败',
    });
    return c.json(
      {
        success: false,
        msg: `创建 Sudorouter 用户失败: ${createUserResult.error || '未知错误'}`,
      },
      500,
    );
  }

  const sudorouterUser = createUserResult.data;

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'SUDOROUTER_CREATE_USER',
    resource: 'sudorouter_user',
    resourceId: sudorouterUser.id,
    method: createUserResult.request.method,
    path: createUserResult.request.url,
    requestData: createUserResult.request.body,
    responseData: createUserResult.response.data,
    responseStatus: createUserResult.response.status,
    durationMs: createUserResult.duration_ms,
  });

  // Call sudorouter to set initial quota
  const initialQuota = sudorouterService.getInitialQuota();
  const quotaResult = await sudorouterService.updateUserQuotaWithLog(
    sudorouterUser.id,
    initialQuota,
    '新用户注册赠送额度',
  );

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'SUDOROUTER_UPDATE_QUOTA',
    resource: 'sudorouter_quota',
    resourceId: sudorouterUser.id,
    method: quotaResult.request.method,
    path: quotaResult.request.url,
    requestData: quotaResult.request.body,
    responseData: quotaResult.response.data,
    responseStatus: quotaResult.response.status,
    durationMs: quotaResult.duration_ms,
    errorMessage: quotaResult.success ? undefined : quotaResult.error,
  });

  if (!quotaResult.success) {
    console.error(`[Admin] 用户 ${phone} 额度充值失败`);
  }

  // Call sudorouter to create unlimited token
  const createTokenResult = await sudorouterService.createTokenWithLog(
    sudorouterUser.id,
    phone,
    true, // unlimited_quota
  );

  if (!createTokenResult.success || !createTokenResult.data) {
    logOperation({
      userId: adminUser.id,
      userPhone: adminUser.phone,
      action: 'SUDOROUTER_CREATE_TOKEN_FAILED',
      resource: 'sudorouter_token',
      method: createTokenResult.request.method,
      path: createTokenResult.request.url,
      requestData: createTokenResult.request.body,
      responseData: createTokenResult.response.data,
      responseStatus: createTokenResult.response.status,
      durationMs: createTokenResult.duration_ms,
      errorMessage: createTokenResult.error || '创建令牌失败',
    });
    return c.json(
      {
        success: false,
        msg: `创建 Sudorouter 令牌失败: ${createTokenResult.error || '未知错误'}`,
      },
      500,
    );
  }

  const sudorouterKey = createTokenResult.data;

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'SUDOROUTER_CREATE_TOKEN',
    resource: 'sudorouter_token',
    resourceId: sudorouterUser.id,
    method: createTokenResult.request.method,
    path: createTokenResult.request.url,
    requestData: createTokenResult.request.body,
    responseData: { success: true, key_preview: sudorouterKey.substring(0, 20) + '...' },
    responseStatus: createTokenResult.response.status,
    durationMs: createTokenResult.duration_ms,
  });

  // Calculate initial points
  const initialBalance = sudorouterService.quotaToPoints(initialQuota);

  // Create local user
  const result = db.run(
    `INSERT INTO users (
      phone, nickname, enterprise_id, role, status,
      sudorouter_user_id, sudorouter_key, invitation_code_id,
      quota, used_quota, balance, password_hash
    ) VALUES (?, ?, ?, 'USER', 1, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      phone,
      nickname || phone,
      enterprise_id,
      sudorouterUser.id,
      sudorouterKey,
      invitation_code_id,
      initialQuota,
      0,
      initialBalance,
    ],
  );

  const newUserId = result.lastInsertRowid;

  // Mark invitation code as used
  db.run(
    "UPDATE invitation_codes SET status = 1, used_by_user_id = ?, used_at = datetime('now') WHERE id = ?",
    [newUserId, invitation_code_id],
  );

  // Create initial points ledger entry
  db.run(
    "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
    [newUserId, initialBalance, 'BONUS', '新用户注册赠送'],
  );

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'USER_CREATE',
    resource: 'user',
    resourceId: newUserId,
    method: 'POST',
    path: '/api/v1/admin/users',
    requestData: { phone, nickname, enterprise_id, invitation_code_id },
    responseData: {
      id: newUserId,
      phone,
      sudorouter_user_id: sudorouterUser.id,
      initial_points: initialBalance,
      quota: initialQuota,
    },
  });

  return c.json({
    success: true,
    msg: '用户创建成功',
    data: {
      id: newUserId,
      phone,
      sudorouter_user_id: sudorouterUser.id,
      initial_points: initialBalance,
    },
  });
});

// PUT /users/:id - Update user
usersRoutes.put('/users/:id', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;
  const id = c.req.param('id');
  const { nickname, status, enterprise_id } = await c.req.json();

  // Get user info before update
  const oldUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;

  db.run(
    `UPDATE users SET nickname = COALESCE(?, nickname),
      status = COALESCE(?, status), enterprise_id = COALESCE(?, enterprise_id)
   WHERE id = ?`,
    [nickname, status, enterprise_id, id],
  );

  // Get user info after update
  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'USER_UPDATE',
    resource: 'user',
    resourceId: parseInt(id),
    method: 'PUT',
    path: `/api/v1/admin/users/${id}`,
    requestData: { nickname, status, enterprise_id },
    responseData: {
      before: {
        nickname: oldUser?.nickname,
        status: oldUser?.status,
        enterprise_id: oldUser?.enterprise_id,
      },
      after: {
        nickname: newUser?.nickname,
        status: newUser?.status,
        enterprise_id: newUser?.enterprise_id,
      },
    },
  });

  return c.json({
    success: true,
    msg: '用户信息更新成功',
  });
});

// POST /users/:id/role - Set user role
usersRoutes.post('/users/:id/role', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const { role } = await c.req.json();

  if (!['USER', 'ENTERPRISE_ADMIN'].includes(role)) {
    return c.json(
      {
        success: false,
        msg: '无效的角色',
      },
      400,
    );
  }

  db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);

  return c.json({
    success: true,
    msg: '角色更新成功',
  });
});

// POST /users/:id/manage - Enable/Disable user
usersRoutes.post('/users/:id/manage', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;
  const id = c.req.param('id');
  const { action } = await c.req.json(); // action: 'enable' or 'disable'

  if (!['enable', 'disable'].includes(action)) {
    return c.json(
      {
        success: false,
        msg: '无效的操作，请使用 enable 或 disable',
      },
      400,
    );
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;

  if (!user) {
    return c.json({ success: false, msg: '用户不存在' }, 404);
  }

  // Cannot disable super admin
  if (user.role === 'SUPER_ADMIN') {
    return c.json({ success: false, msg: '不能禁用超级管理员' }, 403);
  }

  // Call sudorouter management API
  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    const result = await sudorouterService.manageUser(user.sudorouter_user_id, action);

    if (!result.success) {
      return c.json(
        { success: false, msg: result.message || 'Sudorouter 操作失败' },
        500,
      );
    }
  }

  // Update local user status
  // status: 1=正常, 2=禁用
  const newStatus = action === 'enable' ? 1 : 2;
  db.run('UPDATE users SET status = ? WHERE id = ?', [newStatus, id]);

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: action === 'enable' ? 'USER_ENABLE' : 'USER_DISABLE',
    resource: 'user',
    resourceId: parseInt(id),
    method: 'POST',
    path: `/api/v1/admin/users/${id}/manage`,
    requestData: { action },
    responseData: {
      user_phone: user.phone,
      old_status: user.status,
      new_status: newStatus,
    },
  });

  return c.json({
    success: true,
    msg: action === 'enable' ? '用户已启用' : '用户已禁用',
    data: { status: newStatus },
  });
});

// DELETE /users/:id - Delete user
usersRoutes.delete('/users/:id', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;
  const id = c.req.param('id');

  // Check if user is admin
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;

  if (user?.role === 'SUPER_ADMIN') {
    return c.json(
      {
        success: false,
        msg: '不能删除超级管理员',
      },
      403,
    );
  }

  // Log operation with deleted user details
  if (user) {
    // Log invitation code deletion
    if (user.invitation_code_id) {
      const invitationCode = db
        .prepare('SELECT * FROM invitation_codes WHERE id = ?')
        .get(user.invitation_code_id) as { code: string; enterprise_id: number } | undefined;

      logOperation({
        userId: adminUser.id,
        userPhone: adminUser.phone,
        action: 'INVITATION_CODE_DELETE',
        resource: 'invitation_code',
        resourceId: user.invitation_code_id,
        method: 'DELETE',
        path: `/api/v1/admin/invitation-codes/${user.invitation_code_id}`,
        requestData: { deleted_with_user: id, user_phone: user.phone },
        responseData: {
          code: invitationCode?.code,
          enterprise_id: invitationCode?.enterprise_id,
        },
      });

      db.run('DELETE FROM invitation_codes WHERE id = ?', [user.invitation_code_id]);
      console.log(`[Admin] 删除用户 ${id} 的邀请码: ${user.invitation_code_id}`);
    }

    // Log user deletion
    logOperation({
      userId: adminUser.id,
      userPhone: adminUser.phone,
      action: 'USER_DELETE',
      resource: 'user',
      resourceId: parseInt(id),
      method: 'DELETE',
      path: `/api/v1/admin/users/${id}`,
      requestData: { target_user_id: id },
      responseData: {
        phone: user.phone,
        nickname: user.nickname,
        sudorouter_user_id: user.sudorouter_user_id,
        sudorouter_key: user.sudorouter_key ? user.sudorouter_key.substring(0, 20) + '...' : null,
        invitation_code_id: user.invitation_code_id,
        balance: user.balance,
      },
    });
  }

  // Delete user and ledger records
  db.run('DELETE FROM users WHERE id = ?', [id]);
  db.run('DELETE FROM ledger WHERE user_id = ?', [id]);

  return c.json({
    success: true,
    msg: '用户删除成功',
  });
});

// GET /users/:id/ledger - User ledger
usersRoutes.get('/users/:id/ledger', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '20');

  const ledger = db
    .prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(id, limit);

  return c.json({
    success: true,
    data: ledger,
  });
});

export { usersRoutes };