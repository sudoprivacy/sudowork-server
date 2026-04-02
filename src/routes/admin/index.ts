/**
 * Admin routes index
 * Mounts all admin sub-routes
 */

import { Hono } from 'hono';
import { statsRoutes } from './stats.js';
import { usersRoutes } from './users.js';

const adminRoutes = new Hono();

// Mount sub-routes
adminRoutes.route('/', statsRoutes);
adminRoutes.route('/', usersRoutes);

export { adminRoutes };