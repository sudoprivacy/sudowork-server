import { expect, test } from "bun:test";

const pageSource = await Bun.file(
  new URL("../src/pages/CreditApplications.tsx", import.meta.url),
).text();

test("keeps credit application actions immediately after status", () => {
  const titles = Array.from(pageSource.matchAll(/title:\s*"([^"]+)"/g)).map(
    ([, title]) => title,
  );

  expect(titles.indexOf("操作")).toBe(titles.indexOf("状态") + 1);
});

test("uses page-scoped table scrollbar styling", async () => {
  const cssSource = await Bun.file(
    new URL("../src/pages/CreditApplications.css", import.meta.url),
  ).text();

  expect(pageSource).toContain('className="credit-applications-table"');
  expect(pageSource).toContain('import "./CreditApplications.css";');
  expect(cssSource).toContain(".credit-applications-table");
  expect(cssSource).toContain("::-webkit-scrollbar");
  expect(cssSource).toContain("scrollbar-width");
});
