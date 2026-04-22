# 模型用量统计接口设计

## 概述

为 sudowork 客户端提供模型用量柱状图展示功能，新增 API 接口查询用户的模型使用统计数据，按日期和模型双重聚合。

## API 接口设计

### 路径

`GET /api/v1/user/model-usage-stats`

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| start_date | string | 是 | ISO日期格式，如 "2026-04-14" |
| end_date | string | 是 | ISO日期格式，如 "2026-04-21" |

### 响应格式

```typescript
interface ModelUsageStatsResponse {
  success: boolean;
  data: {
    date: string;         // 日期 "2026-04-15"
    model: string;        // 模型名称 "gemini-2.5-pro" 或 "other"
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }[];
}
```

### 验证规则

- `start_date` 和 `end_date` 必须是有效 ISO 日期格式 (YYYY-MM-DD)
- 时间跨度不超过 30 天
- 用户必须已登录（通过 `getAuthUser` middleware 验证）

## 业务规则

### 聚合维度

按日期 + 模型双重聚合：同一日期不同模型产生多条记录。

### 模型数量限制

返回 Top 5 使用量最多的模型，其余模型合并为 "other"：
- 计算每个模型在整个时间范围内的 total_tokens 总和
- 按总使用量排序，取前 5 个模型
- 其他模型的用量合并到 "other" 类别

### 排序方式

按日期升序排列，便于柱状图从左到右展示时间线。

## 实现方案

### 服务层设计

在 `src/services/SudorouterService.ts` 新增方法：

```typescript
interface ModelUsageStatItem {
  date: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

async getModelUsageStats(
  sudorouterUserId: number,
  startDate: string,
  endDate: string
): Promise<ModelUsageStatItem[] | null>
```

**处理流程**：

1. 将 ISO 日期转换为 Unix 时间戳
2. 调用 Sudorouter API 获取全量日志（不传分页参数）
3. 过滤掉 `type === "manage"` 和 `model_name` 为空的记录
4. 按 `(date, model)` 双重分组聚合 tokens
5. 计算每个模型总用量，取 Top 5
6. 其余模型合并为 "other"
7. 按日期升序排序返回

**数据获取方式**：

直接在方法内调用 Sudorouter API，不传分页参数，获取全量日志数据。不复用现有 `getUsageLogs()` 方法（该方法有默认分页参数）。

### 路由层设计

在 `src/routes/user.ts` 新增路由：

1. 验证用户身份（`getAuthUser`）
2. 获取并验证请求参数（日期格式、时间范围）
3. 查询用户信息获取 `sudorouter_user_id`
4. 调用服务层 `getModelUsageStats()`
5. 返回统计结果

**辅助函数**：

```typescript
function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

function daysBetween(start: string, end: string): number {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
```

## 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/services/SudorouterService.ts` | 新增 `getModelUsageStats()` 方法和 `ModelUsageStatItem` 接口 |
| `src/routes/user.ts` | 新增 `/model-usage-stats` 路由和辅助函数 |

## 错误处理

| 错误场景 | HTTP 状态码 | 错误消息 |
|----------|-------------|----------|
| 未登录 | 401 | "未授权" |
| 日期格式无效 | 400 | "日期格式无效" |
| 时间范围超过30天 | 400 | "时间范围不能超过30天" |
| 用户未绑定 sudorouter | 400 | "用户未绑定服务" |
| Sudorouter API 失败 | 500 | "获取统计数据失败" |