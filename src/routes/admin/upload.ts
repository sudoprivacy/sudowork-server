/**
 * Upload Routes - Config Item Icon Upload
 * Independent module for file upload handling
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../../middleware/auth.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const uploadRoutes = new Hono();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const CONFIG_ITEMS_UPLOAD_DIR = join(UPLOAD_DIR, 'config-items');
const MAX_FILE_SIZE = 500 * 1024; // 500KB
const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg'];
const ALLOWED_MIME_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg'];

// Ensure upload directory exists on startup
await mkdir(CONFIG_ITEMS_UPLOAD_DIR, { recursive: true });

// POST /upload/config-item-icon - Upload a config item icon
uploadRoutes.post('/upload/config-item-icon', authMiddleware, adminMiddleware, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ success: false, msg: '请选择要上传的文件' }, 400);
  }

  // Validate file extension
  const originalName = file.name || '';
  const dotIndex = originalName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? originalName.substring(dotIndex).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return c.json({ success: false, msg: '仅支持 SVG、PNG、JPG 格式的图片' }, 400);
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return c.json({ success: false, msg: '仅支持 SVG、PNG、JPG 格式的图片' }, 400);
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ success: false, msg: '文件大小不能超过 500KB' }, 400);
  }

  // Generate filename: UUID + original extension
  const filename = `${randomUUID()}${ext}`;
  const filePath = join(CONFIG_ITEMS_UPLOAD_DIR, filename);

  // Write file to disk
  const buffer = await file.arrayBuffer();
  await Bun.write(filePath, buffer);

  return c.json({
    success: true,
    data: { filename },
    msg: '图标上传成功'
  });
});

export { uploadRoutes };
