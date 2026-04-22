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

// 模型使用统计项（按日期和模型聚合）
interface ModelUsageStatItem {
  date: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
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
  async createUserWithLog(phone: string, nickname?: string): Promise<ApiCallResult<SudorouterUser>> {
    const url = `${this.config.baseUrl}/api/user/`;
    const displayName = nickname || phone; // 如果昵称为空则使用手机号
    const body = {
      username: phone,
      password: phone,
      display_name: displayName,
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
  async createUser(phone: string, nickname?: string): Promise<SudorouterUser | null> {
    const result = await this.createUserWithLog(phone, nickname);
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

  // 获取全量使用日志（分页并行获取）用于统计分析
  private async getAllUsageLogs(
    sudorouterUserId: number,
    timeFrom: number,
    timeTo: number
  ): Promise<UsageLog[] | null> {
    const PAGE_SIZE = 100; // API 最大支持 100

    try {
      // 首先获取第一页，确定总数
      const buildUrl = (pageNum: number) => {
        const params = new URLSearchParams({
          user_id: sudorouterUserId.toString(),
          time_from: timeFrom.toString(),
          time_to: timeTo.toString(),
          page_num: pageNum.toString(),
          page_size: PAGE_SIZE.toString(),
          order_by: "created_at",
          desc: "true",
        });
        return `${this.config.baseUrl}/api/log/?${params.toString()}`;
      };

      const firstResponse = await fetchWithTimeout(
        buildUrl(1),
        { method: "GET", headers: this.getHeaders() },
        this.config.timeoutMs
      );

      if (!firstResponse.ok) {
        console.error(`[Sudorouter] 获取全量日志失败: HTTP ${firstResponse.status}`);
        return null;
      }

      const firstData = (await firstResponse.json()) as {
        success: boolean;
        data?: { count?: number; data?: UsageLog[] };
        message?: string;
      };

      if (!firstData.success || !firstData.data?.data) {
        console.error(`[Sudorouter] 获取全量日志失败:`, firstData.message);
        return null;
      }

      const totalCount = firstData.data.count || 0;
      const allLogs: UsageLog[] = [...firstData.data.data];

      // 如果第一页已包含所有数据，直接返回
      if (allLogs.length >= totalCount) {
        return allLogs;
      }

      // 并行获取剩余页
      const totalPages = Math.ceil(totalCount / PAGE_SIZE);
      const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

      const pagePromises = remainingPages.map(async (pageNum) => {
        try {
          const response = await fetchWithTimeout(
            buildUrl(pageNum),
            { method: "GET", headers: this.getHeaders() },
            this.config.timeoutMs
          );

          if (!response.ok) return null;

          const data = (await response.json()) as {
            success: boolean;
            data?: { data?: UsageLog[] };
          };

          return data.success && data.data?.data ? data.data.data : null;
        } catch {
          return null;
        }
      });

      const pageResults = await Promise.all(pagePromises);

      for (const logs of pageResults) {
        if (logs) allLogs.push(...logs);
      }

      console.log(`[Sudorouter] 获取全量日志完成: 共${totalCount}条，实际获取${allLogs.length}条`);
      return allLogs;
    } catch (error: any) {
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error(`[Sudorouter] 获取全量日志异常:`, errorMsg);
      return null;
    }
  }

  // 获取模型用量统计（按日期+模型聚合，Top 5 + other）
  async getModelUsageStats(
    sudorouterUserId: number,
    startDate: string,
    endDate: string
  ): Promise<ModelUsageStatItem[] | null> {
    // 1. 将 ISO 日期转换为 Unix 时间戳
    const timeFrom = Math.floor(new Date(startDate + "T00:00:00").getTime() / 1000);
    const timeTo = Math.floor(new Date(endDate + "T23:59:59").getTime() / 1000);

    // 2. 获取全量日志
    const logs = await this.getAllUsageLogs(sudorouterUserId, timeFrom, timeTo);
    if (!logs) {
      return null;
    }

    // 3. 过滤有效记录（排除 manage 类型和无模型名的记录）
    const validLogs = logs.filter(
      (log) => log.type !== 1 && log.model_name
    );

    if (validLogs.length === 0) {
      return [];
    }

    // 4. 按 (date, model) 双重分组聚合
    const grouped: Record<string, Record<string, { prompt: number; completion: number; total: number }>> = {};
    for (const log of validLogs) {
      const date = this.formatDateFromTimestamp(log.created_at);
      // After filter, model_name is guaranteed to be truthy
      const model = log.model_name!;

      if (!grouped[date]) grouped[date] = {};
      if (!grouped[date][model]) grouped[date][model] = { prompt: 0, completion: 0, total: 0 };

      grouped[date][model].prompt += log.prompt_tokens || 0;
      grouped[date][model].completion += log.completion_tokens || 0;
      grouped[date][model].total += (log.prompt_tokens || 0) + (log.completion_tokens || 0);
    }

    // 5. 计算每个模型的总用量
    const modelTotals: Record<string, number> = {};
    for (const date in grouped) {
      for (const model in grouped[date]) {
        modelTotals[model] = (modelTotals[model] || 0) + grouped[date][model]!.total;
      }
    }

    // 6. 取 Top 5 模型
    const top5Models = Object.entries(modelTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model]) => model);

    // 7. 生成结果（合并 other）
    const result: ModelUsageStatItem[] = [];
    for (const date of Object.keys(grouped).sort()) {
      // 收集该日期下所有模型的聚合数据
      const dateModels = grouped[date];
      const otherData = { prompt: 0, completion: 0, total: 0 };

      for (const model in dateModels) {
        const data = dateModels[model]!;
        if (top5Models.includes(model)) {
          result.push({
            date,
            model,
            prompt_tokens: data.prompt,
            completion_tokens: data.completion,
            total_tokens: data.total,
          });
        } else {
          otherData.prompt += data.prompt;
          otherData.completion += data.completion;
          otherData.total += data.total;
        }
      }

      // 如果有 other 数据，添加一条
      if (otherData.total > 0) {
        result.push({
          date,
          model: "other",
          prompt_tokens: otherData.prompt,
          completion_tokens: otherData.completion,
          total_tokens: otherData.total,
        });
      }
    }

    return result;
  }

  // 辅助方法：将时间戳转换为 ISO 日期字符串
  private formatDateFromTimestamp(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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

  // 删除用户（返回详细结果用于日志）
  async deleteUserWithLog(sudorouterUserId: number): Promise<ApiCallResult<boolean>> {
    const url = `${this.config.baseUrl}/api/user/${sudorouterUserId}`;

    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: "DELETE",
        headers: this.getHeaders(),
      }, this.config.timeoutMs);

      const duration = Date.now() - startTime;

      // Sudorouter 删除接口无返回内容，判断 HTTP 状态码即可
      // 200-299 状态码表示删除成功
      if (response.ok) {
        console.log(`[Sudorouter] 用户删除成功: userId=${sudorouterUserId}, status=${response.status}`);
        return {
          success: true,
          data: true,
          request: { method: "DELETE", url },
          response: { status: response.status, data: null },
          duration_ms: duration,
        };
      }

      // 非 2xx 状态码表示失败，尝试解析错误信息
      let errorMsg = `删除失败 (HTTP ${response.status})`;
      try {
        const errorData = await response.json() as { message?: string };
        errorMsg = errorData.message || errorMsg;
      } catch {
        // 无法解析响应体，使用状态码信息
      }

      console.error(`[Sudorouter] 用户删除失败: userId=${sudorouterUserId}, status=${response.status}`);
      return {
        success: false,
        data: false,
        request: { method: "DELETE", url },
        response: { status: response.status, data: null },
        duration_ms: duration,
        error: errorMsg,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg = error.name === "AbortError"
        ? `请求超时 (${this.config.timeoutMs}ms)`
        : `网络错误: ${error.message || String(error)}`;
      console.error(`[Sudorouter] 用户删除异常:`, errorMsg);
      return {
        success: false,
        data: false,
        request: { method: "DELETE", url },
        response: { status: 0, data: null },
        duration_ms: duration,
        error: errorMsg,
      };
    }
  }

  // 简化版删除用户（兼容旧代码）
  async deleteUser(sudorouterUserId: number): Promise<boolean> {
    const result = await this.deleteUserWithLog(sudorouterUserId);
    return result.success && result.data === true;
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
export type { SudorouterUser, SudorouterUserInfo, UsageLog, ApiCallResult, ModelUsageStatItem };