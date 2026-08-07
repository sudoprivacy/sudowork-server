import { describe, expect, it } from "bun:test";

function validateApplicationGrant(points: number, sourceId: number | null) {
  if (!Number.isInteger(points) || points <= 0) {
    return "points must be a positive integer";
  }
  if (!sourceId || sourceId <= 0) {
    return "credit application source id is required";
  }
  return null;
}

function buildApplicationGrant(points: number, sourceId: number) {
  return {
    quota: Math.round(points / 0.002),
    ledgerType: "CREDIT_APPLICATION_APPROVED",
    source: "CREDIT_APPLICATION",
    sourceId,
  };
}

describe("credit application grant contract", () => {
  it("converts approved points to quota and application source metadata", () => {
    expect(buildApplicationGrant(1000, 9)).toEqual({
      quota: 500000,
      ledgerType: "CREDIT_APPLICATION_APPROVED",
      source: "CREDIT_APPLICATION",
      sourceId: 9,
    });
  });

  it("rejects invalid application grants", () => {
    expect(validateApplicationGrant(0, 1)).toBe(
      "points must be a positive integer",
    );
    expect(validateApplicationGrant(-1, 1)).toBe(
      "points must be a positive integer",
    );
    expect(validateApplicationGrant(1.5, 1)).toBe(
      "points must be a positive integer",
    );
    expect(validateApplicationGrant(100, null)).toBe(
      "credit application source id is required",
    );
  });
});
