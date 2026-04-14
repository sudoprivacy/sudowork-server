/**
 * Admin routes - mounts all admin sub-routes
 */

import { Hono } from "hono";
import { adminAuthRoutes } from "./admin-auth.js";
import { adminEnterpriseRoutes } from "./admin-enterprises.js";
import { adminInvitationRoutes } from "./admin-invitation-codes.js";
import { adminRoutes as newAdminRoutes } from "./admin/index.js";
import { adminLogRoutes } from "./admin-logs.js";

const adminRoutes = new Hono();

// Mount admin sub-routes
adminRoutes.route("/", adminAuthRoutes);
adminRoutes.route("/", adminEnterpriseRoutes);
adminRoutes.route("/", adminInvitationRoutes);
adminRoutes.route("/", newAdminRoutes);
adminRoutes.route("/", adminLogRoutes);

export { adminRoutes };