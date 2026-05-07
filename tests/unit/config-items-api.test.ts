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
const mockPrepareGet = mock(() => null);
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

// --- Import after mocks are set up ---
const { getConfigItemsForEnterprise } = await import(
  "../../src/services/ConfigItemService.js"
);
const { miscRoutes } = await import("../../src/routes/misc.js");

// --- Test helpers ---
async function makeToken(payload: Record<string, unknown>): Promise<string> {
  return await sign(payload, JWT_SECRET, "HS256");
}

async function makeExpiredToken(): Promise<string> {
  return await sign(
    {
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: 1,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    },
    JWT_SECRET,
    "HS256"
  );
}

const sampleDbRows = [
  { id: 1, name: "model_config", icon: "abc123.svg", pinyin: "model_config", url_pattern: "https://api.openai.com/*", scheme: "bearer", bearer_prefix: "Bearer ", entry_id: 10, config_key: "max_tokens", entry_name: "最大Token数", config_desc: "最大token数", required: 1 },
  { id: 1, name: "model_config", icon: "abc123.svg", pinyin: "model_config", url_pattern: "https://api.openai.com/*", scheme: "bearer", bearer_prefix: "Bearer ", entry_id: 11, config_key: "temperature", entry_name: "温度参数", config_desc: "温度参数", required: 1 },
  { id: 2, name: "prompt_config", icon: null, pinyin: "prompt_config", url_pattern: null, scheme: "header", bearer_prefix: null, entry_id: 20, config_key: "system_prompt", entry_name: "系统提示词", config_desc: "系统提示词", required: 1 },
];

const expectedGrouped = [
  {
    id: 1,
    name: "model_config",
    icon: "abc123.svg",
    icon_url: "/uploads/config-items/abc123.svg",
    pinyin: "model_config",
    url_pattern: "https://api.openai.com/*",
    scheme: "bearer",
    bearer_prefix: "Bearer ",
    entries: [
      { id: 10, config_key: "max_tokens", name: "最大Token数", config_desc: "最大token数", required: 1 },
      { id: 11, config_key: "temperature", name: "温度参数", config_desc: "温度参数", required: 1 },
    ],
  },
  {
    id: 2,
    name: "prompt_config",
    icon: null,
    icon_url: "/config-item-default.svg",
    pinyin: "prompt_config",
    url_pattern: null,
    scheme: "header",
    bearer_prefix: null,
    entries: [{ id: 20, config_key: "system_prompt", name: "系统提示词", config_desc: "系统提示词", required: 1 }],
  },
];

// --- Service tests ---

describe("ConfigItemService.getConfigItemsForEnterprise", () => {
  beforeEach(() => {
    mockRedisGet.mockClear();
    mockRedisSetex.mockClear();
    mockDbPrepare.mockClear();
    mockPrepareAll.mockClear();

    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue("OK");
    mockPrepareAll.mockReturnValue([]);
  });

  test("returns empty array when enterprise has no config items", async () => {
    mockPrepareAll.mockReturnValue([]);

    const result = await getConfigItemsForEnterprise(999);
    expect(result).toEqual([]);
    expect(mockRedisSetex).toHaveBeenCalledTimes(1);
    expect(mockRedisSetex).toHaveBeenCalledWith(
      "config_items:999",
      300,
      JSON.stringify([])
    );
  });

  test("returns grouped items with entries from DB on cache miss", async () => {
    mockPrepareAll.mockReturnValue(sampleDbRows);

    const result = await getConfigItemsForEnterprise(1);
    expect(result).toEqual(expectedGrouped);
    expect(mockRedisGet).toHaveBeenCalledWith("config_items:1");
    expect(mockRedisSetex).toHaveBeenCalledWith(
      "config_items:1",
      300,
      JSON.stringify(expectedGrouped)
    );
  });

  test("returns cached data on cache hit without DB query", async () => {
    const cachedData = JSON.stringify(expectedGrouped);
    mockRedisGet.mockResolvedValue(cachedData);

    const result = await getConfigItemsForEnterprise(1);
    expect(result).toEqual(expectedGrouped);
    expect(mockRedisGet).toHaveBeenCalledWith("config_items:1");
    // DB should not be queried on cache hit
    expect(mockDbPrepare).not.toHaveBeenCalled();
  });

  test("falls through to DB when Redis get fails", async () => {
    mockRedisGet.mockRejectedValue(new Error("Redis connection refused"));
    mockPrepareAll.mockReturnValue(sampleDbRows);

    const result = await getConfigItemsForEnterprise(1);
    expect(result).toEqual(expectedGrouped);
    expect(mockRedisSetex).toHaveBeenCalledWith(
      "config_items:1",
      300,
      JSON.stringify(expectedGrouped)
    );
  });

  test("returns DB data when Redis setex fails", async () => {
    mockPrepareAll.mockReturnValue(sampleDbRows);
    mockRedisSetex.mockRejectedValue(new Error("Redis write failed"));

    const result = await getConfigItemsForEnterprise(1);
    expect(result).toEqual(expectedGrouped);
  });

  test("re-queries DB after cache expires", async () => {
    // First call: cache miss
    mockRedisGet.mockResolvedValue(null);
    mockPrepareAll.mockReturnValue(sampleDbRows);

    const result1 = await getConfigItemsForEnterprise(1);
    expect(result1).toEqual(expectedGrouped);
    expect(mockPrepareAll).toHaveBeenCalledTimes(1);

    // Simulate cache expiry: reset and return null from Redis
    mockRedisGet.mockClear();
    mockRedisSetex.mockClear();
    mockPrepareAll.mockClear();

    mockRedisGet.mockResolvedValue(null);
    mockPrepareAll.mockReturnValue(sampleDbRows);

    const result2 = await getConfigItemsForEnterprise(1);
    expect(result2).toEqual(expectedGrouped);
    expect(mockPrepareAll).toHaveBeenCalledTimes(1);
    expect(mockRedisSetex).toHaveBeenCalledTimes(1);
  });
});

// --- Route tests ---

describe("GET /api/v1/config/items route", () => {
  const app = new Hono();
  app.route("/api/v1", miscRoutes);

  beforeEach(() => {
    mockRedisGet.mockClear();
    mockRedisSetex.mockClear();
    mockDbPrepare.mockClear();
    mockPrepareAll.mockClear();

    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue("OK");
    mockPrepareAll.mockReturnValue(sampleDbRows);
  });

  test("returns 401 when no Authorization header", async () => {
    const res = await app.request("/api/v1/config/items");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.msg).toBe("未授权");
  });

  test("returns 401 when Authorization header is not Bearer format", async () => {
    const res = await app.request("/api/v1/config/items", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("returns 401 when token is invalid", async () => {
    const res = await app.request("/api/v1/config/items", {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("returns 401 when token is expired", async () => {
    const token = await makeExpiredToken();
    const res = await app.request("/api/v1/config/items", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("returns empty array when enterprise_id is null", async () => {
    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: null,
    });
    const res = await app.request("/api/v1/config/items", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    // Should NOT call Redis or DB
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(mockDbPrepare).not.toHaveBeenCalled();
  });

  test("returns empty array when enterprise_id is undefined", async () => {
    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
    });
    const res = await app.request("/api/v1/config/items", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  test("returns config items when enterprise has items", async () => {
    mockPrepareAll.mockReturnValue(sampleDbRows);

    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: 42,
    });
    const res = await app.request("/api/v1/config/items", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toEqual(expectedGrouped);
  });

  test("returns empty data when enterprise has no config items in DB", async () => {
    mockPrepareAll.mockReturnValue([]);

    const token = await makeToken({
      id: 1,
      phone: "13800138000",
      role: "USER",
      enterprise_id: 999,
    });
    const res = await app.request("/api/v1/config/items", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});
