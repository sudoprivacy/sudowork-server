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
import { userRoutes } from "./routes/user.js";
import { miscRoutes } from "./routes/misc.js";
import { rechargeRoutes } from "./routes/recharge.js";
import { proxyRoutes } from "./routes/external-proxy.js";
import { initDatabase as initQmsDatabase } from "./qms/db/init.js";
import qmsRoutes from "./qms/routes/index.js";
import { createScheduler, setSchedulerInstance } from "./qms/tasks/index.js";

// Initialize database
initSchema();
runMigrations();
await initDatabase();

if (process.env.QMS_ENABLED !== "false") {
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
const UPLOAD_DIR_STATIC = process.env.UPLOAD_DIR || './data/uploads';
app.use("/uploads/*", serveStatic({ root: join(UPLOAD_DIR_STATIC, '..') }));

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
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/user", userRoutes);
app.route("/api/v1/recharge", rechargeRoutes);
if (process.env.QMS_ENABLED !== "false") {
  app.route("/api/v1/telemetry", qmsRoutes.telemetry);
  app.route("/api/v1/crash", qmsRoutes.crash);
  app.route("/api/v1/qms/dashboard", qmsRoutes.dashboard);
  app.route("/api/v1/qms/user-stats", qmsRoutes.userStats);
  app.route("/api/v1/qms/crash", qmsRoutes.crash);
  app.route("/api/v1/qms/alerts", qmsRoutes.alerts);
  app.route("/api/v1/qms/system", qmsRoutes.system);
}
app.route("/api/v1", miscRoutes);

// SPA fallback - serve index.html for all other routes (must be after all API routes)
app.get("/*", async (c) => {
  const file = Bun.file("./admin-dist/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html" },
  });
});

// Start server
if (process.env.QMS_ENABLED !== "false") {
  const qmsScheduler = createScheduler();
  setSchedulerInstance(qmsScheduler);
  qmsScheduler.start();
}

export default { port: 3000, fetch: app.fetch };
