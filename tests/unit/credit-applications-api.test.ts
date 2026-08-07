import { describe, expect, it } from "bun:test";

function validateRequestedPoints(
  value: unknown,
  config = { min_points: 100, max_points: 1000000 },
): string | null {
  if (!Number.isInteger(value)) return "申请积分必须为正整数";
  const points = Number(value);
  if (points <= 0) return "申请积分必须为正整数";
  if (points < config.min_points) return `申请积分不能小于 ${config.min_points}`;
  if (points > config.max_points) return `申请积分不能大于 ${config.max_points}`;
  return null;
}

describe("credit application user validation", () => {
  it("accepts free-form integer points inside configured range", () => {
    expect(validateRequestedPoints(100)).toBeNull();
    expect(validateRequestedPoints(12345)).toBeNull();
    expect(validateRequestedPoints(1000000)).toBeNull();
  });

  it("rejects invalid point amounts", () => {
    expect(validateRequestedPoints(0)).toBe("申请积分必须为正整数");
    expect(validateRequestedPoints(1.5)).toBe("申请积分必须为正整数");
    expect(validateRequestedPoints(99)).toBe("申请积分不能小于 100");
    expect(validateRequestedPoints(1000001)).toBe("申请积分不能大于 1000000");
  });
});
