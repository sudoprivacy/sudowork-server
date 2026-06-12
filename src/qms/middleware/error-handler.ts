/**
 * Error handler middleware
 */

import type { Context, Next } from "hono";
import { logger } from "../utils/logger.js";

/**
 * Global error handler middleware
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    const error = err as Error;

    logger.error("Request error:", {
      path: c.req.path,
      method: c.req.method,
      error: error.message,
      stack: error.stack,
    });

    // Handle specific error types
    if (error.message.includes("UNIQUE constraint failed")) {
      return c.json(
        {
          success: false,
          error: { code: "DUPLICATE_ENTRY", message: "Resource already exists" },
        },
        409
      );
    }

    if (error.message.includes("NOT NULL constraint failed")) {
      return c.json(
        {
          success: false,
          error: { code: "MISSING_FIELD", message: "Required field is missing" },
        },
        400
      );
    }

    // Generic error response
    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: process.env.NODE_ENV === "production" ? "Internal server error" : error.message,
        },
      },
      500
    );
  }
}

/**
 * Not found handler
 */
export function notFoundHandler(c: Context) {
  return c.json(
    {
      success: false,
      error: { code: "NOT_FOUND", message: "Resource not found" },
    },
    404
  );
}