/* ================================================================
   Pack freshness guard.

   The property that matters is not "the function returns findings" but
   that its verdict tracks the RESOLVER's. A guard that fires on dates
   the resolver still accepts is noise; one that stays quiet on dates the
   resolver rejects is worse than nothing, because it certifies a run as
   sourced while the discount rate has already fallen back to a prior.
   Several tests below therefore assert both sides at once.
================================================================ */

import { describe, expect, it } from "vitest";
import {
  PACK_FRESHNESS_LEAD_DAYS,
  checkPackFreshness,
} from "../packFreshness";
import { MACRO_STALENESS_DAYS, resolveMacroObservation, type MacroPack } from "../macroPack";
import { BETA_STALENESS_DAYS, resolveEquityBeta, type EquityBetaPack } from "../equityBetaPack";
import { INDIA_MACRO_PACK } from "../indiaMacroPack";
import { INDIA_EQUITY_BETA_PACK } from "../indiaEquityBetaPack";

/** `days` after `iso`, as YYYY-MM-DD. */
function plusDays(iso: string, days: number): string {
  const t = Date.parse(iso) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function macroPack(overrides?: Partial<MacroPack>): MacroPack {
  return {
    asOf: "2026-07-01",
    riskFreeRate: { value: 0.068, asOf: "2026-07-01", source: "test G-Sec series" },
    equityRiskPremium: { value: 0.07, asOf: "2026-07-01", source: "test ERP table" },
    longRunNominalGrowth: null,
    ...overrides,
  };
}

function betaPack(windowEnd: string, tickers: readonly string[] = ["TCS"]): EquityBetaPack {
  return {
    asOf: windowEnd,
    benchmark: "TEST INDEX",
    frequency: "weekly",
    source: "test history",
    constituents: tickers.map((ticker) => ({
      ticker,
      leveredBeta: 0.9,
      standardError: 0.05,
      rSquared: 0.4,
      observations: 260,
      windowStart: "2021-08-01",
      windowEnd,
    })),
  };
}

describe("pack freshness — quiet while the resolver is happy", () => {
  it("reports nothing for a pack well inside every window", () => {
    const asOf = "2026-07-01";
    const findings = checkPackFreshness({
      macroPack: macroPack(),
      betaPack: betaPack(asOf),
      analysisAsOf: asOf,
    });
    expect(findings).toEqual([]);
  });

  it("stays quiet one day before the lead time opens, and the resolver still accepts it", () => {
    // Non-vacuity partner to the `expiring` test below: this pins the exact day
    // the guard starts speaking, so a wrong comparison operator fails here
    // rather than silently shifting the warning window by a day.
    const quietAge = MACRO_STALENESS_DAYS.riskFreeRate - PACK_FRESHNESS_LEAD_DAYS - 1;
    const analysisAsOf = plusDays("2026-07-01", quietAge);
    const pack = macroPack();

    expect(checkPackFreshness({ macroPack: pack, analysisAsOf })).toEqual([]);
    expect(resolveMacroObservation("riskFreeRate", pack.riskFreeRate, analysisAsOf).status).toBe("usable");
  });

  it("ignores a null observation rather than reporting a permanent failure", () => {
    // `longRunNominalGrowth` is null in the shipped pack on purpose. Reporting
    // it would make this check unfixable-red forever.
    const findings = checkPackFreshness({
      macroPack: macroPack({ longRunNominalGrowth: null }),
      analysisAsOf: "2026-07-01",
    });
    expect(findings).toEqual([]);
  });

  it("reports nothing when no pack is supplied at all", () => {
    expect(checkPackFreshness({ analysisAsOf: "2026-07-01" })).toEqual([]);
    expect(checkPackFreshness({ macroPack: null, betaPack: null, analysisAsOf: "2026-07-01" })).toEqual([]);
  });
});

describe("pack freshness — speaks before the resolver changes its mind", () => {
  it("warns inside the lead time while the observation is STILL usable", () => {
    // The whole point of the lead time: red here, sourced still. Refreshing now
    // means no run ever silently discounts at a prior.
    const analysisAsOf = plusDays("2026-07-01", MACRO_STALENESS_DAYS.riskFreeRate - 1);
    const pack = macroPack();
    const findings = checkPackFreshness({ macroPack: pack, analysisAsOf });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("expiring");
    expect(findings[0]!.label).toBe("macro riskFreeRate");
    expect(findings[0]!.limitDays).toBe(MACRO_STALENESS_DAYS.riskFreeRate);
    // Still sourced at this date — the guard is ahead of the fallback, not after it.
    expect(resolveMacroObservation("riskFreeRate", pack.riskFreeRate, analysisAsOf).status).toBe("usable");
  });

  it("escalates to expired exactly when the resolver starts falling back", () => {
    const analysisAsOf = plusDays("2026-07-01", MACRO_STALENESS_DAYS.riskFreeRate + 1);
    const pack = macroPack();
    const findings = checkPackFreshness({ macroPack: pack, analysisAsOf });

    expect(findings.map((f) => f.severity)).toContain("expired");
    expect(resolveMacroObservation("riskFreeRate", pack.riskFreeRate, analysisAsOf).status).toBe("unusable");
  });

  it("flags look-ahead, matching the resolver's refusal to back-date", () => {
    const analysisAsOf = "2026-06-01"; // before the observation date
    const pack = macroPack();
    const findings = checkPackFreshness({ macroPack: pack, analysisAsOf });

    expect(findings.every((f) => f.severity === "look-ahead")).toBe(true);
    expect(findings).not.toHaveLength(0);
    expect(resolveMacroObservation("riskFreeRate", pack.riskFreeRate, analysisAsOf).status).toBe("unusable");
  });

  it("uses each observation's own window, not one shared limit", () => {
    // The ERP window is 365 days and the risk-free window is 30. At 60 days the
    // rf is long gone and the ERP is nowhere near due; a single shared limit
    // would get one of them wrong.
    const analysisAsOf = plusDays("2026-07-01", 60);
    const findings = checkPackFreshness({ macroPack: macroPack(), analysisAsOf });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.label).toBe("macro riskFreeRate");
    expect(findings[0]!.severity).toBe("expired");
  });

  it("reports an unparseable date as expired rather than passing it through", () => {
    const findings = checkPackFreshness({
      macroPack: macroPack({ riskFreeRate: { value: 0.068, asOf: "not-a-date", source: "test" } }),
      analysisAsOf: "2026-07-01",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("expired");
    expect(findings[0]!.detail).toMatch(/unparseable/);
  });

  it("orders findings worst-first", () => {
    const findings = checkPackFreshness({
      macroPack: macroPack({
        // Expired: 30-day window, 90 days old.
        riskFreeRate: { value: 0.068, asOf: "2026-04-02", source: "test" },
        // Look-ahead: dated after the analysis date.
        equityRiskPremium: { value: 0.07, asOf: "2026-08-01", source: "test" },
      }),
      analysisAsOf: "2026-07-01",
    });
    expect(findings.map((f) => f.severity)).toEqual(["look-ahead", "expired"]);
  });
});

describe("pack freshness — beta windows", () => {
  it("groups constituents by window end instead of printing one line per ticker", () => {
    const analysisAsOf = plusDays("2026-01-01", BETA_STALENESS_DAYS + 1);
    const pack = betaPack("2026-01-01", ["TCS", "INFY", "ITC", "SBIN"]);
    const findings = checkPackFreshness({ betaPack: pack, analysisAsOf });

    expect(findings).toHaveLength(1);
    expect(findings[0]!.label).toBe("beta window");
    expect(findings[0]!.detail).toMatch(/4 constituents/);
    // Same verdict the resolver reaches for a named ticker in that pack.
    expect(resolveEquityBeta(pack, "TCS", { analysisAsOf }).status).toBe("unusable");
  });

  it("separates genuinely different window ends", () => {
    const mixed: EquityBetaPack = {
      ...betaPack("2026-01-01", ["TCS"]),
      constituents: [
        ...betaPack("2026-01-01", ["TCS"]).constituents,
        ...betaPack("2025-01-01", ["INFY"]).constituents,
      ],
    };
    const findings = checkPackFreshness({
      betaPack: mixed,
      analysisAsOf: plusDays("2026-01-01", BETA_STALENESS_DAYS + 1),
    });
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((f) => f.asOf))).toEqual(new Set(["2026-01-01", "2025-01-01"]));
  });
});

describe("pack freshness — the shipped packs", () => {
  // Dates derived from the packs' own contents, never hardcoded. A literal
  // "fresh on 2026-07-28" assertion would invert into a failure the moment
  // someone regenerates a pack with later dates, which is the opposite of what
  // this suite should reward.
  it("finds the shipped packs clean on the day their newest observation lands", () => {
    const rfAsOf = INDIA_MACRO_PACK.riskFreeRate?.asOf;
    expect(rfAsOf, "the shipped macro pack should carry a risk-free observation").toBeTruthy();
    const findings = checkPackFreshness({
      macroPack: INDIA_MACRO_PACK,
      analysisAsOf: rfAsOf!,
    });
    expect(findings).toEqual([]);
  });

  it("finds the shipped beta pack clean on its own window end", () => {
    const windowEnd = INDIA_EQUITY_BETA_PACK.constituents[0]?.windowEnd;
    expect(windowEnd).toBeTruthy();
    expect(checkPackFreshness({ betaPack: INDIA_EQUITY_BETA_PACK, analysisAsOf: windowEnd! })).toEqual([]);
  });

  it("would flag the shipped macro pack once its risk-free window lapses", () => {
    // Non-vacuity guard for the two tests above: they pass trivially if the
    // function ever returns [] unconditionally.
    const rfAsOf = INDIA_MACRO_PACK.riskFreeRate!.asOf;
    const findings = checkPackFreshness({
      macroPack: INDIA_MACRO_PACK,
      analysisAsOf: plusDays(rfAsOf, MACRO_STALENESS_DAYS.riskFreeRate + 1),
    });
    expect(findings.map((f) => f.label)).toContain("macro riskFreeRate");
  });
});
