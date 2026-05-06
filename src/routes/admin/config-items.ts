/**
 * Config Items Management Routes (配置项管理路由)
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { authMiddleware, adminMiddleware, getAuthUser } from '../../middleware/auth.js';
import { logOperation } from '../../utils/logger.js';
import { generateUniquePinyin } from '../../utils/pinyin.js';
import { isValidUrlPattern } from '../../utils/validation.js';

const configItemsRoutes = new Hono();

// ==================== GET /config-items - List ====================

configItemsRoutes.get('/config-items', authMiddleware, adminMiddleware, async (c) => {
  const enterpriseName = c.req.query('enterprise_name');
  const name = c.req.query('name');
  const status = c.req.query('status');
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('page_size') || '20');

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (enterpriseName) {
    whereClause += ` AND ci.id IN (SELECT cer.config_item_id FROM config_enterprise_rel cer JOIN enterprises e ON cer.enterprise_id = e.id WHERE e.name LIKE ?)`;
    params.push(`%${enterpriseName}%`);
  }

  if (name) {
    whereClause += ` AND ci.name LIKE ?`;
    params.push(`%${name}%`);
  }

  if (status !== undefined && status !== null && status !== '') {
    whereClause += ' AND ci.status = ?';
    params.push(parseInt(status));
  }

  // Count total
  const countResult = db.prepare(
    `SELECT COUNT(*) as total FROM config_items ci ${whereClause}`
  ).get(...params) as any;
  const total = countResult?.total || 0;

  // Query items
  const offset = (page - 1) * pageSize;
  const items = db.prepare(
    `SELECT ci.*,
      (SELECT COUNT(*) FROM config_enterprise_rel cer WHERE cer.config_item_id = ci.id) as enterprise_count
     FROM config_items ci
     ${whereClause}
     ORDER BY ci.updated_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);

  return c.json({ success: true, data: { items, total, page, page_size: pageSize } });
});

// ==================== POST /config-items - Create ====================

configItemsRoutes.post('/config-items', authMiddleware, adminMiddleware, async (c) => {
  const { name, description, icon, url_pattern } = await c.req.json();

  if (!name || !name.trim()) {
    return c.json({ success: false, msg: '配置项名称不能为空' }, 400);
  }
  if (name.length > 20) {
    return c.json({ success: false, msg: '配置项名称不超过20个字符' }, 400);
  }
  if (description && description.length > 200) {
    return c.json({ success: false, msg: '配置项说明不超过200个字符' }, 400);
  }
  if (url_pattern !== undefined && url_pattern !== null && url_pattern.trim()) {
    const urlPatternTrimmed = url_pattern.trim();
    if (urlPatternTrimmed.length > 256) {
      return c.json({ success: false, msg: 'URL匹配模式不超过256个字符' }, 400);
    }
    if (!isValidUrlPattern(urlPatternTrimmed)) {
      return c.json({ success: false, msg: 'URL匹配模式格式不正确，需以http://或https://开头的合法URL，路径中可使用*和?通配符' }, 400);
    }
  }

  const existing = db.prepare('SELECT id FROM config_items WHERE name = ?').get(name.trim());
  if (existing) {
    return c.json({ success: false, msg: '配置项名称已存在' }, 400);
  }

  const pinyinValue = generateUniquePinyin(name.trim());

  const adminUser = (await getAuthUser(c)) as any;

  const result = db.run(
    `INSERT INTO config_items (name, description, icon, pinyin, url_pattern, status, created_by_id, created_by_name, updated_by_id, updated_by_name)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [name.trim(), description || null, icon || null, pinyinValue, url_pattern?.trim() || null, adminUser?.id || null, adminUser?.nickname || adminUser?.phone || null, adminUser?.id || null, adminUser?.nickname || adminUser?.phone || null]
  );

  const newId = Number(result.lastInsertRowid);

  logOperation({
    userId: adminUser?.id || 0,
    userPhone: adminUser?.phone || '',
    action: 'CONFIG_ITEM_CREATE',
    resource: 'config_item',
    resourceId: newId,
    method: 'POST',
    path: '/api/v1/admin/config-items',
    requestData: { name, description, icon, pinyin: pinyinValue },
    responseData: { id: newId, name, pinyin: pinyinValue },
  });

  return c.json({ success: true, msg: '配置项创建成功', data: { id: newId } });
});

// ==================== GET /config-items/:id - Detail ====================

configItemsRoutes.get('/config-items/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');

  const item = db.prepare('SELECT * FROM config_items WHERE id = ?').get(id);
  if (!item) {
    return c.json({ success: false, msg: '配置项不存在' }, 404);
  }

  const entries = db.prepare('SELECT * FROM config_entries WHERE config_item_id = ? ORDER BY id').all(id);

  const enterprises = db.prepare(
    `SELECT e.id, e.name, e.code FROM enterprises e
     JOIN config_enterprise_rel cer ON cer.enterprise_id = e.id
     WHERE cer.config_item_id = ?
     ORDER BY e.id`
  ).all(id);

  return c.json({ success: true, data: { ...item, entries, enterprises } });
});

// ==================== PUT /config-items/:id - Update ====================

configItemsRoutes.put('/config-items/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const { name, description, icon, pinyin, url_pattern } = await c.req.json();

  const item = db.prepare('SELECT * FROM config_items WHERE id = ?').get(id) as any;
  if (!item) {
    return c.json({ success: false, msg: '配置项不存在' }, 404);
  }
  if (item.status === 0) {
    return c.json({ success: false, msg: '禁用状态的配置项不能编辑' }, 400);
  }

  if (name !== undefined) {
    if (!name.trim()) {
      return c.json({ success: false, msg: '配置项名称不能为空' }, 400);
    }
    if (name.length > 20) {
      return c.json({ success: false, msg: '配置项名称不超过20个字符' }, 400);
    }
    const existing = db.prepare('SELECT id FROM config_items WHERE name = ? AND id != ?').get(name.trim(), id);
    if (existing) {
      return c.json({ success: false, msg: '配置项名称已存在' }, 400);
    }
  }

  if (description !== undefined && description && description.length > 200) {
    return c.json({ success: false, msg: '配置项说明不超过200个字符' }, 400);
  }

  // Validate pinyin if provided (admin checked the "edit pinyin" checkbox)
  if (pinyin !== undefined && pinyin !== null && pinyin.trim()) {
    const pinyinTrimmed = pinyin.trim();
    if (pinyinTrimmed.length > 128) {
      return c.json({ success: false, msg: '拼音不超过128个字符' }, 400);
    }
    if (!/^[a-z0-9_]+$/.test(pinyinTrimmed)) {
      return c.json({ success: false, msg: '拼音只允许小写英文字母、数字和_' }, 400);
    }
    const existingPinyin = db.prepare('SELECT id FROM config_items WHERE pinyin = ? AND id != ?').get(pinyinTrimmed, id);
    if (existingPinyin) {
      return c.json({ success: false, msg: '拼音已存在，请使用其他拼音' }, 400);
    }
  }

  if (url_pattern !== undefined && url_pattern !== null && url_pattern.trim()) {
    const urlPatternTrimmed = url_pattern.trim();
    if (urlPatternTrimmed.length > 256) {
      return c.json({ success: false, msg: 'URL匹配模式不超过256个字符' }, 400);
    }
    if (!isValidUrlPattern(urlPatternTrimmed)) {
      return c.json({ success: false, msg: 'URL匹配模式格式不正确，需以http://或https://开头的合法URL，路径中可使用*和?通配符' }, 400);
    }
  }

  const adminUser = (await getAuthUser(c)) as any;

  const pinyinValue = (pinyin !== undefined && pinyin !== null && pinyin.trim()) ? pinyin.trim() : null;

  const urlPatternProvided = url_pattern !== undefined;
  const urlPatternValue = url_pattern !== undefined ? (url_pattern === null ? null : (url_pattern.trim() || null)) : null;

  db.run(
    `UPDATE config_items SET name = COALESCE(?, name), description = COALESCE(?, description), icon = COALESCE(?, icon), pinyin = CASE WHEN ? IS NOT NULL THEN ? ELSE pinyin END, url_pattern = CASE WHEN ? THEN ? ELSE url_pattern END, updated_by_id = ?, updated_by_name = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [name?.trim() || null, description ?? null, icon ?? null, pinyinValue, pinyinValue, urlPatternProvided, urlPatternValue, adminUser?.id || null, adminUser?.nickname || adminUser?.phone || null, id]
  );

  logOperation({
    userId: adminUser?.id || 0,
    userPhone: adminUser?.phone || '',
    action: 'CONFIG_ITEM_UPDATE',
    resource: 'config_item',
    resourceId: Number(id),
    method: 'PUT',
    path: `/api/v1/admin/config-items/${id}`,
    requestData: { name, description, icon, pinyin, url_pattern },
  });

  return c.json({ success: true, msg: '配置项更新成功' });
});

// ==================== PUT /config-items/:id/status - Toggle Status ====================

configItemsRoutes.put('/config-items/:id/status', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const { status } = await c.req.json();

  if (status !== 0 && status !== 1) {
    return c.json({ success: false, msg: '状态值无效' }, 400);
  }

  const item = db.prepare('SELECT * FROM config_items WHERE id = ?').get(id) as any;
  if (!item) {
    return c.json({ success: false, msg: '配置项不存在' }, 404);
  }

  if (item.status === status) {
    return c.json({ success: false, msg: '状态未发生变化' }, 400);
  }

  const adminUser = (await getAuthUser(c)) as any;

  try {
    db.run('BEGIN EXCLUSIVE TRANSACTION');

    // When disabling, delete all enterprise relations
    if (status === 0) {
      db.run('DELETE FROM config_enterprise_rel WHERE config_item_id = ?', [id]);
    }

    db.run(
      `UPDATE config_items SET status = ?, updated_by_id = ?, updated_by_name = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [status, adminUser?.id || null, adminUser?.nickname || adminUser?.phone || null, id]
    );

    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    return c.json({ success: false, msg: '状态更新失败' }, 500);
  }

  const actionText = status === 0 ? 'CONFIG_ITEM_DISABLE' : 'CONFIG_ITEM_ENABLE';

  logOperation({
    userId: adminUser?.id || 0,
    userPhone: adminUser?.phone || '',
    action: actionText,
    resource: 'config_item',
    resourceId: Number(id),
    method: 'PUT',
    path: `/api/v1/admin/config-items/${id}/status`,
    requestData: { status },
  });

  return c.json({ success: true, msg: status === 0 ? '配置项已禁用' : '配置项已恢复' });
});

// ==================== GET /config-items/:id/entries - Get Entries ====================

configItemsRoutes.get('/config-items/:id/entries', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');

  const item = db.prepare('SELECT id FROM config_items WHERE id = ?').get(id);
  if (!item) {
    return c.json({ success: false, msg: '配置项不存在' }, 404);
  }

  const entries = db.prepare('SELECT * FROM config_entries WHERE config_item_id = ? ORDER BY id').all(id);

  return c.json({ success: true, data: entries });
});

// ==================== PUT /config-items/:id/entries - Save Entries ====================

configItemsRoutes.put('/config-items/:id/entries', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const { entries } = await c.req.json();

  const item = db.prepare('SELECT id, status FROM config_items WHERE id = ?').get(id) as any;
  if (!item) {
    return c.json({ success: false, msg: '配置项不存在' }, 404);
  }
  if (item.status === 0) {
    return c.json({ success: false, msg: '禁用状态的配置项不能修改配置列表' }, 400);
  }

  if (!Array.isArray(entries)) {
    return c.json({ success: false, msg: 'entries 必须为数组' }, 400);
  }

  // Validate each entry
  const keyPattern = /^[a-zA-Z0-9_-]+$/;
  const seenKeys = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.config_key || !entry.config_key.trim()) {
      return c.json({ success: false, msg: `第 ${i + 1} 行的配置key不能为空` }, 400);
    }
    if (entry.config_key.length > 128) {
      return c.json({ success: false, msg: `第 ${i + 1} 行的配置key不超过128个字符` }, 400);
    }
    if (!keyPattern.test(entry.config_key)) {
      return c.json({ success: false, msg: `第 ${i + 1} 行的配置key只允许英文字母、数字、-和_` }, 400);
    }
    if (seenKeys.has(entry.config_key)) {
      return c.json({ success: false, msg: `配置key「${entry.config_key}」重复` }, 400);
    }
    seenKeys.add(entry.config_key);
    if (!entry.name || !entry.name.trim()) {
      return c.json({ success: false, msg: `第 ${i + 1} 行的名称不能为空` }, 400);
    }
    if (entry.name.trim().length > 128) {
      return c.json({ success: false, msg: `第 ${i + 1} 行的名称不超过128个字符` }, 400);
    }
    if (entry.config_desc && entry.config_desc.length > 500) {
      return c.json({ success: false, msg: `第 ${i + 1} 行的配置说明不超过500个字符` }, 400);
    }
  }

  const adminUser = (await getAuthUser(c)) as any;

  try {
    db.run('BEGIN EXCLUSIVE TRANSACTION');

    // Delete all existing entries
    db.run('DELETE FROM config_entries WHERE config_item_id = ?', [id]);

    // Insert new entries
    const insertStmt = db.prepare(
      `INSERT INTO config_entries (config_item_id, config_key, name, config_desc, required, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );

    for (const entry of entries) {
      insertStmt.run(id, entry.config_key.trim(), entry.name.trim(), entry.config_desc?.trim() || null, entry.required !== undefined ? entry.required : 1);
    }

    // Update config_item's updated_at
    db.run(
      `UPDATE config_items SET updated_by_id = ?, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?`,
      [adminUser?.id || null, adminUser?.nickname || adminUser?.phone || null, id]
    );

    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    return c.json({ success: false, msg: '配置列表保存失败' }, 500);
  }

  logOperation({
    userId: adminUser?.id || 0,
    userPhone: adminUser?.phone || '',
    action: 'CONFIG_ENTRIES_SAVE',
    resource: 'config_item',
    resourceId: Number(id),
    method: 'PUT',
    path: `/api/v1/admin/config-items/${id}/entries`,
    requestData: { entryCount: entries.length },
  });

  return c.json({ success: true, msg: '配置列表保存成功' });
});

// ==================== GET /config-items/:id/enterprises - Get Associated Enterprises ====================

configItemsRoutes.get('/config-items/:id/enterprises', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const enterpriseName = c.req.query('enterprise_name');
  const enterpriseId = c.req.query('enterprise_id');
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('page_size') || '20');

  const item = db.prepare('SELECT id FROM config_items WHERE id = ?').get(id);
  if (!item) {
    return c.json({ success: false, msg: '配置项不存在' }, 404);
  }

  // Build query: show associated enterprises by default, with optional filters
  let whereClause = 'WHERE cer.config_item_id = ?';
  const params: any[] = [id];

  if (enterpriseName) {
    whereClause += ` AND e.name LIKE ?`;
    params.push(`%${enterpriseName}%`);
  }

  if (enterpriseId) {
    const eid = parseInt(enterpriseId);
    if (isNaN(eid)) {
      return c.json({ success: false, msg: '企业ID必须为整数' }, 400);
    }
    whereClause += ` AND e.id = ?`;
    params.push(eid);
  }

  // Count total
  let total: number;
  if (!enterpriseName && !enterpriseId) {
    // Default: count associated enterprises
    const countResult = db.prepare(
      `SELECT COUNT(*) as total FROM config_enterprise_rel cer JOIN enterprises e ON cer.enterprise_id = e.id ${whereClause}`
    ).get(...params) as any;
    total = countResult?.total || 0;
  } else {
    // With search filters: count all matching enterprises
    const countClause = whereClause.replace('WHERE cer.config_item_id = ?', 'WHERE 1=1');
    const countResult = db.prepare(
      `SELECT COUNT(*) as total FROM enterprises e LEFT JOIN config_enterprise_rel cer ON cer.enterprise_id = e.id AND cer.config_item_id = ? ${countClause}`
    ).get(id, ...params.slice(1)) as any;
    total = countResult?.total || 0;
  }

  // Query items
  const offset = (page - 1) * pageSize;
  const items = db.prepare(
    `SELECT e.id, e.name, e.code,
      CASE WHEN cer.config_item_id IS NOT NULL THEN 1 ELSE 0 END as is_associated
     FROM enterprises e
     LEFT JOIN config_enterprise_rel cer ON cer.enterprise_id = e.id AND cer.config_item_id = ?
     ${enterpriseName || enterpriseId ? `WHERE (e.name LIKE ${enterpriseName ? '?' : "'%'"} ${enterpriseId ? `AND e.id = ?` : ''})` : ''}
     ORDER BY e.id
     LIMIT ? OFFSET ?`
  );

  // For the default view (no filters), only show associated enterprises
  let enterprises: any[];
  if (!enterpriseName && !enterpriseId) {
    enterprises = db.prepare(
      `SELECT e.id, e.name, e.code, 1 as is_associated
       FROM enterprises e
       JOIN config_enterprise_rel cer ON cer.enterprise_id = e.id
       WHERE cer.config_item_id = ?
       ORDER BY e.id
       LIMIT ? OFFSET ?`
    ).all(id, pageSize, offset);
  } else {
    enterprises = db.prepare(
      `SELECT e.id, e.name, e.code,
        CASE WHEN cer.config_item_id IS NOT NULL THEN 1 ELSE 0 END as is_associated
       FROM enterprises e
       LEFT JOIN config_enterprise_rel cer ON cer.enterprise_id = e.id AND cer.config_item_id = ?
       ${whereClause.replace('WHERE cer.config_item_id = ?', 'WHERE 1=1')}
       ORDER BY e.id
       LIMIT ? OFFSET ?`
    ).all(id, ...params.slice(1), pageSize, offset);
  }

  return c.json({ success: true, data: { items: enterprises, total, page, page_size: pageSize } });
});

// ==================== POST /config-items/:id/enterprises/:enterpriseId - Associate ====================

configItemsRoutes.post('/config-items/:id/enterprises/:enterpriseId', authMiddleware, adminMiddleware, async (c) => {
  const configItemId = c.req.param('id');
  const enterpriseId = c.req.param('enterpriseId');

  const item = db.prepare('SELECT id, status FROM config_items WHERE id = ?').get(configItemId) as any;
  if (!item) {
    return c.json({ success: false, msg: '配置项不存在' }, 404);
  }
  if (item.status === 0) {
    return c.json({ success: false, msg: '禁用状态的配置项不能关联企业' }, 400);
  }

  const enterprise = db.prepare('SELECT id FROM enterprises WHERE id = ?').get(enterpriseId);
  if (!enterprise) {
    return c.json({ success: false, msg: '企业不存在' }, 404);
  }

  const existing = db.prepare(
    'SELECT id FROM config_enterprise_rel WHERE config_item_id = ? AND enterprise_id = ?'
  ).get(configItemId, enterpriseId);

  if (existing) {
    return c.json({ success: false, msg: '该企业已关联此配置项' }, 400);
  }

  db.run(
    'INSERT INTO config_enterprise_rel (config_item_id, enterprise_id) VALUES (?, ?)',
    [configItemId, enterpriseId]
  );

  // Update config_item's updated_at
  const adminUser = (await getAuthUser(c)) as any;
  db.run(
    `UPDATE config_items SET updated_by_id = ?, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?`,
    [adminUser?.id || null, adminUser?.nickname || adminUser?.phone || null, configItemId]
  );

  logOperation({
    userId: adminUser?.id || 0,
    userPhone: adminUser?.phone || '',
    action: 'CONFIG_ENTERPRISE_ADD',
    resource: 'config_item',
    resourceId: Number(configItemId),
    method: 'POST',
    path: `/api/v1/admin/config-items/${configItemId}/enterprises/${enterpriseId}`,
    requestData: { enterpriseId: Number(enterpriseId) },
  });

  return c.json({ success: true, msg: '企业关联成功' });
});

// ==================== DELETE /config-items/:id/enterprises/:enterpriseId - Remove Association ====================

configItemsRoutes.delete('/config-items/:id/enterprises/:enterpriseId', authMiddleware, adminMiddleware, async (c) => {
  const configItemId = c.req.param('id');
  const enterpriseId = c.req.param('enterpriseId');

  const rel = db.prepare(
    'SELECT id FROM config_enterprise_rel WHERE config_item_id = ? AND enterprise_id = ?'
  ).get(configItemId, enterpriseId);

  if (!rel) {
    return c.json({ success: false, msg: '该企业未关联此配置项' }, 404);
  }

  db.run(
    'DELETE FROM config_enterprise_rel WHERE config_item_id = ? AND enterprise_id = ?',
    [configItemId, enterpriseId]
  );

  const adminUser = (await getAuthUser(c)) as any;
  db.run(
    `UPDATE config_items SET updated_by_id = ?, updated_by_name = ?, updated_at = datetime('now') WHERE id = ?`,
    [adminUser?.id || null, adminUser?.nickname || adminUser?.phone || null, configItemId]
  );

  logOperation({
    userId: adminUser?.id || 0,
    userPhone: adminUser?.phone || '',
    action: 'CONFIG_ENTERPRISE_REMOVE',
    resource: 'config_item',
    resourceId: Number(configItemId),
    method: 'DELETE',
    path: `/api/v1/admin/config-items/${configItemId}/enterprises/${enterpriseId}`,
    requestData: { enterpriseId: Number(enterpriseId) },
  });

  return c.json({ success: true, msg: '企业取消关联成功' });
});

export { configItemsRoutes };
