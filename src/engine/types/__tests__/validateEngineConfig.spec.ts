/* ================================================================
   validateEngineConfig — the terminal-growth check.

   `validateEngineConfig` had no spec at all. The terminal-growth check
   read `cfg.terminal_growth_rate ?? 0.05` and compared that hardcoded
   5% against ke on every config, but nothing in the app writes that
   field: no UI control, absent from DEFAULT_CONFIG, absent from every
   company data file. So the check could not fire on a real breach, and
   did fire on a config whose only sin was a low ke.

   That is not a cosmetic warning. On the AnalysisRun path a config
   "error" becomes a diagnostic "blocker" (`analysisRun/legacyExecutor.ts:359`)
   at `request-validation`, the first stage in `ANALYSIS_STAGE_ORDER` — so
   the run stopped before reading a single period. The blocking is
   asserted end-to-end in `analysisRun/__tests__/legacyExecutor.spec.ts`;
   this spec covers the decision the validator itself makes.
================================================================ */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type EngineConfig, validateEngineConfig } from "../index";
import { PercentFraction } from "../units";

/**
 * A defensively low manual ke — the shape of the false positive. 4.5% is
 * deliberately just above the validator's own 4% floor, so the ke range check
 * stays silent and any warning this config produces has to have come from the
 * terminal-growth branch.
 */
const LOW_KE: EngineConfig = {
  ...DEFAULT_CONFIG,
  cost_of_equity_mode: "manual",
  ke: PercentFraction(0.045),
  ke_manual_rationale: "Reviewer judgment",
};

function growthWarnings(config: EngineConfig) {
  return validateEngineConfig(config).filter((w) => w.field === "terminal_growth_rate");
}

describe("validateEngineConfig — terminal growth", () => {
  it("does not judge a terminal growth the config never set", () => {
    // The regression test for the false positive. Before the fix this config
    // produced an error reading "terminal_growth_rate (5.0%) ≥ ke (4.5%)" for a
    // field the reviewer never touched — and blocked the run.
    expect(LOW_KE.terminal_growth_rate).toBeUndefined();
    expect(growthWarnings(LOW_KE)).toEqual([]);
    // Nothing else in this config is wrong either, so the whole run should be
    // clean. Asserting the full list catches a future check that reintroduces a
    // default under a different field name.
    expect(validateEngineConfig(LOW_KE)).toEqual([]);
  });

  it("still errors when a caller actually sets a breaching terminal growth", () => {
    // The positive control. `computeBankValuation` reads this field unclamped
    // (`bankValuation/computeBankValuation.ts:78`), so a set value really is
    // the growth a Gordon denominator would use — the check is live, not
    // decorative, and it must survive the fix.
    const warnings = growthWarnings({ ...LOW_KE, terminal_growth_rate: 0.05 });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe("error");
    expect(warnings[0]!.value).toBeCloseTo(0.05, 12);
    // Both sides of the comparison, so a reviewer can see which one to move.
    expect(warnings[0]!.message).toContain("5.0%");
    expect(warnings[0]!.message).toContain("4.5%");
  });

  it("does not promise a blow-up the bank models already prevent", () => {
    // The message said "valuation will blow up". It will not: all three
    // Gordon-based bank models guard on MIN_KE_MINUS_G and return
    // `skipped(...)` before dividing (`bankValuation/coreModels.ts:48`, `:143`,
    // and the terminal-value guard at `:112`) — see the "skips when ke − g is
    // below the guardrail" cases in `bankValuation.spec.ts`. Describing
    // arithmetic that never runs sends the reviewer looking for an infinity
    // that is not there.
    const message = growthWarnings({ ...LOW_KE, terminal_growth_rate: 0.05 })[0]!.message;

    expect(message).not.toMatch(/blow up/i);
    expect(message).toContain("decline to value");
  });

  it("warns rather than errors above the GDP proxy when the spread is still positive", () => {
    // g = 11% under a 13% ke: implausible but arithmetically fine, so this must
    // stay a warning. Guards against collapsing the two branches into one.
    const warnings = growthWarnings({ ...DEFAULT_CONFIG, terminal_growth_rate: 0.11 });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe("warning");
    expect(warnings[0]!.message).toContain("nominal GDP growth proxy");
  });

  it("stays silent on a plausible set value", () => {
    // Negative control for both branches above: 4% under the default 13% ke is
    // neither a breach nor implausible.
    expect(growthWarnings({ ...DEFAULT_CONFIG, terminal_growth_rate: 0.04 })).toEqual([]);
  });
});
