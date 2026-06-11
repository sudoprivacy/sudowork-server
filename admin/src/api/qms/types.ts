/**
 * API types matching backend
 */

// User types
export type UserRole = "admin" | "operator" | "viewer";

export interface User {
  id: string;
  username: string;
  email?: string;
  display_name?: string;
  role: UserRole;
  enabled: boolean;
  last_login_at?: number;
  created_at: number;
  updated_at: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expires_at: number;
  user: User;
}

// Dashboard types
export interface ConversationSummary {
  total: number;
  success: number;
  error: number;
  user_cancel: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_tokens: number;
  trend: number;
}

export interface ErrorSummary {
  error_code: string;
  count: number;
  last_occurrence: number;
  trend: number;
}

export interface PerfSummary {
  metric: string;
  p50: number;
  p90: number;
  p95: number;
  p99?: number;
  avg: number;
  count: number;
  trend: number;
}

export interface InstallSummary {
  total: number;
  success: number;
  failed: number;
  success_rate: number;
  avg_duration_ms: number;
  by_version: { version: string; count: number }[];
  by_platform: { platform: string; count: number }[];
}

export interface CrashSummary {
  total: number;
  trend: number;
  by_type: { type: string; count: number }[];
  by_platform: { platform: string; count: number }[];
  by_version: { version: string; count: number }[];
  by_process: { process_type: string; count: number }[];
}

export interface DashboardOverview {
  period: { start: number; end: number };
  conversations: ConversationSummary;
  errors: {
    total: number;
    error_rate: number;
    top_errors: ErrorSummary[];
    trend: number;
  };
  performance: {
    metrics: PerfSummary[];
  };
  installs: InstallSummary;
  crashes: CrashSummary;
}

// Alert types
export type AlertType = "perf" | "error" | "conversation" | "install" | "crash";
export type AlertLevel = "info" | "warning" | "critical";
export type AlertComparison = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
export type AlertChannel = "lark" | "email";

export interface AlertConfig {
  id: string;
  name: string;
  type: AlertType;
  metric: string;
  threshold: number;
  comparison: AlertComparison;
  level: AlertLevel;
  channels: AlertChannel[];
  enabled: boolean;
  cooldown_minutes: number;
  description?: string;
  created_at: number;
  updated_at: number;
}

export interface AlertHistory {
  id: number;
  config_id: string;
  type: AlertType;
  title: string;
  detail?: string;
  level: AlertLevel;
  channels: AlertChannel[];
  channel_results?: { channel: AlertChannel; success: boolean; error?: string }[];
  sent_at: number;
  success: boolean;
  error_message?: string;
  acknowledged: boolean;
  acknowledged_at?: number;
  acknowledged_by?: string;
}

// API Key types
export type ApiKeyPermission =
  | "telemetry:write"
  | "telemetry:read"
  | "alerts:write"
  | "alerts:read"
  | "system:read"
  | "system:write";

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  permissions: ApiKeyPermission[];
  last_used_at?: number;
  expires_at?: number;
  created_at: number;
  owner_name?: string;
}

// System types
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
    tables: { name: string; count: number }[];
  };
}

export interface SystemConfig {
  key: string;
  value: string;
  description?: string;
  updated_at: number;
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// Paginated response
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================
// Crash types
// ============================================

export type CrashEventType = "native_crash" | "renderer_crash" | "js_exception";
export type ProcessType = "main" | "renderer";
export type CrashLevel = "fatal" | "error" | "warning";
export type CrashStatus = "unresolved" | "resolved" | "ignored";

export interface CrashEvent {
  id: number;
  timestamp: number;
  version: string;
  platform: string;
  arch: string;
  process_type: ProcessType;
  type: CrashEventType;
  crash_reason?: string;
  exit_code?: number;
  signal?: string;
  error_name?: string;
  error_message?: string;
  stack_trace?: string;
  context?: string;
  release?: string;
  environment?: string;
  fingerprint: string;
  issue_id: number;
  created_at: number;
  issue_title?: string;
  issue_level?: CrashLevel;
  issue_status?: CrashStatus;
}

export interface CrashIssue {
  id: number;
  fingerprint: string;
  title: string;
  type: CrashEventType;
  level: CrashLevel;
  count: number;
  user_count?: number;
  first_seen: number;
  last_seen: number;
  status: CrashStatus;
  assigned_to?: number;
  first_release?: string;
  last_release?: string;
  stack_summary?: string;
  created_at: number;
  updated_at: number;
}

export interface CrashStatsSummary {
  total_events: number;
  unresolved_issues: number;
  fatal_issues: number;
  error_issues: number;
  recent_24h: number;
  recent_7d: number;
}

export interface CrashTrendItem {
  date: string;
  type: CrashEventType;
  count: number;
}

export interface CrashDistributionItem {
  key: string;
  count: number;
  percentage: number;
}

// ============================================
// User Stats types
// ============================================

export interface UserConversationStats {
  user_id: string;
  org_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  user_nickname?: string;
  user_phone?: string;
  conversation_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  avg_duration_ms: number;
  success_rate: number;
  error_count: number;
}

export interface UserTurnStats {
  user_id: string;
  org_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  user_nickname?: string;
  user_phone?: string;
  turn_count: number;
  total_tokens: number;
  avg_tokens_per_turn: number;
  success_rate: number;
}

export interface UserStepStats {
  user_id: string;
  org_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  user_nickname?: string;
  user_phone?: string;
  step_type: string;
  step_count: number;
  success_count: number;
  error_count: number;
  success_rate: number;
  avg_duration_ms: number;
}

export interface UserLeaderboardEntry {
  rank: number;
  user_id: string;
  org_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  user_nickname?: string;
  user_phone?: string;
  value: number;
  trend?: number;
}

export interface UserRealtimeStats {
  total_users: number;
  total_conversations: number;
  total_turns: number;
  total_steps: number;
  total_tokens: number;
}

export interface UserDetailStats {
  user_id: string;
  user_nickname?: string;
  user_phone?: string;
  conversations: {
    conversation_count?: number;
    total_tokens?: number;
    avg_duration_ms?: number;
    success_rate?: number;
  };
  turns: {
    turn_count?: number;
    total_tokens?: number;
    avg_tokens_per_turn?: number;
  };
  steps: {
    step_type: string;
    count: number;
    success_rate: number;
  }[];
  model_usage: {
    model_id: string;
    count: number;
  }[];
}