/**
 * Alert type definitions
 */

// ============================================
// Alert Config Types
// ============================================

export type AlertType = "perf" | "error" | "conversation" | "install" | "crash" | "system";
export type AlertLevel = "info" | "warning" | "critical";
export type AlertComparison = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

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

export interface CreateAlertConfigInput {
  name: string;
  type: AlertType;
  metric: string;
  threshold: number;
  comparison: AlertComparison;
  level: AlertLevel;
  channels: AlertChannel[];
  enabled?: boolean;
  cooldown_minutes?: number;
  description?: string;
}

export interface UpdateAlertConfigInput {
  name?: string;
  threshold?: number;
  comparison?: AlertComparison;
  level?: AlertLevel;
  channels?: AlertChannel[];
  enabled?: boolean;
  cooldown_minutes?: number;
  description?: string;
}

// ============================================
// Alert History Types
// ============================================

export interface AlertHistory {
  id: number;
  config_id: string;
  type: AlertType;
  title: string;
  detail?: string;
  level: AlertLevel;
  channels: AlertChannel[];
  sent_at: number;
  success: boolean;
  error_message?: string;
  acknowledged: boolean;
  acknowledged_at?: number;
  acknowledged_by?: string;
}

export interface AlertHistoryQuery {
  config_id?: string;
  type?: AlertType;
  level?: AlertLevel;
  success?: boolean;
  acknowledged?: boolean;
  start_time?: number;
  end_time?: number;
  limit?: number;
  offset?: number;
}

// ============================================
// Notification Types
// ============================================

export type AlertChannel = "lark" | "email";

export interface AlertPayload {
  title: string;
  message: string;
  level: AlertLevel;
  type: AlertType;
  detail?: string;
  timestamp: number;
}

export interface LarkConfig {
  webhook_url: string;
}

export interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  from: string;
  to: string[];
}

// ============================================
// Alert Check Context
// ============================================

export interface AlertCheckContext {
  type: AlertType;
  metric: string;
  value: number;
  config: AlertConfig;
  timestamp: number;
}
