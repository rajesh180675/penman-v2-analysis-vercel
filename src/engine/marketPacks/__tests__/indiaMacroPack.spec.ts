/**
 * Tests for the pinned India macro pack.
 *
 * Every assertion uses an EXPLICIT analysis date. None of them read the clock:
 * a test that resolved the pack against `new Date()` would pass today, go red
 * in 30 days when the risk-free observation crosses its staleness window, and
 * look like a code regression when it is really a calendar event.
 *
 * That same property is why the engine must not default `analysisAsOf` to
 * "now" — see the determinism note in the wiring discussion. The pack's job is
 * to be reproducible, and a value whose tier depends on when you ran it is not.
 */

import { describe, expect, it } from "vitest";
import { INDIA_MACRO_PACK, INDIA_ERP_BASIS } from "../indiaMacroPack";
import { MACRO_STALENESS_DAYS, resolveMacroPack, resolveMacroObservation } from "../macroPack";

/** The pack's own assembly date — the reference point for "fresh" below. */
const PACK_DATE = "2026-07-26";

describe("INDIA_MACRO_PACK — shape and units", () => {
  it("states values as decimal fractions, not percentages", () => {
    // The single most likely data-entry error: 6.82 for 6.82%. A percentage
    // would sail past a naive "is it a number" check and inflate every
    // discount rate in the system by two orders of magnitude.
    expect(INDIA_MACRO_PACK.riskFreeRate!.value).toBeLessThan(0.20);
    expect(INDIA_MACRO_PACK.riskFreeRate!.value).toBeGreaterThan(0.01);
    expect(INDIA_MACRO_PACK.equityRiskPremium!.value).toBeLessThan(0.15);
    expect(INDIA_MACRO_PACK.equityRiskPremium!.value).toBeGreaterThan(0.01);
  });

  it("carries the exact published figures", () => {
    // Pinned so a refresh is a visible, deliberate edit rather than drift.
    expect(INDIA_MACRO_PACK.riskFreeRate!.value).toBe(0.0682);
    expect(INDIA_MACRO_PACK.riskFreeRate!.asOf).toBe("2026-07-24");
    expect(INDIA_MACRO_PACK.equityRiskPremium!.value).toBe(0.0708);
    expect(INDIA_MACRO_PACK.equityRiskPremium!.asOf).toBe("2026-01-05");
  });

  it("attributes the risk-free rate to where it actually came from", () => {
    // Guards against a plausible-looking upgrade of the attribution. The
    // figure came from an aggregator reporting the benchmark series, not from
    // an RBI publication, and the source string must not claim otherwise —
    // a false attribution is worse than an honest `prior`.
    const source = INDIA_MACRO_PACK.riskFreeRate!.source;
    expect(source).toMatch(/Trading Economics/i);
    expect(source).toMatch(/10Y|10-year/i);
  });

  it("records the ERP construction and its basis", () => {
    // 7.08% is not a primitive observation, it is 4.23% + 2.85%. If the source
    // string loses that, a reviewer cannot tell it apart from the 5.23%
    // CDS-based alternative in the same table.
    expect(INDIA_MACRO_PACK.equityRiskPremium!.source).toMatch(/4\.23/);
    expect(INDIA_MACRO_PACK.equityRiskPremium!.source).toMatch(/2\.85/);
    expect(INDIA_MACRO_PACK.equityRiskPremium!.source).toMatch(/Damodaran/i);
    expect(INDIA_ERP_BASIS).toBe("ratings-based");
  });

  it("leaves long-run nominal growth unsourced rather than guessing it", () => {
    // Deliberately null: a perpetual growth ceiling is a structural judgment,
    // not a published observation. See the file header.
    expect(INDIA_MACRO_PACK.longRunNominalGrowth).toBeNull();
  });

  it("dates the observations no later than the pack itself", () => {
    for (const key of ["riskFreeRate", "equityRiskPremium"] as const) {
      const observation = INDIA_MACRO_PACK[key];
      expect(Date.parse(observation!.asOf)).toBeLessThanOrEqual(Date.parse(INDIA_MACRO_PACK.asOf));
    }
  });
});

describe("INDIA_MACRO_PACK — resolution against a fixed analysis date", () => {
  it("resolves the risk-free rate and ERP as sourced when fresh", () => {
    const resolution = resolveMacroPack(INDIA_MACRO_PACK, PACK_DATE);
    expect(resolution.riskFreeRate.status).toBe("usable");
    expect(resolution.equityRiskPremium.status).toBe("usable");
  });

  it("reports incomplete, because the growth ceiling is unsourced", () => {
    const resolution = resolveMacroPack(INDIA_MACRO_PACK, PACK_DATE);
    // `complete` gates the "fully sourced capital cost" claim. Two of three
    // sourced must not read as all three.
    expect(resolution.complete).toBe(false);
    expect(resolution.longRunNominalGrowth.status).toBe("unusable");
    if (resolution.longRunNominalGrowth.status === "unusable") {
      expect(resolution.longRunNominalGrowth.reason).toMatch(/No pinned/i);
    }
  });

  it("demotes the risk-free rate once it passes its 30-day window", () => {
    // 2026-07-24 + 31 days. The ERP's window is a year, so it survives —
    // which is the point of per-key windows rather than one shared limit.
    const later = "2026-08-24";
    const resolution = resolveMacroPack(INDIA_MACRO_PACK, later);
    expect(resolution.riskFreeRate.status).toBe("unusable");
    if (resolution.riskFreeRate.status === "unusable") {
      expect(resolution.riskFreeRate.reason).toMatch(/days old/);
    }
    expect(resolution.equityRiskPremium.status).toBe("usable");
  });

  it("rejects the pack as look-ahead when valuing an earlier date", () => {
    // A 2026 rate cannot inform a 2025 valuation. This is the guard that makes
    // the pack unusable for backtesting without a vintage-appropriate pack,
    // and it must fire rather than quietly supplying a future rate.
    const resolution = resolveMacroPack(INDIA_MACRO_PACK, "2025-03-31");
    expect(resolution.riskFreeRate.status).toBe("unusable");
    if (resolution.riskFreeRate.status === "unusable") {
      expect(resolution.riskFreeRate.reason).toMatch(/look-ahead/i);
    }
    expect(resolution.equityRiskPremium.status).toBe("unusable");
  });

  it("skips age checks when no analysis date is supplied", () => {
    // Deterministic path: with no analysis date the observations still pass
    // finiteness, band, source and date validation, so they resolve sourced.
    // Documented because it is the behaviour a caller gets by default.
    const resolution = resolveMacroPack(INDIA_MACRO_PACK, null);
    expect(resolution.riskFreeRate.status).toBe("usable");
    expect(resolution.equityRiskPremium.status).toBe("usable");
  });

  it("keeps the staleness windows this pack was written against", () => {
    // If these move, the freshness assertions above stop meaning what they say.
    expect(MACRO_STALENESS_DAYS.riskFreeRate).toBe(30);
    expect(MACRO_STALENESS_DAYS.equityRiskPremium).toBe(365);
  });
});

describe("macro observation validation — guards the pack relies on", () => {
  it("rejects a percentage entered where a fraction was expected", () => {
    const status = resolveMacroObservation(
      "riskFreeRate",
      { value: 6.82, asOf: "2026-07-24", source: "typo" },
      PACK_DATE,
    );
    expect(status.status).toBe("unusable");
    if (status.status === "unusable") expect(status.reason).toMatch(/plausible band/);
  });

  it("rejects an unattributed value", () => {
    const status = resolveMacroObservation(
      "riskFreeRate",
      { value: 0.0682, asOf: "2026-07-24", source: "   " },
      PACK_DATE,
    );
    expect(status.status).toBe("unusable");
    if (status.status === "unusable") expect(status.reason).toMatch(/no source/i);
  });
});
