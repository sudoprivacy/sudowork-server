/**
 * Crash Reporter type definitions
 */

/**
 * Crash event type
 */
export type CrashEventType = "native_crash" | "renderer_crash" | "js_exception";

/**
 * Process type
 */
export type ProcessType = "main" | "renderer";

/**
 * Crash event data structure (from client)
 */
export interface CrashEvent {
  // Basic info
  type: CrashEventType;
  timestamp: number;
  version: string;
  platform: string;
  arch: string;
  org_id?: string;
  user_id?: string;
  tenant_id?: string;
  login_mode?: "enterprise" | "personal";
  agent_type?: string;
  user_nickname?: string;
  user_phone?: string;
  process_type: ProcessType;

  // Native crash details
  crash_reason?: string; // Crash reason (killed, crashed, oom, etc.)
  exit_code?: number;
  signal?: string;

  // JS exception details
  error_name?: string; // Error type name (TypeError, ReferenceError, etc.)
  error_message?: string; // Error message
  stack_trace?: string; // Stack trace

  // Context
  context?: CrashContext;

  // Release info
  release?: string;
  environment?: string;
}

/**
 * Crash context
 */
export interface CrashContext {
  component?: string;
  operation?: string;
  session_id?: string;
  breadcrumbs?: Breadcrumb[];
  [key: string]: unknown;
}

/**
 * Breadcrumb record
 */
export interface Breadcrumb {
  timestamp: number;
  category: string; // conversation, api, file, window, mcp
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Batch upload request
 */
export interface CrashBatchRequest {
  events: CrashEvent[];
}

/**
 * Upload response
 */
export interface CrashBatchResponse {
  success: boolean;
  received: number;
  error?: string;
}

/**
 * Crash Issue (aggregated)
 */
export interface CrashIssue {
  id: number;
  fingerprint: string;
  tenant_id?: string;
  title: string;
  type: CrashEventType;
  level: "fatal" | "error" | "warning";
  count: number;
  user_count?: number;
  first_seen: number;
  last_seen: number;
  status: "unresolved" | "resolved" | "ignored";
  assigned_to?: number;
  first_release?: string;
  last_release?: string;
  stack_summary?: string;
  created_at: number;
  updated_at: number;
}

/**
 * Crash Issue update request
 */
export interface CrashIssueUpdateRequest {
  status?: "unresolved" | "resolved" | "ignored";
  assigned_to?: number;
}

/**
 * Crash statistics summary
 */
export interface CrashStatsSummary {
  total_events: number;
  unresolved_issues: number;
  fatal_issues: number;
  error_issues: number;
  recent_24h: number;
  recent_7d: number;
}

/**
 * Crash trend data
 */
export interface CrashTrendItem {
  date: string;
  count: number;
  type: CrashEventType;
}

/**
 * Crash distribution data
 */
export interface CrashDistributionItem {
  key: string; // version, platform, or type
  count: number;
  percentage: number;
}

/**
 * Query options for crash issues
 */
export interface CrashIssueQueryOptions {
  status?: string;
  level?: string;
  type?: string;
  version?: string;
  tenant_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * Query options for crash events
 */
export interface CrashEventQueryOptions {
  issue_id?: number;
  version?: string;
  platform?: string;
  type?: string;
  tenant_id?: string;
  limit?: number;
  offset?: number;
}
