import { expect, test } from "bun:test";

const serviceSource = await Bun.file(
  new URL("../src/services/SudorouterService.ts", import.meta.url),
).text();

test("Sudorouter model list cache ttl is five minutes", () => {
  expect(serviceSource).toContain(
    "private modelsCacheTtl = 5 * 60 * 1000; // 5 分钟缓存",
  );
  expect(serviceSource).toContain("获取可用模型列表（带 5 分钟缓存）");
});
