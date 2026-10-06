/**
 * The forecast gates one rule serves to the app's run and the audit harness:
 * every scenario case must validate, then stress ≤ base ≤ bull.
 */
import { describe, expect, it } from "vitest";
import { evaluateScenarioForecastGates } from "..";
import type { IndustrialForecastResult } from "..";

const blocked = (caseId: string, reasonCodes: string[]) =>
  ({ status: "blocked", caseId, reasonCodes, projected: [], validation: { status: "failed" } }) as unknown as IndustrialForecastResult;

describe("evaluateScenarioForecastGates", () => {
  it("blocks on the first failed case and names every blocked case with its reasons", () => {
    const gate = evaluateScenarioForecastGates([
      blocked("stress", ["state.nonnegative-balances.stress:2026-03-31"]),
      blocked("historical-panic", ["state.nonnegative-balances.historical-panic:2027-03-31"]),
    ]);
    expect(gate.blocked?.code).toBe("FORECAST_STATE_VALIDATION_BLOCKED");
    expect(gate.blocked?.message).toBe(
      "stress: state.nonnegative-balances.stress:2026-03-31; historical-panic: state.nonnegative-balances.historical-panic:2027-03-31",
    );
    // Ordering is not judged when a case did not validate.
    expect(gate.scenarioOrdering).toBeNull();
  });

  it("judges scenario ordering when every case validates, and does not block when it is not applicable", () => {
    // No stress/base/bull trio: ordering is not applicable, not failed.
    const gate = evaluateScenarioForecastGates([]);
    expect(gate.scenarioOrdering?.status).toBe("not-applicable");
    expect(gate.blocked).toBeNull();
  });
});
