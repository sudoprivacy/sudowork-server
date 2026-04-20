/**
 * Upload Routes - Config Item Icon Upload & Enterprise Logo Upload
 * Independent module for file upload handling
 */

import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../../middleware/auth.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import imageSize from 'image-size';

const uploadRoutes = new Hono();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const CONFIG_ITEMS_UPLOAD_DIR = join(UPLOAD_DIR, 'config-items');
const ENTERPRISES_UPLOAD_DIR = join(UPLOAD_DIR, 'enterprises');
const MAX_FILE_SIZE = 500 * 1024; // 500KB
const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg'];
const ALLOWED_MIME_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg'];

// Ensure upload directories exist on startup
await mkdir(CONFIG_ITEMS_UPLOAD_DIR, { recursive: true });
await mkdir(ENTERPRISES_UPLOAD_DIR, { recursive: true });

// Parse SVG dimensions from raw SVG content
function parseSvgDimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
  const text = new TextDecoder().decode(buffer);

  // Try width/height attributes first
  const widthMatch = text.match(/<svg[^>]*\swidth\s*=\s*"(\d+(?:\.\d+)?)"[^>]*>/);
  const heightMatch = text.match(/<svg[^>]*\sheight\s*=\s*"(\d+(?:\.\d+)?)"[^>]*>/);

  if (widthMatch && heightMatch) {
    return { width: parseFloat(widthMatch[1]), height: parseFloat(heightMatch[1]) };
  }

  // Fallback to viewBox
  const viewBoxMatch = text.match(/<svg[^>]*\sviewBox\s*=\s*"(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  if (viewBoxMatch) {
    return { width: parseFloat(viewBoxMatch[3]), height: parseFloat(viewBoxMatch[4]) };
  }

  return null;
}

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

  // Read file buffer for validation and writing
  const buffer = await file.arrayBuffer();

  // Validate square aspect ratio (1:1)
  if (ext === '.svg') {
    const dims = parseSvgDimensions(buffer);
    if (dims && dims.width !== dims.height) {
      return c.json({ success: false, msg: '图标必须是正方形图片（宽高比为 1:1）' }, 400);
    }
  } else {
    // PNG/JPG - use image-size library
    try {
      const dims = imageSize(Buffer.from(buffer));
      if (dims.width !== dims.height) {
        return c.json({ success: false, msg: '图标必须是正方形图片（宽高比为 1:1）' }, 400);
      }
    } catch (e) {
      return c.json({ success: false, msg: '无法解析图片尺寸，请确保上传有效的图片文件' }, 400);
    }
  }

  // Write file to disk
  await Bun.write(filePath, buffer);

  return c.json({
    success: true,
    data: { filename },
    msg: '图标上传成功'
  });
});

// POST /upload/enterprise-logo - Upload an enterprise logo
uploadRoutes.post('/upload/enterprise-logo', authMiddleware, adminMiddleware, async (c) => {
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
  const filePath = join(ENTERPRISES_UPLOAD_DIR, filename);

  // Read file buffer and write to disk
  const buffer = await file.arrayBuffer();
  await Bun.write(filePath, buffer);

  return c.json({
    success: true,
    data: { filename },
    msg: 'Logo上传成功'
  });
});

export { uploadRoutes };
