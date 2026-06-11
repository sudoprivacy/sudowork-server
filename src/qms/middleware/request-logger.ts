/**
 * Request logging middleware
 */

import type { Context, Next } from "hono";
import { logger } from "../utils/logger.js";

/**
 * Log incoming requests
 */
export async function requestLogger(c: Context, next: Next) {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  logger.info(`-> ${method} ${path}`);

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  logger.info(`<- ${method} ${path} ${status} ${duration}ms`);
}