/**
 * Sudowork Server - Main Entry Point
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { join } from "node:path";

// Database
import { initSchema } from "./db/schema.js";
import { runMigrations } from "./db/migrations.js";
import { initDatabase } from "./db/init.js";

// Routes
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { thirdPartyAuthRoutes } from "./routes/auth-third-party.js";
import { userRoutes } from "./routes/user.js";
import { miscRoutes } from "./routes/misc.js";
import { rechargeRoutes } from "./routes/recharge.js";
import { proxyRoutes } from "./routes/external-proxy.js";
import { systemConfigRoutes } from "./routes/system-config.js";
import { adminDifyRoutes } from "./routes/admin-dify.js";
import { adminDatasetsRoutes } from "./routes/admin-datasets.js";
import { adminFeaturesRoutes } from "./routes/admin-features.js";
import { agentsRoutes } from "./routes/agents.js";
import { loginByConfigRoutes } from "./routes/auth-login-by-config.js";
import { authChangePasswordRoutes } from "./routes/auth-change-password.js";
import { authRegisterPasswordRoutes } from "./routes/auth-register-password.js";
import { initDatabase as initQmsDatabase } from "./qms/db/init.js";
import qmsRoutes from "./qms/routes/index.js";
import { createScheduler, setSchedulerInstance } from "./qms/tasks/index.js";
import {
  corsMiddleware as qmsCorsMiddleware,
  errorHandler as qmsErrorHandler,
  requestLogger as qmsRequestLogger,
} from "./qms/middleware/index.js";

const qmsEnabled = process.env.QMS_ENABLED === "true";

// Initialize database
initSchema();
runMigrations();
await initDatabase();

if (qmsEnabled) {
  await initQmsDatabase();
}

// Create app
const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Serve static files from admin-dist
app.use("/assets/*", serveStatic({ root: "./admin-dist" }));
app.use("/favicon.svg", serveStatic({ root: "./admin-dist" }));
app.use("/icons.svg", serveStatic({ root: "./admin-dist" }));

// Serve uploaded config item icons
const UPLOAD_DIR_STATIC = process.env.UPLOAD_DIR || "./data/uploads";
app.use("/uploads/*", serveStatic({ root: join(UPLOAD_DIR_STATIC, "..") }));

// Serve default config item icon
app.use("/config-item-default.svg", serveStatic({ root: "./public" }));

// Serve default enterprise logo
app.use("/enterprise-default-logo.svg", serveStatic({ root: "./public" }));

// Serve index.html for root path
app.get("/", async (c) => {
  const file = Bun.file("./admin-dist/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html" },
  });
});

// Mount API routes
// External proxy routes first
app.route("/api", proxyRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/admin", adminFeaturesRoutes);
app.route("/api/v1/admin/dify", adminDifyRoutes);
app.route("/api/v1/admin", adminDatasetsRoutes);
app.route("/api/v1/agents", agentsRoutes);
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/auth", thirdPartyAuthRoutes);
app.route("/api/v1/auth", loginByConfigRoutes);
app.route("/api/v1/auth", authChangePasswordRoutes);
app.route("/api/v1/auth", authRegisterPasswordRoutes);
app.route("/api/v1/user", userRoutes);
app.route("/api/v1/recharge", rechargeRoutes);
if (qmsEnabled) {
  const qmsApp = new Hono();

  qmsApp.use("*", qmsErrorHandler);
  qmsApp.use("*", qmsRequestLogger);
  qmsApp.use("*", qmsCorsMiddleware);
  qmsApp.route("/telemetry", qmsRoutes.telemetry);
  qmsApp.route("/crash", qmsRoutes.crash);
  qmsApp.route("/qms/dashboard", qmsRoutes.dashboard);
  qmsApp.route("/qms/user-stats", qmsRoutes.userStats);
  qmsApp.route("/qms/crash", qmsRoutes.crash);
  qmsApp.route("/qms/alerts", qmsRoutes.alerts);
  qmsApp.route("/qms/system", qmsRoutes.system);

  app.route("/api/v1", qmsApp);
}
app.route("/api/v1", systemConfigRoutes);
app.route("/api/v1", miscRoutes);

// SPA fallback - serve index.html for all other routes (must be after all API routes)
app.get("/*", async (c) => {
  const file = Bun.file("./admin-dist/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html" },
  });
});

// Start server
if (qmsEnabled) {
  const qmsScheduler = createScheduler();
  setSchedulerInstance(qmsScheduler);
  qmsScheduler.start();
}

export default { port: 3000, fetch: app.fetch };
