/**
 * Sudowork Server - Main Entry Point
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";

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

// Initialize database
initSchema();
runMigrations();
await initDatabase();

// Create app
const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Serve static files from admin-dist
app.use("/assets/*", serveStatic({ root: "./admin-dist" }));
app.use("/favicon.svg", serveStatic({ root: "./admin-dist" }));
app.use("/icons.svg", serveStatic({ root: "./admin-dist" }));

// Serve index.html for root path
app.get("/", async (c) => {
  const file = Bun.file("./admin-dist/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html" },
  });
});

// Mount API routes
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/user", userRoutes);
app.route("/api/v1/recharge", rechargeRoutes);
app.route("/api/v1", miscRoutes);

// SPA fallback - serve index.html for all other routes (must be after all API routes)
app.get("/*", async (c) => {
  const file = Bun.file("./admin-dist/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html" },
  });
});

// Start server
export default { port: 3000, fetch: app.fetch };