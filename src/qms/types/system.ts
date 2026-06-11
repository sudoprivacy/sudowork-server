/**
 * System type definitions
 */

// ============================================
// System Config Types
// ============================================

export interface SystemConfig {
  key: string;
  value: string;
  description?: string;
  updated_at: number;
}

export interface SystemConfigInput {
  key: string;
  value: string;
  description?: string;
}

export interface SystemConfigUpdate {
  value: string;
}

// ============================================
// System Stats Types
// ============================================

export interface SystemStats {
  uptime: number;
  version: string;
  node_version: string;
  platform: string;
  memory_usage: {
    rss: number;
    heap_total: number;
    heap_used: number;
    external: number;
  };
  database: {
    size: number;
    tables: {
      name: string;
      count: number;
    }[];
  };
}

// ============================================
// Pagination Types
// ============================================

export interface PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================
// Health Check Types
// ============================================

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  checks: {
    database: boolean;
  };
}