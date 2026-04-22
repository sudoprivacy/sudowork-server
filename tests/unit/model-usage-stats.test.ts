import { test, expect, describe, mock, beforeEach } from "bun:test";
import { sign } from "hono/jwt";
import { Hono } from "hono";

// Bun auto-loads .env, so JWT_SECRET is already set.
// We must use the same secret that src/middleware/auth.ts reads at runtime.
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
const mockGetModelUsageStats = mock(() =>
  Promise.resolve([
    {
      date: "2026-04-15",
      model: "gemini-2.5-pro",
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
    {
      date: "2026-04-15",
      model: "gpt-4",
      prompt_tokens: 200,
      completion_tokens: 100,
      total_tokens: 300,
    },
  ])
);

const mockSudorouterService = {
  isConfigured: mock(() => true),
  getModelUsageStats: mockGetModelUsageStats,
};

mock.module("../../src/services/SudorouterService.js", () => ({
  sudorouterService: mockSudorouterService,
}));

// --- Import after mocks are set up ---
const { userRoutes } = await import("../../src/routes/user.js");

// --- Test helpers ---
async function makeToken(payload: Record<string, unknown>): Promise<string> {
  return await sign(payload, JWT_SECRET, "HS256");
}

// --- Route tests ---

describe("GET /api/v1/user/model-usage-stats", () => {
  const app = new Hono();
  app.route("/api/v1/user", userRoutes);

  beforeEach(() => {
    mockRedisGet.mockClear();
    mockDbPrepare.mockClear();
    mockPrepareGet.mockClear();
    mockPrepareRun.mockClear();
    mockGetModelUsageStats.mockClear();
    mockSudorouterService.isConfigured.mockClear();

    // Reset default mocks
    mockPrepareGet.mockReturnValue({
      id: 1,
      phone: "13800138000",
      sudorouter_user_id: 100,
    });
    mockSudorouterService.isConfigured.mockReturnValue(true);
    mockGetModelUsageStats.mockResolvedValue([
      {
        date: "2026-04-15",
        model: "gemini-2.5-pro",
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    ]);
  });

  test("returns 200 with stats for valid request", async () => {
    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: 1,
    });

    const res = await app.request(
      "/api/v1/user/model-usage-stats?start_date=2026-04-15&end_date=2026-04-16",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(mockGetModelUsageStats).toHaveBeenCalledWith(
      100,
      "2026-04-15",
      "2026-04-16"
    );
  });

  test("returns 400 when missing date params", async () => {
    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: 1,
    });

    // Test missing both params
    const res1 = await app.request("/api/v1/user/model-usage-stats", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.success).toBe(false);
    expect(body1.msg).toBe("缺少日期参数");

    // Test missing end_date only
    const res2 = await app.request(
      "/api/v1/user/model-usage-stats?start_date=2026-04-15",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.success).toBe(false);
    expect(body2.msg).toBe("缺少日期参数");

    // Test missing start_date only
    const res3 = await app.request(
      "/api/v1/user/model-usage-stats?end_date=2026-04-16",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(res3.status).toBe(400);
    const body3 = await res3.json();
    expect(body3.success).toBe(false);
    expect(body3.msg).toBe("缺少日期参数");
  });

  test("returns 400 for invalid date format", async () => {
    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: 1,
    });

    // Test invalid format (not YYYY-MM-DD)
    const res1 = await app.request(
      "/api/v1/user/model-usage-stats?start_date=2026/04/15&end_date=2026-04-16",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.success).toBe(false);
    expect(body1.msg).toBe("日期格式无效");

    // Test invalid date (non-existent date)
    const res2 = await app.request(
      "/api/v1/user/model-usage-stats?start_date=2026-13-01&end_date=2026-04-16",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.success).toBe(false);
    expect(body2.msg).toBe("日期格式无效");

    // Test non-date string
    const res3 = await app.request(
      "/api/v1/user/model-usage-stats?start_date=abc&end_date=xyz",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(res3.status).toBe(400);
    const body3 = await res3.json();
    expect(body3.success).toBe(false);
    expect(body3.msg).toBe("日期格式无效");
  });

  test("returns 400 when date range > 30 days", async () => {
    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: 1,
    });

    // Test 31-day range
    const res = await app.request(
      "/api/v1/user/model-usage-stats?start_date=2026-04-01&end_date=2026-05-02",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.msg).toBe("时间范围不能超过30天");

    // Should NOT call the service when validation fails
    expect(mockGetModelUsageStats).not.toHaveBeenCalled();
  });

  test("returns 401 when unauthorized", async () => {
    // Test with no Authorization header
    const res1 = await app.request(
      "/api/v1/user/model-usage-stats?start_date=2026-04-15&end_date=2026-04-16"
    );

    expect(res1.status).toBe(401);
    const body1 = await res1.json();
    expect(body1.success).toBe(false);
    expect(body1.msg).toBe("未授权");

    // Test with invalid token
    const res2 = await app.request(
      "/api/v1/user/model-usage-stats?start_date=2026-04-15&end_date=2026-04-16",
      {
        headers: { Authorization: "Bearer invalid.token" },
      }
    );

    expect(res2.status).toBe(401);
    const body2 = await res2.json();
    expect(body2.success).toBe(false);
  });
});