/**
 * Telemetry type definitions
 */

// ============================================
// Raw Telemetry Data Types
// ============================================

export interface PerfRawData {
  timestamp: number;
  version: string;
  platform: string;
  arch?: string;
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  agent_type?: string;
  user_nickname?: string;
  user_phone?: string;
  metric: string;
  value_ms: number;
  session_id?: string;
}

export interface ConversationRawData {
  timestamp: number;
  version: string;
  platform: string;
  arch?: string;
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  agent_type?: string;
  user_nickname?: string;
  user_phone?: string;
  session_id: string;
  model_id: string;
  model_provider?: string;
  status: "success" | "error" | "user_cancel";
  duration_ms: number;
  tokens_used?: number;
  input_tokens?: number;
  output_tokens?: number;
  error_code?: string;
}

export interface TurnRawData {
  timestamp: number;
  version: string;
  platform: string;
  arch?: string;
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  agent_type?: string;
  user_nickname?: string;
  user_phone?: string;
  turn_id: string;
  session_id: string;
  model_id: string;
  model_provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  duration_ms: number;
  status: "success" | "error";
  error_code?: string;
}

export interface StepRawData {
  timestamp: number;
  version: string;
  platform: string;
  arch?: string;
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  agent_type?: string;
  user_nickname?: string;
  user_phone?: string;
  step_id: string;
  turn_id: string;
  session_id: string;
  step_type: "tool_call" | "permission_request" | "file_operation" | "thinking";
  tool_name?: string;
  tool_kind?: "read" | "edit" | "execute";
  file_path?: string;
  permission_kind?: string;
  thinking_tokens?: number;
  duration_ms?: number;
  status: "success" | "error" | "pending";
}

export interface InstallRawData {
  install_id: string;
  timestamp: number;
  version: string;
  platform: string;
  arch?: string;
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  agent_type?: string;
  user_nickname?: string;
  user_phone?: string;
  status: "success" | "failed";
  duration_ms: number;
  install_type?: "fresh" | "update";
  previous_version?: string;
  error_message?: string;
}

// ============================================
// Telemetry Upload Request Types
// ============================================

export interface TelemetryBatchRequest {
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  agent_type?: string;
  user_nickname?: string;
  user_phone?: string;
  events?: unknown[];
  perf?: PerfRawData[];
  conversations?: ConversationRawData[];
  turns?: TurnRawData[];
  steps?: StepRawData[];
  installs?: InstallRawData[];
}

export interface TelemetryPerfRequest extends PerfRawData {}
export interface TelemetryConversationRequest extends ConversationRawData {}
export interface TelemetryTurnRequest extends TurnRawData {}
export interface TelemetryStepRequest extends StepRawData {}
export interface TelemetryInstallRequest extends InstallRawData {}

// ============================================
// Daily Aggregation Types
// ============================================

export interface PerfDailyAgg {
  date: string;
  version: string;
  platform: string;
  arch: string;
  metric: string;
  p50: number;
  p90: number;
  p95: number;
  p99?: number;
  min_value: number;
  max_value: number;
  avg_value: number;
  count: number;
}

export interface ConversationsDailyAgg {
  date: string;
  version: string;
  platform: string;
  arch: string;
  success_count: number;
  error_count: number;
  user_cancel_count: number;
  total_count: number;
  avg_duration_ms: number;
  avg_tokens?: number;
  success_rate: number;
  error_rate: number;
}

export interface InstallDailyAgg {
  date: string;
  version: string;
  platform: string;
  arch: string;
  install_type: string;
  success_count: number;
  failed_count: number;
  total_count: number;
  avg_duration_ms: number;
  success_rate: number;
}

export interface TurnsDailyAgg {
  date: string;
  version: string;
  platform: string;
  arch: string;
  model_id: string;
  model_provider?: string;
  success_count: number;
  error_count: number;
  total_count: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_duration_ms: number;
  success_rate: number;
}

export interface StepsDailyAgg {
  date: string;
  version: string;
  platform: string;
  arch: string;
  step_type: string;
  success_count: number;
  error_count: number;
  total_count: number;
  avg_duration_ms: number;
  success_rate: number;
}

// ============================================
// User Statistics Types
// ============================================

export interface UserConversationStats {
  user_id: string;
  org_id?: string;
  tenant_id?: string;
  login_mode?: string;
  user_nickname?: string;
  user_phone?: string;
  conversation_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  avg_duration_ms: number;
  success_count: number;
  success_rate: number;
  error_count: number;
}

export interface UserTurnStats {
  user_id: string;
  org_id?: string;
  tenant_id?: string;
  login_mode?: string;
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
  login_mode?: string;
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
  login_mode?: string;
  user_nickname?: string;
  user_phone?: string;
  value: number;
  trend?: number; // percentage change from previous period
}

export interface UserStatsQuery extends TimeRangeQuery {
  org_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  order?: "asc" | "desc";
  limit?: number;
}

export interface UserTurnStatsQuery extends TimeRangeQuery {
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  order?: "asc" | "desc";
  limit?: number;
}

export interface UserStepStatsQuery extends TimeRangeQuery {
  user_id?: string;
  tenant_id?: string;
  step_type?: string;
  login_mode?: "enterprise" | "personal";
  order?: "asc" | "desc";
  limit?: number;
}

export interface UserLeaderboardQuery extends TimeRangeQuery {
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  order?: "asc" | "desc";
  limit?: number;
}

export interface UserRealtimeStats {
  total_users: number;
  total_conversations: number;
  total_turns: number;
  total_steps: number;
  total_tokens: number;
}

// ============================================
// Dashboard Summary Types
// ============================================

export interface PerfSummary {
  metric: string;
  p50: number;
  p90: number;
  p95: number;
  p99?: number;
  avg: number;
  count: number;
  trend: number; // percentage change from previous period
}

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

export interface InstallSummary {
  total: number;
  success: number;
  failed: number;
  success_rate: number;
  avg_duration_ms: number;
  by_version: { version: string; count: number }[];
  by_platform: { platform: string; count: number }[];
}

export interface DashboardOverview {
  period: {
    start: number;
    end: number;
  };
  conversations: ConversationSummary;
  errors: {
    total: number;
    error_rate: number;
    top_errors: { error_code: string; count: number; trend: number; last_occurrence: number }[];
  };
  performance: {
    metrics: PerfSummary[];
  };
  installs: InstallSummary;
}

// ============================================
// Query Types
// ============================================

export interface TimeRangeQuery {
  start_time?: number;
  end_time?: number;
  tenant_id?: string;
  version?: string;
  platform?: string;
}

export interface PerfQuery extends TimeRangeQuery {
  metric?: string;
}

export interface ConversationQuery extends TimeRangeQuery {
  status?: string;
  model_id?: string;
}

export interface InstallQuery extends TimeRangeQuery {
  install_type?: string;
  status?: string;
}

// ============================================
// Trend Data Types
// ============================================

export interface TrendDataPoint {
  timestamp: number;
  value: number;
}

export interface PerfTrend {
  metric: string;
  data: TrendDataPoint[];
}

export interface ConversationTrend {
  data: {
    timestamp: number;
    total: number;
    success: number;
    error: number;
  }[];
}
