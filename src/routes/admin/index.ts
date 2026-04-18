/**
 * Admin routes index
 * Mounts all admin sub-routes
 */

import { Hono } from 'hono';
import { statsRoutes } from './stats.js';
import { usersRoutes } from './users.js';
import { pointsRoutes } from './points.js';
import { rechargeRoutes } from './recharge.js';
import { syncRoutes } from './sync.js';
import { configItemsRoutes } from './config-items.js';
import { uploadRoutes } from './upload.js';

const adminRoutes = new Hono();

// Mount sub-routes
adminRoutes.route('/', statsRoutes);
adminRoutes.route('/', usersRoutes);
adminRoutes.route('/', pointsRoutes);
adminRoutes.route('/', rechargeRoutes);
adminRoutes.route('/', syncRoutes);
adminRoutes.route('/', configItemsRoutes);
adminRoutes.route('/', uploadRoutes);

export { adminRoutes };