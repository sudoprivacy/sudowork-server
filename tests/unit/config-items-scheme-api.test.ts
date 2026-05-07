import { test, expect, describe, mock, beforeEach } from "bun:test";
import { sign } from "hono/jwt";
import { Hono } from "hono";

const JWT_SECRET = process.env.JWT_SECRET || "sudowork-secret-key";

const mockRedisGet = mock(() => Promise.resolve(null));
const mockRedisSetex = mock(() => Promise.resolve("OK"));
const mockRedisDel = mock(() => Promise.resolve(1));
const mockRedisPing = mock(() => Promise.resolve("PONG"));

const mockRedis = { get: mockRedisGet, setex: mockRedisSetex, del: mockRedisDel, ping: mockRedisPing };

mock.module("../../src/redis.js", () => ({
  redis: mockRedis,
  checkRedisConnection: () => Promise.resolve(true),
}));

const mockPrepareAll = mock(() => []);
const mockPrepareGet = mock(() => null);
const mockPrepareRun = mock(() => ({ changes: 0, lastInsertRowid: 1 }));

const mockDbPrepare = mock(() => ({ get: mockPrepareGet, all: mockPrepareAll, run: mockPrepareRun }));
const mockDb = { prepare: mockDbPrepare, run: mock(() => ({})), exec: mock(() => ({})) };

mock.module("../../src/db/index.js", () => ({ db: mockDb, SECRET: JWT_SECRET }));

const { configItemsRoutes } = await import("../../src/routes/admin/config-items.js");

async function makeAdminToken(): Promise<string> {
  return await sign({ id: 1, phone: "13800138000", role: "SUPER_ADMIN" }, JWT_SECRET, "HS256");
}

function mockConfigItem(overrides: Record<string, any> = {}) {
  return {
    id: 1, name: "test_cfg", description: null, icon: null, pinyin: "test_cfg",
    url_pattern: "https://api.example.com/*", scheme: null, bearer_prefix: null,
    status: 1, created_by_id: 1, created_by_name: "admin", updated_by_id: 1, updated_by_name: "admin",
    created_at: "2024-01-01 00:00:00", updated_at: "2024-01-01 00:00:00", ...overrides,
  };
}

describe("Config Items - Scheme validation (POST)", () => {
  const app = new Hono();
  app.route("/api/v1/admin", configItemsRoutes);

  beforeEach(() => {
    mockDbPrepare.mockClear();
    mockPrepareGet.mockClear();
    mockPrepareAll.mockClear();
    mockPrepareRun.mockClear();
    mockPrepareAll.mockReturnValue([]);
    mockPrepareGet.mockReturnValue(null);
    mockPrepareRun.mockReturnValue({ changes: 1, lastInsertRowid: 100n });
  });

  test("create with scheme=bearer and bearer_prefix succeeds", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bearer_cfg", url_pattern: "https://api.example.com/*", scheme: "bearer", bearer_prefix: "Bearer " }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test("create with url_pattern but no scheme returns 400", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no_scheme", url_pattern: "https://api.example.com/*" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("Scheme");
  });

  test("create with invalid scheme returns 400", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad_scheme", url_pattern: "https://api.example.com/*", scheme: "oauth" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("无效");
  });

  test("create with scheme=basic and bearer_prefix returns 400", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "basic_w_pfx", url_pattern: "https://api.example.com/*", scheme: "basic", bearer_prefix: "X" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("仅bearer");
  });

  test("create with scheme=header and bearer_prefix returns 400", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hdr_w_pfx", url_pattern: "https://api.example.com/*", scheme: "header", bearer_prefix: "X" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("仅bearer");
  });

  test("create with bearer_prefix too long returns 400", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "long_pfx", url_pattern: "https://api.example.com/*", scheme: "bearer", bearer_prefix: "x".repeat(129) }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("128");
  });

  test("create without url_pattern and scheme succeeds", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no_url_noscheme" }),
    });
    expect(res.status).toBe(200);
  });

  test("create with scheme=query succeeds", async () => {
    mockPrepareGet.mockReturnValue(null);
    const res = await app.request("/api/v1/admin/config-items", {
      method: "POST",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "query_sch", url_pattern: "https://api.example.com/*", scheme: "query" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Config Items - Scheme validation (PUT)", () => {
  const app = new Hono();
  app.route("/api/v1/admin", configItemsRoutes);

  beforeEach(() => {
    mockDbPrepare.mockClear(); mockPrepareGet.mockClear(); mockPrepareAll.mockClear(); mockPrepareRun.mockClear();
    mockPrepareAll.mockReturnValue([]);
    mockPrepareRun.mockReturnValue({ changes: 1, lastInsertRowid: 1n });
  });

  test("update to bearer with entries>1 returns 400", async () => {
    const item = mockConfigItem({ scheme: "header" });
    mockPrepareGet.mockReturnValueOnce(item).mockReturnValueOnce({ cnt: 2 });
    const res = await app.request("/api/v1/admin/config-items/1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scheme: "bearer" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("配置列表");
  });

  test("update to bearer with entries=1 succeeds", async () => {
    const item = mockConfigItem({ scheme: "header" });
    mockPrepareGet.mockReturnValueOnce(item).mockReturnValueOnce({ cnt: 1 });
    const res = await app.request("/api/v1/admin/config-items/1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scheme: "bearer" }),
    });
    expect(res.status).toBe(200);
  });

  test("update from bearer to header (relax) succeeds", async () => {
    const item = mockConfigItem({ scheme: "bearer", bearer_prefix: "Bearer " });
    mockPrepareGet.mockReturnValueOnce(item);
    const res = await app.request("/api/v1/admin/config-items/1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scheme: "header" }),
    });
    expect(res.status).toBe(200);
  });

  test("clear scheme when url_pattern exists returns 400", async () => {
    const item = mockConfigItem({ scheme: "bearer" });
    mockPrepareGet.mockReturnValueOnce(item);
    const res = await app.request("/api/v1/admin/config-items/1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scheme: null }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("Scheme");
  });

  test("clear both url_pattern and scheme succeeds", async () => {
    const item = mockConfigItem({ scheme: "bearer" });
    mockPrepareGet.mockReturnValueOnce(item);
    const res = await app.request("/api/v1/admin/config-items/1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url_pattern: null, scheme: null }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Config Items - Scheme entries constraint (PUT /entries)", () => {
  const app = new Hono();
  app.route("/api/v1/admin", configItemsRoutes);

  beforeEach(() => {
    mockDbPrepare.mockClear(); mockPrepareGet.mockClear(); mockPrepareAll.mockClear(); mockPrepareRun.mockClear();
    mockPrepareAll.mockReturnValue([]);
    mockPrepareRun.mockReturnValue({ changes: 1, lastInsertRowid: 1n });
  });

  test("save 2 entries with scheme=bearer returns 400", async () => {
    mockPrepareGet.mockReturnValue({ id: 1, status: 1, scheme: "bearer" });
    const res = await app.request("/api/v1/admin/config-items/1/entries", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [
        { config_key: "key_one", name: "K1", config_desc: "d", required: 1 },
        { config_key: "key_two", name: "K2", config_desc: "d", required: 1 },
      ] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).msg).toContain("仅允许");
  });

  test("save 1 entry with scheme=bearer succeeds", async () => {
    mockPrepareGet.mockReturnValue({ id: 1, status: 1, scheme: "bearer" });
    const res = await app.request("/api/v1/admin/config-items/1/entries", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ config_key: "api_key", name: "AK", config_desc: "d", required: 1 }] }),
    });
    expect(res.status).toBe(200);
  });

  test("save 2 entries with scheme=header succeeds", async () => {
    mockPrepareGet.mockReturnValue({ id: 1, status: 1, scheme: "header" });
    const res = await app.request("/api/v1/admin/config-items/1/entries", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [
        { config_key: "key_one", name: "K1", config_desc: "d", required: 1 },
        { config_key: "key_two", name: "K2", config_desc: "d", required: 1 },
      ] }),
    });
    expect(res.status).toBe(200);
  });

  test("save 2 entries with scheme=basic returns 400", async () => {
    mockPrepareGet.mockReturnValue({ id: 1, status: 1, scheme: "basic" });
    const res = await app.request("/api/v1/admin/config-items/1/entries", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [
        { config_key: "key_one", name: "K1", config_desc: "d", required: 1 },
        { config_key: "key_two", name: "K2", config_desc: "d", required: 1 },
      ] }),
    });
    expect(res.status).toBe(400);
  });

  test("save 0 entries with scheme=bearer succeeds", async () => {
    mockPrepareGet.mockReturnValue({ id: 1, status: 1, scheme: "bearer" });
    const res = await app.request("/api/v1/admin/config-items/1/entries", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [] }),
    });
    expect(res.status).toBe(200);
  });

  test("save 3 entries with scheme=null succeeds", async () => {
    mockPrepareGet.mockReturnValue({ id: 1, status: 1, scheme: null });
    const res = await app.request("/api/v1/admin/config-items/1/entries", {
      method: "PUT",
      headers: { Authorization: `Bearer ${await makeAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [
        { config_key: "k1", name: "K1", config_desc: "d", required: 1 },
        { config_key: "k2", name: "K2", config_desc: "d", required: 1 },
        { config_key: "k3", name: "K3", config_desc: "d", required: 0 },
      ] }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Config Items - Detail includes scheme", () => {
  const app = new Hono();
  app.route("/api/v1/admin", configItemsRoutes);

  beforeEach(() => {
    mockDbPrepare.mockClear(); mockPrepareGet.mockClear(); mockPrepareAll.mockClear();
  });

  test("detail returns scheme=bearer and bearer_prefix", async () => {
    const item = mockConfigItem({ scheme: "bearer", bearer_prefix: "Bearer " });
    mockPrepareGet.mockReturnValue(item);
    mockPrepareAll.mockReturnValueOnce([{ id: 1, config_item_id: 1, config_key: "api_key", name: "AK", config_desc: "d", required: 1 }]).mockReturnValueOnce([]);
    const res = await app.request("/api/v1/admin/config-items/1", {
      method: "GET",
      headers: { Authorization: `Bearer ${await makeAdminToken()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.scheme).toBe("bearer");
    expect(body.bearer_prefix).toBe("Bearer ");
  });

  test("detail returns null scheme", async () => {
    const item = mockConfigItem({ scheme: null, bearer_prefix: null });
    mockPrepareGet.mockReturnValue(item);
    mockPrepareAll.mockReturnValue([]);
    const res = await app.request("/api/v1/admin/config-items/1", {
      method: "GET",
      headers: { Authorization: `Bearer ${await makeAdminToken()}` },
    });
    const body = (await res.json()).data;
    expect(body.scheme).toBeNull();
    expect(body.bearer_prefix).toBeNull();
  });
});
