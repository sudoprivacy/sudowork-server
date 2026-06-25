/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hook for "is Dify integration usable?".
 *
 * Backed by GET /api/v1/admin/features. Fetched on every mount: the endpoint
 * is a tiny env-presence check, and we explicitly do NOT cache at module
 * scope so that an operator who toggles DIFY_* in .env and restarts the
 * server is reflected on the next page navigation — no browser reload, no
 * stale "未开启" banner.
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

// The admin axios client installs a response interceptor (`e => e.data`)
// that already strips the axios wrapper, so the value resolved here IS the
// JSON body of `{ success, data: { dify: { enabled, missingEnv } } }` — one
// `.data` deep, not two.
interface FeaturesBody {
  success: boolean;
  data?: { dify?: { enabled?: boolean; missingEnv?: string[] } };
}

async function fetchFlag(): Promise<DifyFeatureFlag> {
  try {
    const body = (await adminApi.getFeatures()) as unknown as FeaturesBody;
    const dify = body?.data?.dify ?? {};
    return {
      loading: false,
      enabled: dify.enabled === true,
      missingEnv: Array.isArray(dify.missingEnv) ? dify.missingEnv : [],
    };
  } catch {
    return { loading: false, enabled: false, missingEnv: [] };
  }
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
