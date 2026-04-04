import { describe, expect, it } from "vitest";
import { evaluateGoldenReleaseGate } from "../releaseGate";

describe("golden release gate", () => {
  it("passes the current golden-company suite before release", () => {
    const summary = evaluateGoldenReleaseGate();

    expect(summary.totalCases).toBeGreaterThan(0);
    expect(summary.failedCases).toBe(0);
    expect(summary.passed).toBe(true);
    expect(summary.policyVersions.engineVersion).toBeTruthy();
    expect(summary.policyVersions.traceabilitySchemaVersion).toBeTruthy();
    expect(summary.cases.some((item) => item.notes.some((note) => note.startsWith("persistence=")))).toBe(true);
  }, 60000);
});
