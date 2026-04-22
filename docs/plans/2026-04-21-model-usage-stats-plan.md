# Model Usage Stats API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add API endpoint for querying user's model usage statistics aggregated by date and model, returning top 5 models + "other".

**Architecture:** Service layer method in SudorouterService handles aggregation logic; user route handles request validation and calls service.

**Tech Stack:** TypeScript, Hono, Bun test

---

## Task 1: Service Layer Interface and Helper Types

**Files:**
- Modify: `src/services/SudorouterService.ts:52-78` (after UsageLog interface)

**Step 1: Add ModelUsageStatItem interface**

Add after line 78 (after `ApiCallResult` interface):

```typescript
interface ModelUsageStatItem {
  date: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
```

**Step 2: Update export statement**

Modify the export at end of file to include the new interface:

```typescript
export const sudorouterService = new SudorouterService();
export type { SudorouterUser, SudorouterUserInfo, UsageLog, ApiCallResult, ModelUsageStatItem };
```

**Step 3: Commit**

```bash
git add src/services/SudorouterService.ts
git commit -m "feat: add ModelUsageStatItem interface for usage stats API"
```

---

## Task 2: Service Layer - Fetch All Usage Logs

**Files:**
- Modify: `src/services/SudorouterService.ts` (after `getUsageLogs` method, around line 430)

**Step 1: Add private method to fetch all logs without pagination**

Add after `getUsageLogs` method (around line 430):

```typescript
  // 获取全量使用日志（不分页）用于统计分析
  private async getAllUsageLogs(
    sudorouterUserId: number,
    timeFrom: number,
    timeTo: number
  ): Promise<UsageLog[] | null> {
    try {
      const params = new URLSearchParams({
        user_id: sudorouterUserId.toString(),
        time_from: timeFrom.toString(),
        time_to: timeTo.toString(),
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

      if (data.success && data.data?.data) {
        return data.data.data;
      }

      console.error(`[Sudorouter] 获取全量日志失败:`, data.message);
      return null;
    } catch (error) {
      console.error(`[Sudorouter] 获取全量日志异常:`, error);
      return null;
    }
  }
```

**Step 2: Commit**

```bash
git add src/services/SudorouterService.ts
git commit -m "feat: add private getAllUsageLogs method for fetching all logs"
```

---

## Task 3: Service Layer - Aggregation Logic

**Files:**
- Modify: `src/services/SudorouterService.ts` (after `getAllUsageLogs` method)

**Step 1: Add getModelUsageStats method**

Add after `getAllUsageLogs` method:

```typescript
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
      const model = log.model_name;

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
        modelTotals[model] = (modelTotals[model] || 0) + grouped[date][model].total;
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
        const data = dateModels[model];
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
```

**Step 2: Commit**

```bash
git add src/services/SudorouterService.ts
git commit -m "feat: add getModelUsageStats method with date+model aggregation"
```

---

## Task 4: Route Layer - Helper Functions

**Files:**
- Modify: `src/routes/user.ts:1-10` (add helper functions after imports)

**Step 1: Add validation helper functions**

Add after line 9 (after `getAuthUser` import):

```typescript
// 日期格式验证
function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

// 计算日期跨度
function daysBetween(start: string, end: string): number {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
```

**Step 2: Commit**

```bash
git add src/routes/user.ts
git commit -m "feat: add date validation helper functions"
```

---

## Task 5: Route Layer - API Endpoint

**Files:**
- Modify: `src/routes/user.ts` (add route after `/stats` route, around line 452)

**Step 1: Add model-usage-stats route**

Add after `/stats` route (around line 452, before `/update-profile`):

```typescript
// GET /api/v1/user/model-usage-stats - Get model usage statistics
userRoutes.get("/model-usage-stats", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload || !payload.id)
    return c.json({ success: false, msg: "未授权" }, 401);

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(Number(payload.id)) as any;

  if (!user) return c.json({ success: false, msg: "用户不存在" }, 404);

  // 获取并验证参数
  const startDate = c.req.query("start_date");
  const endDate = c.req.query("end_date");

  if (!startDate || !endDate) {
    return c.json({ success: false, msg: "缺少日期参数" }, 400);
  }

  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return c.json({ success: false, msg: "日期格式无效" }, 400);
  }

  if (daysBetween(startDate, endDate) > 30) {
    return c.json({ success: false, msg: "时间范围不能超过30天" }, 400);
  }

  // 检查用户是否绑定 sudorouter
  if (!user.sudorouter_user_id || !sudorouterService.isConfigured()) {
    return c.json({ success: false, msg: "用户未绑定服务" }, 400);
  }

  // 调用服务层获取统计数据
  const stats = await sudorouterService.getModelUsageStats(
    user.sudorouter_user_id,
    startDate,
    endDate
  );

  if (!stats) {
    return c.json({ success: false, msg: "获取统计数据失败" }, 500);
  }

  return c.json({ success: true, data: stats });
});
```

**Step 2: Commit**

```bash
git add src/routes/user.ts
git commit -m "feat: add /model-usage-stats endpoint for user model usage statistics"
```

---

## Task 6: Integration Test

**Files:**
- Create: `tests/unit/model-usage-stats.test.ts`

**Step 1: Write integration test**

```typescript
import { test, expect, describe, mock, beforeEach } from "bun:test";
import { sign } from "hono/jwt";
import { Hono } from "hono";

const JWT_SECRET = process.env.JWT_SECRET || "sudowork-secret-key";

// --- Mock Redis ---
const mockRedisGet = mock(() => Promise.resolve(null));
const mockRedisSetex = mock(() => Promise.resolve("OK"));
const mockRedisDel = mock(() => Promise.resolve(1));
const mockRedisPing = mock(() => Promise.resolve("PONG"));

const mockRedis = {
  get: mockRedisGet,
  setex: mockRedisSetex,
  del: mockRedisDel,
  ping: mockRedisPing,
};

mock.module("../../src/redis.js", () => ({
  redis: mockRedis,
  checkRedisConnection: () => Promise.resolve(true),
}));

// --- Mock DB ---
const mockPrepareAll = mock(() => []);
const mockPrepareGet = mock(() => ({
  id: 1,
  phone: "13800138000",
  sudorouter_user_id: 100,
}));
const mockPrepareRun = mock(() => ({ changes: 0, lastInsertRowid: 1 }));

const mockDbPrepare = mock(() => ({
  get: mockPrepareGet,
  all: mockPrepareAll,
  run: mockPrepareRun,
}));

const mockDb = {
  prepare: mockDbPrepare,
  run: mock(() => ({})),
  exec: mock(() => ({})),
};

mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  SECRET: JWT_SECRET,
}));

// --- Mock SudorouterService ---
const mockGetModelUsageStats = mock(() => Promise.resolve([
  { date: "2026-04-15", model: "gemini-2.5-pro", prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  { date: "2026-04-15", model: "gpt-4", prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
  { date: "2026-04-16", model: "gemini-2.5-pro", prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
]));

const mockSudorouterService = {
  isConfigured: mock(() => true),
  getModelUsageStats: mockGetModelUsageStats,
};

mock.module("../../src/services/SudorouterService.js", () => ({
  sudorouterService: mockSudorouterService,
}));

// --- Import after mocks ---
const { userRoutes } = await import("../../src/routes/user.js");

describe("Model Usage Stats API", () => {
  beforeEach(() => {
    mockRedisGet.mockClear();
    mockPrepareGet.mockClear();
    mockGetModelUsageStats.mockClear();
  });

  test("returns stats for valid request", async () => {
    const token = await sign({ id: 1, phone: "13800138000" }, JWT_SECRET);

    const res = await userRoutes.request("/model-usage-stats?start_date=2026-04-15&end_date=2026-04-16", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeArray();
    expect(mockGetModelUsageStats).toHaveBeenCalledWith(100, "2026-04-15", "2026-04-16");
  });

  test("returns 400 for missing date params", async () => {
    const token = await sign({ id: 1, phone: "13800138000" }, JWT_SECRET);

    const res = await userRoutes.request("/model-usage-stats", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.msg).toBe("缺少日期参数");
  });

  test("returns 400 for invalid date format", async () => {
    const token = await sign({ id: 1, phone: "13800138000" }, JWT_SECRET);

    const res = await userRoutes.request("/model-usage-stats?start_date=invalid&end_date=2026-04-16", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.msg).toBe("日期格式无效");
  });

  test("returns 400 for date range > 30 days", async () => {
    const token = await sign({ id: 1, phone: "13800138000" }, JWT_SECRET);

    const res = await userRoutes.request("/model-usage-stats?start_date=2026-03-01&end_date=2026-04-15", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.msg).toBe("时间范围不能超过30天");
  });

  test("returns 401 for unauthorized request", async () => {
    const res = await userRoutes.request("/model-usage-stats?start_date=2026-04-15&end_date=2026-04-16");
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.msg).toBe("未授权");
  });
});
```

**Step 2: Run test**

```bash
bun test tests/unit/model-usage-stats.test.ts
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/unit/model-usage-stats.test.ts
git commit -m "test: add integration tests for model-usage-stats endpoint"
```

---

## Task 7: Final Verification

**Step 1: Run all tests**

```bash
bun test
```

Expected: All tests pass

**Step 2: Type check**

```bash
bunx tsc --noEmit
```

Expected: No type errors

**Step 3: Final commit (if needed)**

If any fixes were required:

```bash
git add -A
git commit -m "fix: resolve type/test issues in model usage stats"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add interface types | `src/services/SudorouterService.ts` |
| 2 | Add private getAllUsageLogs | `src/services/SudorouterService.ts` |
| 3 | Add getModelUsageStats method | `src/services/SudorouterService.ts` |
| 4 | Add validation helpers | `src/routes/user.ts` |
| 5 | Add API endpoint | `src/routes/user.ts` |
| 6 | Add integration tests | `tests/unit/model-usage-stats.test.ts` |
| 7 | Final verification | All files |