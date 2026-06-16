/**
 * Admin user management routes — username+password login type (login_type=1).
 *
 * 独立于 src/routes/admin/users.ts(验证码方式),承载密码登录方式用户的新建/编辑。
 * - POST /users-password        密码新建(login_type=1)
 * - PUT  /users-password/:id    密码编辑(空密码保持不变/有值重置) + 跨方式校验
 *
 * 挂载:src/routes/admin/index.ts adminRoutes.route('/', usersPasswordRoutes)
 * → 解析为 /api/v1/admin/users-password
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { sudorouterService } from '../../services/SudorouterService.js';
import { authMiddleware, adminMiddleware, getAuthUser } from '../../middleware/auth.js';
import { logOperation } from '../../utils/logger.js';
import { hashPassword, validatePasswordStrength } from '../../utils/password.js';
import type { User } from '../../types/index.js';

const DEFAULT_PASSWORD = 'Temp@Sudo123';

const usersPasswordRoutes = new Hono();

// POST /users-password — 密码方式新建用户(login_type=1)
usersPasswordRoutes.post('/users-password', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;

  if (adminUser.role !== 'SUPER_ADMIN') {
    return c.json({ success: false, msg: '只有超级管理员可以创建用户' }, 403);
  }

  const { phone, nickname, password, enterprise_id, invitation_code_id } = await c.req.json();

  if (!phone || !enterprise_id) {
    return c.json({ success: false, msg: '用户名称和所属企业不能为空' }, 400);
  }
  if (!invitation_code_id) {
    return c.json({ success: false, msg: '请选择邀请码' }, 400);
  }

  // 密码强度校验(若提供)
  if (password) {
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return c.json({ success: false, msg: strength.message || '密码强度不足' }, 400);
    }
  }

  // 用户名称查重(phone 字段存用户名称)
  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return c.json({ success: false, msg: '用户名已存在' }, 400);
  }

  // 邀请码校验
  const invitationCode = db
    .prepare('SELECT * FROM invitation_codes WHERE id = ? AND status = 0')
    .get(invitation_code_id) as { id: number; code: string; enterprise_id: number; status: number } | undefined;
  if (!invitationCode) {
    return c.json({ success: false, msg: '邀请码不存在或已被使用' }, 400);
  }
  if (invitationCode.enterprise_id !== parseInt(enterprise_id)) {
    return c.json({ success: false, msg: '邀请码不属于所选企业' }, 400);
  }

  // sudorouter 配置检查
  if (!sudorouterService.isConfigured()) {
    return c.json({ success: false, msg: '系统未完成配置,请联系管理员' }, 500);
  }

  // sudorouter 建号(第一参数传用户名称,存于 phone 字段)
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
    return c.json({ success: false, msg: `创建 Sudorouter 用户失败: ${createUserResult.error || '未知错误'}` }, 500);
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

  // 初始额度
  const initialQuota = sudorouterService.getInitialQuota();
  const quotaResult = await sudorouterService.updateUserQuotaWithLog(sudorouterUser.id, initialQuota, '新用户注册赠送额度');
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

  // 创建 token(第二参数传用户名称)
  const createTokenResult = await sudorouterService.createTokenWithLog(sudorouterUser.id, phone, true);
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
    return c.json({ success: false, msg: `创建 Sudorouter 令牌失败: ${createTokenResult.error || '未知错误'}` }, 500);
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

  const initialBalance = sudorouterService.quotaToPoints(initialQuota);

  // 密码 hash(空则用默认密码)
  const passwordHash = await hashPassword(password || DEFAULT_PASSWORD);

  // 本地 INSERT(login_type=1)
  const result = db.run(
    `INSERT INTO users (
      phone, nickname, enterprise_id, role, status,
      sudorouter_user_id, sudorouter_key, invitation_code_id,
      quota, used_quota, balance, password_hash, login_type
    ) VALUES (?, ?, ?, 'USER', 1, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [phone, nickname || phone, enterprise_id, sudorouterUser.id, sudorouterKey, invitation_code_id, initialQuota, 0, initialBalance, passwordHash],
  );
  const newUserId = result.lastInsertRowid;

  // 标记邀请码已用
  db.run("UPDATE invitation_codes SET status = 1, used_by_user_id = ?, used_at = datetime('now') WHERE id = ?", [newUserId, invitation_code_id]);
  // 积分流水
  db.run("INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)", [newUserId, initialBalance, 'BONUS', '新用户注册赠送']);

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'USER_CREATE',
    resource: 'user',
    resourceId: newUserId,
    method: 'POST',
    path: '/api/v1/admin/users-password',
    requestData: { phone, nickname, enterprise_id, invitation_code_id, login_type: 1 },
    responseData: { id: newUserId, phone, sudorouter_user_id: sudorouterUser.id, initial_points: initialBalance, quota: initialQuota },
  });

  return c.json({
    success: true,
    msg: '用户创建成功',
    data: { id: newUserId, phone, sudorouter_user_id: sudorouterUser.id, initial_points: initialBalance },
  });
});

// PUT /users-password/:id — 密码方式编辑用户
usersPasswordRoutes.put('/users-password/:id', authMiddleware, adminMiddleware, async (c) => {
  const adminUser = (await getAuthUser(c)) as User;

  if (adminUser.role !== 'SUPER_ADMIN') {
    return c.json({ success: false, msg: '只有超级管理员可以编辑用户' }, 403);
  }

  const id = c.req.param('id');
  const { nickname, password, enterprise_id, status } = await c.req.json();

  const oldUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  if (!oldUser) {
    return c.json({ success: false, msg: '用户不存在' }, 404);
  }

  // 跨方式保护:非 SUPER_ADMIN 目标必须 login_type=1(密码方式)
  if (oldUser.role !== 'SUPER_ADMIN' && oldUser.login_type !== 1) {
    return c.json({ success: false, msg: '跨方式操作被拒绝:该用户不属于当前登录方式' }, 403);
  }

  // 密码:空则不变;有值则强度校验+重置
  let newPasswordHash: string | null = null;
  if (password) {
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return c.json({ success: false, msg: strength.message || '密码强度不足' }, 400);
    }
    newPasswordHash = await hashPassword(password);
  }

  // 更新(不动 login_type、不动 phone)
  if (newPasswordHash) {
    db.run(
      `UPDATE users SET nickname = COALESCE(?, nickname),
        status = COALESCE(?, status), enterprise_id = COALESCE(?, enterprise_id),
        password_hash = ?
       WHERE id = ?`,
      [nickname, status, enterprise_id, newPasswordHash, id],
    );
  } else {
    db.run(
      `UPDATE users SET nickname = COALESCE(?, nickname),
        status = COALESCE(?, status), enterprise_id = COALESCE(?, enterprise_id)
       WHERE id = ?`,
      [nickname, status, enterprise_id, id],
    );
  }

  const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;

  logOperation({
    userId: adminUser.id,
    userPhone: adminUser.phone,
    action: 'USER_UPDATE',
    resource: 'user',
    resourceId: parseInt(id),
    method: 'PUT',
    path: `/api/v1/admin/users-password/${id}`,
    requestData: { nickname, status, enterprise_id, password_changed: !!newPasswordHash },
    responseData: {
      before: { nickname: oldUser.nickname, status: oldUser.status, enterprise_id: oldUser.enterprise_id },
      after: { nickname: newUser?.nickname, status: newUser?.status, enterprise_id: newUser?.enterprise_id },
    },
  });

  return c.json({ success: true, msg: '用户信息更新成功' });
});

export { usersPasswordRoutes };
