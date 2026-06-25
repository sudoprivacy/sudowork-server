/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hook for "is Dify integration usable?".
 *
 * Backed by GET /api/v1/admin/features. We cache the in-flight promise at
 * module scope so multiple components mounting on the same page share one
 * request (SkillsList + DatasetsList commonly co-render via tab switches).
 *
 * On error or 401 we treat dify as disabled — the user still sees the
 * "未开启" banner instead of a half-broken page.
 */

import { useEffect, useState } from "react";
import { adminApi } from "../api";

export interface DifyFeatureFlag {
  loading: boolean;
  enabled: boolean;
  missingEnv: string[];
}

interface FeaturesResponse {
  success: boolean;
  data?: { dify?: { enabled?: boolean; missingEnv?: string[] } };
}

let cached: Promise<DifyFeatureFlag> | null = null;

function fetchFlag(): Promise<DifyFeatureFlag> {
  if (cached) return cached;
  cached = adminApi
    .getFeatures()
    .then((resp: unknown) => {
      const r = resp as { data?: FeaturesResponse };
      const body = r?.data;
      const dify = body?.data?.dify ?? {};
      return {
        loading: false,
        enabled: dify.enabled === true,
        missingEnv: Array.isArray(dify.missingEnv) ? dify.missingEnv : [],
      };
    })
    .catch(() => ({
      loading: false,
      enabled: false,
      missingEnv: [] as string[],
    }));
  return cached;
}

/** Reset the module-level cache. Exposed for tests or after env reload. */
export function resetDifyFeatureFlagCache(): void {
  cached = null;
}

export function useDifyFeatureFlag(): DifyFeatureFlag {
  const [state, setState] = useState<DifyFeatureFlag>({
    loading: true,
    enabled: false,
    missingEnv: [],
  });

  useEffect(() => {
    let alive = true;
    fetchFlag().then((flag) => {
      if (alive) setState(flag);
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
