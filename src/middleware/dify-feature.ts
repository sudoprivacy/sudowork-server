/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gate Dify-backed routes when the integration env is incomplete. Without
 * this, requests fall through to DifyClient which then crashes with
 * `Cannot call system endpoints` (admin paths) or fires HTTP at the
 * `http://localhost:5001` default (end-user paths), yielding opaque 500s.
 *
 * Returns 503 with a structured body so the admin SPA / sudowork client
 * can distinguish "Dify off" from "Dify reachable but errored".
 */

import type { Context, Next } from "hono";
import { getDifyFeatureFlags } from "../services/DifyFeatureFlags.js";

export async function requireDifyConfigured(c: Context, next: Next) {
  const flags = getDifyFeatureFlags();
  if (flags.enabled) return next();
  return c.json(
    {
      success: false,
      code: "DIFY_NOT_CONFIGURED",
      msg: `Dify 集成未配置: 缺少 ${flags.missingEnv.join(", ")}`,
      data: { missingEnv: flags.missingEnv },
    },
    503,
  );
}
