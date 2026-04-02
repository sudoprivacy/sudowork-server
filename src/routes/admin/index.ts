/**
 * Admin routes index
 * Mounts all admin sub-routes
 */

import { Hono } from 'hono';
import { statsRoutes } from './stats.js';

const adminRoutes = new Hono();

// Mount sub-routes
adminRoutes.route('/', statsRoutes);

// Placeholder: other routes will be added in subsequent tasks
// For now, we re-export from admin-users.ts

export { adminRoutes };