/**
 * Sudorouter API 服务封装
 * 用于用户创建、令牌管理、额度查询等操作
 *
 * 积分换算规则：
 * - 积分 = 额度 * 0.002
 * - 初始额度 500000 = 初始积分 1000
 */

// 积分换算系数：额度 * 0.002 = 积分
const POINTS_CONVERSION_RATE = 0.002;

interface SudorouterConfig {
  baseUrl: string;
  apiToken: string;
  adminUserId: string;
  initialQuota: number;
  timeoutMs: number;
  modelServiceUrl: string;
  modelsApiUrl: string;
}

interface SudorouterUser {
  id: number;
  username: string;
}

interface SudorouterToken {
  key: string;
}

interface SudorouterUserInfo {
  id: number;
  username: string;
  quota: number;
  used_quota: number;
  request_count: number;
}

interface UsageLog {
  id: number;
  user_id: number;
  created_at: number;
  type: number;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  channel: number;
  is_stream: boolean;
}

interface UsageLogsResponse {
  success: boolean;
  message: string;
  data: {
    count: number;
    data: UsageLog[];
  };
}

// API 调用结果接口（包含请求/响应详情用于日志记录）
interface ApiCallResult<T> {
  success: boolean;
  data: T | null;
  request: {
    method: string;
    url: string;
    body?: any;
  };
  response: {
    status: number;
    data: any;
  };
  duration_ms: number;
  error?: string;
}

// 带超时的 fetch
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

class SudorouterService {
  private config: SudorouterConfig;
  private modelsCache: { data: string[]; timestamp: number } | null = null;
  private modelsCacheTtl = 24 * 60 * 60 * 1000; // 24 小时缓存

  constructor() {
    this.config = {
      baseUrl: process.env.SUDOROUTER_BASE_URL || "http://10.0.1.8:3000",
      apiToken: process.env.SUDOROUTER_API_TOKEN || "",
      adminUserId: process.env.SUDOROUTER_ADMIN_USER_ID || "13",
      initialQuota: parseInt(process.env.USER_INITIAL_QUOTA || "100000"),
      timeoutMs: parseInt(process.env.SUDOROUTER_TIMEOUT_MS || "10000"),
      modelServiceUrl: process.env.SUDOROUTER_MODEL_SERVICE_URL || "",
      modelsApiUrl: process.env.SUDOROUTER_MODELS_API_URL || "https://chat.sudorouter.ai/api/specific_pricing",
    };
  }

  private getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiToken}`,
      "New-Api-User": this.config.adminUserId,
    };
  }

  // 创建用户（返回详细结果用于日志）
  async createUserWithLog(phone: string): Promise<ApiCallResult<SudorouterUser>> {
    const url = `${this.config.baseUrl}/api/user/`;
    const body = {
      username: phone,
      password: phone,
      display_name: phone,
      role: 1,
      utm_source: "sudowork",
    };

    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      }, this.config.timeoutMs);

      const data = await response.json();
      const duration = Date.now() - startTime;

      if (data.success && data.data) {
        console.log(`[Sudorouter] 用户创建成功: ${phone}, ID: ${data.data.id}`);
        return {
          success: true,
          data: data.data,
          request: { method: "POST", url, body },
          response: { status: response.status, data },
          duration_ms: duration,
        };
      }

      console.error(`[Sudorouter] 用户创建失败:`, data.message);
      return {
        success: false,
        data: null,
        request: { method: "POST", url, body },
        response: { status: response.status, data },
        duration_ms: duration,
        error: data.message || "创建用户失败",
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error(`[Sudorouter] 用户创建异常:`, errorMsg);
      return {
        success: false,
        data: null,
        request: { method: "POST", url, body },
        response: { status: 0, data: null },
        duration_ms: duration,
        error: errorMsg,
      };
    }
  }

  // 简化版创建用户（兼容旧代码）
  async createUser(phone: string): Promise<SudorouterUser | null> {
    const result = await this.createUserWithLog(phone);
    return result.data;
  }

  // 创建令牌（返回详细结果用于日志）
  async createTokenWithLog(
    sudorouterUserId: number,
    phone: string,
    unlimitedQuota: boolean = true,
  ): Promise<ApiCallResult<string>> {
    const url = `${this.config.baseUrl}/api/token/`;
    const body = {
      name: `${phone}-token`,
      expired_time: -1,
      unlimited_quota: unlimitedQuota,
      user_id: sudorouterUserId,
    };

    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      }, this.config.timeoutMs);

      const data = (await response.json()) as any;
      const duration = Date.now() - startTime;

      if (data.success && data.data?.key) {
        console.log(
          `[Sudorouter] 令牌创建成功: userId=${sudorouterUserId}, unlimited_quota=${unlimitedQuota}`,
        );
        return {
          success: true,
          data: data.data.key,
          request: { method: "POST", url, body },
          response: { status: response.status, data },
          duration_ms: duration,
        };
      }

      console.error(`[Sudorouter] 令牌创建失败:`, data.message);
      return {
        success: false,
        data: null,
        request: { method: "POST", url, body },
        response: { status: response.status, data },
        duration_ms: duration,
        error: data.message || "创建令牌失败",
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error(`[Sudorouter] 令牌创建异常:`, errorMsg);
      return {
        success: false,
        data: null,
        request: { method: "POST", url, body },
        response: { status: 0, data: null },
        duration_ms: duration,
        error: errorMsg,
      };
    }
  }

  // 简化版创建令牌（兼容旧代码）
  async createToken(
    sudorouterUserId: number,
    phone: string,
    unlimitedQuota: boolean = true,
  ): Promise<string | null> {
    const result = await this.createTokenWithLog(sudorouterUserId, phone, unlimitedQuota);
    return result.data;
  }

  // 获取用户信息（返回详细结果用于日志）
  async getUserWithLog(sudorouterUserId: number): Promise<ApiCallResult<SudorouterUserInfo>> {
    const url = `${this.config.baseUrl}/api/user/${sudorouterUserId}`;

    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: "GET",
        headers: this.getHeaders(),
      }, this.config.timeoutMs);

      const data = await response.json();
      const duration = Date.now() - startTime;

      if (data.success && data.data) {
        return {
          success: true,
          data: data.data,
          request: { method: "GET", url },
          response: { status: response.status, data },
          duration_ms: duration,
        };
      }

      console.error(`[Sudorouter] 获取用户信息失败:`, data.message);
      return {
        success: false,
        data: null,
        request: { method: "GET", url },
        response: { status: response.status, data },
        duration_ms: duration,
        error: data.message || "获取用户信息失败",
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error(`[Sudorouter] 获取用户信息异常:`, errorMsg);
      return {
        success: false,
        data: null,
        request: { method: "GET", url },
        response: { status: 0, data: null },
        duration_ms: duration,
        error: errorMsg,
      };
    }
  }

  // 简化版获取用户信息（兼容旧代码）
  async getUser(sudorouterUserId: number): Promise<SudorouterUserInfo | null> {
    const result = await this.getUserWithLog(sudorouterUserId);
    return result.data;
  }

  // 更新用户额度（返回详细结果用于日志）
  async updateUserQuotaWithLog(
    sudorouterUserId: number,
    quotaDelta: number,
    comment?: string,
  ): Promise<ApiCallResult<boolean>> {
    const url = `${this.config.baseUrl}/api/user/quota`;
    const body = {
      id: sudorouterUserId,
      quota: quotaDelta,
      comment: comment || "",
    };

    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      }, this.config.timeoutMs);

      const data = await response.json();
      const duration = Date.now() - startTime;

      if (data.success) {
        console.log(
          `[Sudorouter] 额度更新成功: userId=${sudorouterUserId}, delta=${quotaDelta}`,
        );
        return {
          success: true,
          data: true,
          request: { method: "PUT", url, body },
          response: { status: response.status, data },
          duration_ms: duration,
        };
      }

      console.error(`[Sudorouter] 额度更新失败:`, data.message);
      return {
        success: false,
        data: false,
        request: { method: "PUT", url, body },
        response: { status: response.status, data },
        duration_ms: duration,
        error: data.message || "更新额度失败",
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error(`[Sudorouter] 额度更新异常:`, errorMsg);
      return {
        success: false,
        data: false,
        request: { method: "PUT", url, body },
        response: { status: 0, data: null },
        duration_ms: duration,
        error: errorMsg,
      };
    }
  }

  // 简化版更新用户额度（兼容旧代码）
  async updateUserQuota(
    sudorouterUserId: number,
    quotaDelta: number,
    comment?: string,
  ): Promise<boolean> {
    const result = await this.updateUserQuotaWithLog(sudorouterUserId, quotaDelta, comment);
    return result.success && result.data === true;
  }

  async getUsageLogs(
    sudorouterUserId: number,
    timeFrom: number,
    timeTo: number,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<UsageLogsResponse | null> {
    try {
      const params = new URLSearchParams({
        user_id: sudorouterUserId.toString(),
        time_from: timeFrom.toString(),
        time_to: timeTo.toString(),
        page_num: page.toString(),
        page_size: pageSize.toString(),
        order_by: "created_at",
        desc: "true",
      });

      const response = await fetchWithTimeout(
        `${this.config.baseUrl}/api/log/?${params.toString()}`,
        {
          method: "GET",
          headers: this.getHeaders(),
        },
        this.config.timeoutMs
      );

      const data = await response.json();

      if (data.success) {
        return data;
      }

      console.error(`[Sudorouter] 获取使用日志失败:`, data.message);
      return null;
    } catch (error) {
      console.error(`[Sudorouter] 获取使用日志异常:`, error);
      return null;
    }
  }

  // 管理用户状态（启用/禁用）
  async manageUser(
    sudorouterUserId: number,
    action: "enable" | "disable"
  ): Promise<{ success: boolean; message?: string }> {
    const url = `${this.config.baseUrl}/api/user/manage`;
    const body = {
      id: sudorouterUserId,
      action: action,
    };

    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      }, this.config.timeoutMs);

      const data = await response.json();

      if (data.success) {
        console.log(`[Sudorouter] 用户状态更新成功: userId=${sudorouterUserId}, action=${action}`);
        return { success: true };
      }

      console.error(`[Sudorouter] 用户状态更新失败:`, data.message);
      return { success: false, message: data.message || "操作失败" };
    } catch (error: any) {
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error(`[Sudorouter] 用户状态更新异常:`, errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  getInitialQuota(): number {
    return this.config.initialQuota;
  }

  // 获取初始积分（赠送积分）
  getInitialPoints(): number {
    return Math.round(this.config.initialQuota * POINTS_CONVERSION_RATE);
  }

  // 额度转积分
  quotaToPoints(quota: number): number {
    return Math.round(quota * POINTS_CONVERSION_RATE);
  }

  // 积分转额度
  pointsToQuota(points: number): number {
    return Math.round(points / POINTS_CONVERSION_RATE);
  }

  // 获取换算系数
  getConversionRate(): number {
    return POINTS_CONVERSION_RATE;
  }

  isConfigured(): boolean {
    return !!(this.config.baseUrl && this.config.apiToken);
  }

  // 获取模型服务 URL
  getModelServiceUrl(): string {
    return this.config.modelServiceUrl;
  }

  // 获取可用模型列表（带 10 分钟缓存）
  async getAvailableModels(forceRefresh: boolean = false): Promise<string[]> {
    // 检查缓存是否有效
    if (!forceRefresh && this.modelsCache && Date.now() - this.modelsCache.timestamp < this.modelsCacheTtl) {
      console.log(`[Sudorouter] Using cached models (${this.modelsCache.data.length} models)`);
      return this.modelsCache.data;
    }

    if (!this.config.modelsApiUrl) {
      console.warn('[Sudorouter] Models API URL not configured');
      return [];
    }

    try {
      const response = await fetchWithTimeout(
        this.config.modelsApiUrl,
        { method: 'GET' },
        this.config.timeoutMs
      );

      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        const models = data.data.map((item: { model_id: string }) => item.model_id);
        console.log(`[Sudorouter] Fetched ${models.length} models from API`);

        // 更新缓存
        this.modelsCache = { data: models, timestamp: Date.now() };
        return models;
      }

      console.error('[Sudorouter] Failed to fetch models:', data.message || 'Invalid response');
      return [];
    } catch (error: any) {
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error('[Sudorouter] Fetch models error:', errorMsg);
      return [];
    }
  }

  // 测试连接
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetchWithTimeout(
        `${this.config.baseUrl}/api/user/13`,
        {
          method: "GET",
          headers: this.getHeaders(),
        },
        5000
      );
      const data = await response.json();
      return { success: data.success, message: data.success ? "连接成功" : data.message };
    } catch (error: any) {
      const errorMsg = error.name === "AbortError"
        ? "连接超时"
        : `连接失败: ${error.message || String(error)}`;
      return { success: false, message: errorMsg };
    }
  }
}

export const sudorouterService = new SudorouterService();
export type { SudorouterUser, SudorouterUserInfo, UsageLog, ApiCallResult };