/**
 * Admin statistics routes
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { authMiddleware, adminMiddleware } from '../../middleware/auth.js';
import type { DashboardStats } from '../../types/index.js';

const statsRoutes = new Hono();

// GET /api/v1/admin/stats - Dashboard statistics
statsRoutes.get('/stats', authMiddleware, adminMiddleware, async (c) => {
  const enterpriseCount = db
    .prepare('SELECT COUNT(*) as count FROM enterprises')
    .get() as { count: number };

  const userCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE phone != 'sudo'")
    .get() as { count: number };

  const approvedCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE status = 1 AND phone != 'sudo'")
    .get() as { count: number };

  const pendingCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE status = 0 AND phone != 'sudo'")
    .get() as { count: number };

  const totalPoints = db
    .prepare("SELECT SUM(balance) as total FROM users WHERE phone != 'sudo'")
    .get() as { total: number | null };

  const totalBonus = db
    .prepare("SELECT SUM(amount) as total FROM ledger WHERE type = 'BONUS'")
    .get() as { total: number | null };

  const totalConsumed = db
    .prepare("SELECT SUM(amount) as total FROM ledger WHERE type = 'CONSUME'")
    .get() as { total: number | null };

  const stats: DashboardStats = {
    enterprises: enterpriseCount?.count || 0,
    users: userCount?.count || 0,
    approved: approvedCount?.count || 0,
    pending: pendingCount?.count || 0,
    points: {
      total: totalPoints?.total || 0,
      bonus: totalBonus?.total || 0,
      consumed: Math.abs(totalConsumed?.total || 0),
    },
  };

  return c.json({ success: true, data: stats });
});

export { statsRoutes };