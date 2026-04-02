/**
 * Admin routes index
 * Mounts all admin sub-routes
 */

import { Hono } from 'hono';
import { statsRoutes } from './stats.js';
import { usersRoutes } from './users.js';
import { pointsRoutes } from './points.js';

const adminRoutes = new Hono();

// Mount sub-routes
adminRoutes.route('/', statsRoutes);
adminRoutes.route('/', usersRoutes);
adminRoutes.route('/', pointsRoutes);

export { adminRoutes };