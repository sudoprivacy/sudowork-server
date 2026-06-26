/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Admin-only feature-flag inventory. The SPA reads this once on page mount
 * (专属智能体 / 知识库管理) to decide whether to render the active UI or a
 * disabled-state banner.
 *
 * Kept separate from /admin/system-config because that endpoint is about
 * login-method toggles, not capability gating; mixing them would couple
 * unrelated lifecycles.
 */

import { Hono } from "hono";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import { getDifyFeatureFlags } from "../services/DifyFeatureFlags.js";

const adminFeaturesRoutes = new Hono();

adminFeaturesRoutes.get(
  "/features",
  authMiddleware,
  adminMiddleware,
  (c) => {
    const dify = getDifyFeatureFlags();
    return c.json({
      success: true,
      data: { dify },
    });
  },
);

export { adminFeaturesRoutes };
