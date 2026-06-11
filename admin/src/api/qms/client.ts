/**
 * API Client for Sudoclaw QMS
 */

import axios, { AxiosError } from "axios";
import type { AxiosInstance } from "axios";
import type {
  ApiResponse,
  DashboardOverview,
  AlertConfig,
  AlertHistory,
  SystemStats,
  SystemConfig,
  PaginatedResponse,
  CrashIssue,
  CrashEvent,
  CrashStatsSummary,
  CrashTrendItem,
  CrashDistributionItem,
  UserConversationStats,
  UserTurnStats,
  UserStepStats,
  UserLeaderboardEntry,
  UserDetailStats,
  UserRealtimeStats,
} from "./types";
import { getStoredQmsTenantId } from "../../hooks/qms";

const API_BASE = "/api/v1/qms";
const TENANT_SCOPED_PREFIXES = ["/dashboard", "/user-stats", "/crash"];

function getAdminRole(): string | undefined {
  try {
    const user = JSON.parse(localStorage.getItem("admin_user") || "{}");
    return user?.role;
  } catch {
    return undefined;
  }
}

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Request interceptor - add auth token
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem("admin_token") || this.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      const tenantId = getStoredQmsTenantId();
      const url = config.url || "";
      if (
        getAdminRole() === "SUPER_ADMIN" &&
        tenantId &&
        TENANT_SCOPED_PREFIXES.some((prefix) => url.startsWith(prefix))
      ) {
        config.params = {
          ...(config.params || {}),
          tenant_id: tenantId,
        };
      }

      return config;
    });

    // Response interceptor - handle errors
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiResponse<never>>) => {
        if (error.response?.status === 401) {
          // Token expired or invalid
          this.clearToken();
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }
    );

    // Load token from localStorage
    this.loadToken();
  }

  private loadToken(): void {
    const token = localStorage.getItem("admin_token");
    if (token) {
      this.token = token;
    }
  }

  setToken(token: string): void {
    this.token = token;
    localStorage.setItem("admin_token", token);
  }

  clearToken(): void {
    this.token = null;
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
  }

  getToken(): string | null {
    return this.token;
  }

  // ============================================
  // Dashboard API
  // ============================================

  async getDashboardOverview(startTime?: number, endTime?: number): Promise<DashboardOverview> {
    const params = new URLSearchParams();
    if (startTime) params.set("start_time", startTime.toString());
    if (endTime) params.set("end_time", endTime.toString());

    try {
      const response = await this.client.get<ApiResponse<DashboardOverview>>(
        `/dashboard/overview?${params}`
      );
      if (response.data?.success && response.data?.data) {
        return response.data.data;
      }
      throw new Error(response.data?.error?.message || "Failed to get dashboard overview");
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Network error or server not available");
    }
  }

  async getPerfTrend(startTime?: number, endTime?: number, params?: {
    metric?: string;
    dimension?: string;
    platform?: string;
    arch?: string;
    version?: string;
  }): Promise<unknown[]> {
    const searchParams = new URLSearchParams();
    if (startTime) searchParams.set("start_time", startTime.toString());
    if (endTime) searchParams.set("end_time", endTime.toString());
    if (params?.metric) searchParams.set("metric", params.metric);
    if (params?.dimension) searchParams.set("dimension", params.dimension);
    if (params?.platform) searchParams.set("platform", params.platform);
    if (params?.arch) searchParams.set("arch", params.arch);
    if (params?.version) searchParams.set("version", params.version);

    const response = await this.client.get<ApiResponse<unknown[]>>(
      `/dashboard/perf/trend?${searchParams}`
    );
    return response.data.data || [];
  }

  async getPerfDimensions(startTime?: number, endTime?: number): Promise<{
    platforms: { platform: string; arch: string; label: string; value: string }[];
    versions: string[];
    metrics: string[];
  }> {
    const searchParams = new URLSearchParams();
    if (startTime) searchParams.set("start_time", startTime.toString());
    if (endTime) searchParams.set("end_time", endTime.toString());

    const response = await this.client.get<ApiResponse<{
      platforms: { platform: string; arch: string; label: string; value: string }[];
      versions: string[];
      metrics: string[];
    }>>(
      `/dashboard/perf/dimensions?${searchParams}`
    );
    return response.data.data || { platforms: [], versions: [], metrics: [] };
  }

  async getConversationTrend(startTime?: number, endTime?: number, dimension?: string): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (startTime) params.set("start_time", startTime.toString());
    if (endTime) params.set("end_time", endTime.toString());
    if (dimension) params.set("dimension", dimension);

    const response = await this.client.get<ApiResponse<unknown[]>>(
      `/dashboard/conversations/trend?${params}`
    );
    return response.data.data || [];
  }

  async getConversationDimensions(startTime?: number, endTime?: number): Promise<{
    platforms: { platform: string; arch: string; label: string; value: string }[];
    versions: string[];
  }> {
    const params = new URLSearchParams();
    if (startTime) params.set("start_time", startTime.toString());
    if (endTime) params.set("end_time", endTime.toString());

    const response = await this.client.get<ApiResponse<{
      platforms: { platform: string; arch: string; label: string; value: string }[];
      versions: string[];
    }>>(
      `/dashboard/conversations/dimensions?${params}`
    );
    return response.data.data || { platforms: [], versions: [] };
  }

  async getConversationErrorTrend(startTime?: number, endTime?: number, errorCode?: string): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (startTime) params.set("start_time", startTime.toString());
    if (endTime) params.set("end_time", endTime.toString());
    if (errorCode) params.set("error_code", errorCode);

    const response = await this.client.get<ApiResponse<unknown[]>>(
      `/dashboard/conversations/errors/trend?${params}`
    );
    return response.data.data || [];
  }

  async getInstallTrend(startTime?: number, endTime?: number, dimension?: string): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (startTime) params.set("start_time", startTime.toString());
    if (endTime) params.set("end_time", endTime.toString());
    if (dimension) params.set("dimension", dimension);

    const response = await this.client.get<ApiResponse<unknown[]>>(
      `/dashboard/installs/trend?${params}`
    );
    return response.data.data || [];
  }

  async getInstallDimensions(startTime?: number, endTime?: number): Promise<{
    platforms: { platform: string; arch: string; label: string; value: string }[];
    versions: string[];
    install_types: string[];
  }> {
    const params = new URLSearchParams();
    if (startTime) params.set("start_time", startTime.toString());
    if (endTime) params.set("end_time", endTime.toString());

    const response = await this.client.get<ApiResponse<{
      platforms: { platform: string; arch: string; label: string; value: string }[];
      versions: string[];
      install_types: string[];
    }>>(
      `/dashboard/installs/dimensions?${params}`
    );
    return response.data.data || { platforms: [], versions: [], install_types: [] };
  }

  // ============================================
  // Alerts API
  // ============================================

  async getAlertConfigs(): Promise<AlertConfig[]> {
    const response = await this.client.get<ApiResponse<AlertConfig[]>>("/alerts/configs");
    return response.data.data || [];
  }

  async getAlertConfig(id: string): Promise<AlertConfig> {
    const response = await this.client.get<ApiResponse<AlertConfig>>(`/alerts/configs/${id}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to get alert config");
  }

  async createAlertConfig(data: Partial<AlertConfig>): Promise<AlertConfig> {
    const response = await this.client.post<ApiResponse<AlertConfig>>("/alerts/configs", data);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to create alert config");
  }

  async updateAlertConfig(id: string, data: Partial<AlertConfig>): Promise<AlertConfig> {
    const response = await this.client.put<ApiResponse<AlertConfig>>(
      `/alerts/configs/${id}`,
      data
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to update alert config");
  }

  async deleteAlertConfig(id: string): Promise<void> {
    const response = await this.client.delete<ApiResponse<{ id: string }>>(
      `/alerts/configs/${id}`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message || "Failed to delete alert config");
    }
  }

  async testAlertConfig(id: string): Promise<void> {
    const response = await this.client.post<ApiResponse<{ message: string }>>(
      `/alerts/configs/${id}/test`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message || "Failed to test alert");
    }
  }

  async getAlertHistory(params?: {
    config_id?: string;
    level?: string;
    success?: boolean;
    acknowledged?: boolean;
  }): Promise<PaginatedResponse<AlertHistory>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<PaginatedResponse<AlertHistory>>>(
      `/alerts/history?${searchParams}`
    );
    return response.data.data || { data: [], total: 0, limit: 50, offset: 0 };
  }

  async acknowledgeAlert(id: number): Promise<void> {
    const response = await this.client.post<ApiResponse<{ id: number }>>(
      `/alerts/history/${id}/acknowledge`
    );
    if (!response.data.success) {
      throw new Error(response.data.error?.message || "Failed to acknowledge alert");
    }
  }

  // ============================================
  // System API
  // ============================================

  async getSystemStats(): Promise<SystemStats> {
    const response = await this.client.get<ApiResponse<SystemStats>>("/system/stats");
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to get system stats");
  }

  async getSystemConfigs(): Promise<SystemConfig[]> {
    const response = await this.client.get<ApiResponse<SystemConfig[]>>("/system/config");
    return response.data.data || [];
  }

  async updateSystemConfig(key: string, value: string): Promise<SystemConfig> {
    const response = await this.client.put<ApiResponse<SystemConfig>>(
      `/system/config/${key}`,
      { value }
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to update config");
  }

  async getNotificationConfig(): Promise<{
    lark: { webhookUrl: string };
    email: {
      smtpHost: string;
      smtpPort: number;
      smtpUser: string;
      smtpPass: string;
      from: string;
      to: string;
    };
  }> {
    const response = await this.client.get<
      ApiResponse<{
        lark: { webhookUrl: string };
        email: {
          smtpHost: string;
          smtpPort: number;
          smtpUser: string;
          smtpPass: string;
          from: string;
          to: string;
        };
      }>
    >("/system/notifications");
    return response.data.data || {
      lark: { webhookUrl: "" },
      email: { smtpHost: "", smtpPort: 587, smtpUser: "", smtpPass: "", from: "", to: "" },
    };
  }

  async updateNotificationConfig(config: {
    lark?: { webhookUrl?: string };
    email?: {
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPass?: string;
      from?: string;
      to?: string;
    };
  }): Promise<void> {
    const response = await this.client.put<ApiResponse<void>>("/system/notifications", config);
    if (!response.data.success) {
      throw new Error(response.data.error?.message || "Failed to update notification config");
    }
  }

  async testNotification(channel: "lark" | "email"): Promise<void> {
    const response = await this.client.post<ApiResponse<void>>(`/system/notifications/test/${channel}`);
    if (!response.data.success) {
      throw new Error(response.data.error?.message || "Test notification failed");
    }
  }

  async getScheduledTasks(): Promise<{ name: string; last_run: number | null; next_run: number; running: boolean; last_error: string | null }[]> {
    const response = await this.client.get<
      ApiResponse<{ name: string; last_run: number | null; next_run: number; running: boolean; last_error: string | null }[]>
    >("/system/tasks");
    return response.data.data || [];
  }

  async runAggregationTasks(): Promise<{
    results: { task: string; success: boolean; error?: string }[];
    timestamp: number;
  }> {
    const response = await this.client.post<
      ApiResponse<{
        results: { task: string; success: boolean; error?: string }[];
        timestamp: number;
      }>
    >("/system/aggregation/run");
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "聚合任务执行失败");
  }

  async getRawStats(): Promise<{ table: string; label: string; count: number; earliest: string | null; latest: string | null }[]> {
    const response = await this.client.get<
      ApiResponse<{ table: string; label: string; count: number; earliest: string | null; latest: string | null }[]>
    >("/system/raw-stats");
    return response.data.data || [];
  }

  async backfillAggregation(days: number): Promise<void> {
    const response = await this.client.post<ApiResponse<void>>("/system/aggregation/backfill", { days });
    if (!response.data.success) {
      throw new Error(response.data.error?.message || "历史数据回填失败");
    }
  }

  async getErrorCodeDefinitions(): Promise<{ code: string; type: string; location: string; upstream_component: string; trigger_scenario: string }[]> {
    const response = await this.client.get<
      ApiResponse<{ code: string; type: string; location: string; upstream_component: string; trigger_scenario: string }[]>
    >("/system/error-codes");
    return response.data.data || [];
  }

  // ============================================
  // Crash API
  // ============================================

  async getCrashIssues(params?: {
    status?: string;
    level?: string;
    type?: string;
    version?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<CrashIssue>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<PaginatedResponse<CrashIssue>>>(
      `/crash/issues?${searchParams}`
    );
    return response.data.data || { data: [], total: 0, limit: 50, offset: 0 };
  }

  async getCrashIssue(id: number): Promise<CrashIssue & { events: CrashEvent[] }> {
    const response = await this.client.get<ApiResponse<CrashIssue & { events: CrashEvent[] }>>(
      `/crash/issues/${id}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to get crash issue");
  }

  async updateCrashIssue(id: number, data: { status?: string; assigned_to?: number }): Promise<CrashIssue> {
    const response = await this.client.put<ApiResponse<CrashIssue>>(
      `/crash/issues/${id}`,
      data
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to update crash issue");
  }

  async resolveCrashIssue(id: number): Promise<CrashIssue> {
    const response = await this.client.post<ApiResponse<CrashIssue>>(
      `/crash/issues/${id}/resolve`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to resolve crash issue");
  }

  async ignoreCrashIssue(id: number): Promise<CrashIssue> {
    const response = await this.client.post<ApiResponse<CrashIssue>>(
      `/crash/issues/${id}/ignore`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to ignore crash issue");
  }

  async getCrashEvents(params?: {
    issue_id?: number;
    version?: string;
    platform?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<CrashEvent>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<PaginatedResponse<CrashEvent>>>(
      `/crash/events?${searchParams}`
    );
    return response.data.data || { data: [], total: 0, limit: 100, offset: 0 };
  }

  async getCrashEvent(id: number): Promise<CrashEvent> {
    const response = await this.client.get<ApiResponse<CrashEvent>>(`/crash/events/${id}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to get crash event");
  }

  async getCrashStatsSummary(): Promise<CrashStatsSummary> {
    const response = await this.client.get<ApiResponse<CrashStatsSummary>>("/crash/stats/summary");
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to get crash stats summary");
  }

  async getCrashTrend(days?: number): Promise<CrashTrendItem[]> {
    const params = new URLSearchParams();
    if (days) params.set("days", days.toString());

    const response = await this.client.get<ApiResponse<CrashTrendItem[]>>(
      `/crash/stats/trend?${params}`
    );
    return response.data.data || [];
  }

  async getCrashDistribution(by?: "version" | "platform" | "type"): Promise<CrashDistributionItem[]> {
    const params = new URLSearchParams();
    if (by) params.set("by", by);

    const response = await this.client.get<ApiResponse<CrashDistributionItem[]>>(
      `/crash/stats/distribution?${params}`
    );
    return response.data.data || [];
  }

  // ============================================
  // User Stats API
  // ============================================

  async getUserConversationStats(params?: {
    start_time?: number;
    end_time?: number;
    org_id?: string;
    tenant_id?: string;
    login_mode?: "enterprise" | "personal";
    order?: "asc" | "desc";
    limit?: number;
  }): Promise<UserConversationStats[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<UserConversationStats[]>>(
      `/user-stats/conversations?${searchParams}`
    );
    return response.data.data || [];
  }

  async getUserTurnStats(params?: {
    start_time?: number;
    end_time?: number;
    user_id?: string;
    login_mode?: "enterprise" | "personal";
    order?: "asc" | "desc";
    limit?: number;
  }): Promise<UserTurnStats[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<UserTurnStats[]>>(
      `/user-stats/turns?${searchParams}`
    );
    return response.data.data || [];
  }

  async getUserStepStats(params?: {
    start_time?: number;
    end_time?: number;
    user_id?: string;
    step_type?: string;
    login_mode?: "enterprise" | "personal";
    order?: "asc" | "desc";
    limit?: number;
  }): Promise<UserStepStats[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<UserStepStats[]>>(
      `/user-stats/steps?${searchParams}`
    );
    return response.data.data || [];
  }

  async getUserLeaderboard(
    type: "conversations" | "turns" | "steps" | "tokens",
    params?: {
      start_time?: number;
      end_time?: number;
      login_mode?: "enterprise" | "personal";
      order?: "asc" | "desc";
      limit?: number;
    }
  ): Promise<UserLeaderboardEntry[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<UserLeaderboardEntry[]>>(
      `/user-stats/leaderboard/${type}?${searchParams}`
    );
    return response.data.data || [];
  }

  async getUserDetail(userId: string, params?: {
    start_time?: number;
    end_time?: number;
  }): Promise<UserDetailStats> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.set(key, value.toString());
      });
    }

    const response = await this.client.get<ApiResponse<UserDetailStats>>(
      `/user-stats/users/${userId}?${searchParams}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to get user detail");
  }

  async getUserRealtimeStats(startTime?: number, endTime?: number): Promise<UserRealtimeStats> {
    const searchParams = new URLSearchParams();
    if (startTime) searchParams.set("start_time", startTime.toString());
    if (endTime) searchParams.set("end_time", endTime.toString());

    const response = await this.client.get<ApiResponse<UserRealtimeStats>>(
      `/user-stats/realtime?${searchParams}`
    );
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error?.message || "Failed to get realtime stats");
  }
}

export const api = new ApiClient();
export default api;
