/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for "is the Dify integration usable?". Read from
 * process.env on every call so unit tests / one-off scripts can flip the
 * state by mutating env without reimporting modules.
 *
 * The check is presence-only — it does NOT round-trip to the Dify HTTP API.
 * That keeps the call cheap enough to invoke on every request via middleware,
 * and avoids cascading failures when Dify is temporarily down (a healthcheck
 * concern, not a feature-flag concern).
 *
 * Used by:
 *   - middleware/dify-feature.ts          → gate route handlers
 *   - routes/admin-features.ts            → expose to admin SPA so it can
 *                                           render "disabled" banners instead
 *                                           of empty tables.
 */

const REQUIRED_ENV_KEYS = [
  "DIFY_BASE_URL",
  "DIFY_SYSTEM_TOKEN",
  "DIFY_SYSTEM_SECRET",
  "DIFY_SSO_SECRET",
] as const;

export type DifyEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

export interface DifyFeatureFlags {
  enabled: boolean;
  missingEnv: DifyEnvKey[];
}

export function getDifyFeatureFlags(): DifyFeatureFlags {
  const missingEnv: DifyEnvKey[] = [];
  for (const key of REQUIRED_ENV_KEYS) {
    const v = process.env[key];
    if (!v || !v.trim()) missingEnv.push(key);
  }
  return { enabled: missingEnv.length === 0, missingEnv };
}
