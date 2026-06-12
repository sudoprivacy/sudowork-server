/**
 * CORS middleware
 */

import { cors } from "hono/cors";
import { config } from "../config/index.js";

/**
 * CORS middleware with configured origins
 */
export const corsMiddleware = cors({
  origin: config.corsOrigins,
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", config.auth.apiKeyHeader],
  exposeHeaders: ["Content-Length"],
  maxAge: 86400,
  credentials: true,
});