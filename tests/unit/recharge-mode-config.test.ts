import { describe, expect, it } from "bun:test";

type RechargeMode = "pay" | "approve" | "disabled";

function normalizeRechargeModeForTest(value: unknown): RechargeMode {
  return value === "approve" || value === "disabled" || value === "pay"
    ? value
    : "pay";
}

describe("recharge mode config", () => {
  it("defaults missing mode to pay", () => {
    expect(normalizeRechargeModeForTest(undefined)).toBe("pay");
    expect(normalizeRechargeModeForTest(null)).toBe("pay");
    expect(normalizeRechargeModeForTest("")).toBe("pay");
  });

  it("accepts known modes", () => {
    expect(normalizeRechargeModeForTest("pay")).toBe("pay");
    expect(normalizeRechargeModeForTest("approve")).toBe("approve");
    expect(normalizeRechargeModeForTest("disabled")).toBe("disabled");
  });

  it("treats invalid modes as pay", () => {
    expect(normalizeRechargeModeForTest("approval")).toBe("pay");
    expect(normalizeRechargeModeForTest("fuiou")).toBe("pay");
    expect(normalizeRechargeModeForTest(1)).toBe("pay");
  });
});
