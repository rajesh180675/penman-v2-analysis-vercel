/**
 * Phase B5.2 — bankAssetQuality signal tests
 *
 * Tests each derived signal:
 * - NPA cycle position (rising/peaking/improving/stable)
 * - PCR trend
 * - Slippage trajectory
 * - Loan growth vs system
 * - Deposit franchise (CASA level + trend)
 * - Capital buffer severity
 * - Skip-with-reason on insufficient/missing data
 */

import { describe, expect, it } from "vitest";
import {
  computeBankAssetQuality,
  DEFAULT_SYSTEM_CREDIT_GROWTH_PCT,
  RBI_TIER1_MINIMUM_PCT,
} from "../bankAssetQuality";
import type { BankQualityPeriod } from "../bankQualityIndicators";

/** Helper — build a period with sensible defaults so tests stay focused. */
function p(period_end: string, overrides: Partial<BankQualityPeriod> = {}): BankQualityPeriod {
  return { period_end, ...overrides };
}

// ─── Coverage / smoke ───────────────────────────────────────────────

describe("computeBankAssetQuality — empty / null inputs", () => {
  it("returns skip-with-reason for every signal when input is null", () => {
    const r = computeBankAssetQuality(null);
    expect(r.npaCycle.dataSufficient).toBe(false);
    expect(r.pcrTrend.dataSufficient).toBe(false);
    expect(r.slippage.dataSufficient).toBe(false);
    expect(r.loanGrowth.dataSufficient).toBe(false);
    expect(r.depositFranchise.dataSufficient).toBe(false);
    expect(r.capitalBuffer.dataSufficient).toBe(false);
    expect(r.coverage.totalPeriods).toBe(0);
  });

  it("returns skip-with-reason for every signal when input is empty array", () => {
    const r = computeBankAssetQuality([]);
    expect(r.npaCycle.dataSufficient).toBe(false);
    expect(r.coverage.totalPeriods).toBe(0);
  });

  it("each skipped signal carries a non-empty skipReason", () => {
    const r = computeBankAssetQuality([]);
    expect(r.npaCycle.skipReason).toBeTruthy();
    expect(r.pcrTrend.skipReason).toBeTruthy();
    expect(r.slippage.skipReason).toBeTruthy();
    expect(r.loanGrowth.skipReason).toBeTruthy();
    expect(r.depositFranchise.skipReason).toBeTruthy();
    expect(r.capitalBuffer.skipReason).toBeTruthy();
  });
});

// ─── NPA cycle position ─────────────────────────────────────────────

describe("computeBankAssetQuality — NPA cycle position", () => {
  it("flags rising when GNPA climbs and most-recent step is up", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { gnpa_pct: 1.0 }),
      p("2023-03-31", { gnpa_pct: 1.5 }),
      p("2024-03-31", { gnpa_pct: 2.2 }),
      p("2025-03-31", { gnpa_pct: 3.0 }),
    ]);
    expect(r.npaCycle.position).toBe("rising");
    expect(r.npaCycle.latest_gnpa_pct).toBe(3.0);
    expect(r.npaCycle.prior_gnpa_pct).toBe(1.0);
  });

  it("flags peaking when long-run delta is up but most-recent step is flat-or-down", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { gnpa_pct: 1.0 }),
      p("2023-03-31", { gnpa_pct: 2.0 }),
      p("2024-03-31", { gnpa_pct: 3.0 }),
      p("2025-03-31", { gnpa_pct: 2.9 }),
    ]);
    expect(r.npaCycle.position).toBe("peaking");
  });

  it("flags improving when GNPA falls meaningfully", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { gnpa_pct: 5.0 }),
      p("2023-03-31", { gnpa_pct: 4.0 }),
      p("2024-03-31", { gnpa_pct: 2.5 }),
      p("2025-03-31", { gnpa_pct: 1.5 }),
    ]);
    expect(r.npaCycle.position).toBe("improving");
  });

  it("flags stable when GNPA hovers within the threshold band", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { gnpa_pct: 1.3 }),
      p("2023-03-31", { gnpa_pct: 1.4 }),
      p("2024-03-31", { gnpa_pct: 1.2 }),
      p("2025-03-31", { gnpa_pct: 1.3 }),
    ]);
    expect(r.npaCycle.position).toBe("stable");
  });

  it("skips when fewer than 2 periods have GNPA", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { gnpa_pct: 1.3 })]);
    expect(r.npaCycle.dataSufficient).toBe(false);
    expect(r.npaCycle.skipReason).toMatch(/need >=2/);
  });
});

// ─── PCR trend ──────────────────────────────────────────────────────

describe("computeBankAssetQuality — PCR trend", () => {
  it("flags improving when PCR rises by >5pp", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { pcr_pct: 60 }),
      p("2023-03-31", { pcr_pct: 65 }),
      p("2024-03-31", { pcr_pct: 70 }),
      p("2025-03-31", { pcr_pct: 75 }),
    ]);
    expect(r.pcrTrend.direction).toBe("improving");
    expect(r.pcrTrend.summary).toMatch(/PCR rose/);
  });

  it("flags weakening when PCR falls by >5pp", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { pcr_pct: 75 }),
      p("2023-03-31", { pcr_pct: 70 }),
      p("2024-03-31", { pcr_pct: 65 }),
      p("2025-03-31", { pcr_pct: 60 }),
    ]);
    expect(r.pcrTrend.direction).toBe("weakening");
    expect(r.pcrTrend.summary).toMatch(/PCR fell/);
  });

  it("flags stable when PCR moves <=5pp", () => {
    const r = computeBankAssetQuality([
      p("2024-03-31", { pcr_pct: 70 }),
      p("2025-03-31", { pcr_pct: 73 }),
    ]);
    expect(r.pcrTrend.direction).toBe("stable");
  });

  it("skips when fewer than 2 periods have PCR", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { pcr_pct: 70 })]);
    expect(r.pcrTrend.dataSufficient).toBe(false);
  });
});

// ─── Slippage trajectory ───────────────────────────────────────────

describe("computeBankAssetQuality — slippage", () => {
  it("flags improving when slippage trends down meaningfully", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { slippage_pct: 2.5 }),
      p("2023-03-31", { slippage_pct: 2.0 }),
      p("2024-03-31", { slippage_pct: 1.5 }),
      p("2025-03-31", { slippage_pct: 1.0 }),
    ]);
    expect(r.slippage.direction).toBe("improving");
  });

  it("skip reason explains slippage usually missing", () => {
    const r = computeBankAssetQuality([
      p("2024-03-31", { gnpa_pct: 1.5 }),
      p("2025-03-31", { gnpa_pct: 1.3 }),
    ]);
    expect(r.slippage.dataSufficient).toBe(false);
    expect(r.slippage.skipReason).toMatch(/MD&A prose/);
  });
});

// ─── Loan growth vs system ─────────────────────────────────────────

describe("computeBankAssetQuality — loan growth", () => {
  it("flags outpacing-system when delta > +3pp", () => {
    const r = computeBankAssetQuality(
      [p("2025-03-31", { advances_growth_pct: 18 })],
      { systemCreditGrowthPct: 12 },
    );
    expect(r.loanGrowth.interpretation).toBe("outpacing-system");
    expect(r.loanGrowth.delta_pp).toBe(6);
  });

  it("flags lagging-system when delta < -3pp", () => {
    const r = computeBankAssetQuality(
      [p("2025-03-31", { advances_growth_pct: 7 })],
      { systemCreditGrowthPct: 12 },
    );
    expect(r.loanGrowth.interpretation).toBe("lagging-system");
  });

  it("flags in-line when within +/-3pp", () => {
    const r = computeBankAssetQuality(
      [p("2025-03-31", { advances_growth_pct: 13 })],
      { systemCreditGrowthPct: 12 },
    );
    expect(r.loanGrowth.interpretation).toBe("in-line-with-system");
  });

  it("uses the default 12% system growth when no override provided", () => {
    const r = computeBankAssetQuality([
      p("2025-03-31", { advances_growth_pct: 14 }),
    ]);
    expect(r.loanGrowth.system_growth_pct).toBe(DEFAULT_SYSTEM_CREDIT_GROWTH_PCT);
  });
});

// ─── Deposit franchise ─────────────────────────────────────────────

describe("computeBankAssetQuality — deposit franchise", () => {
  it("classifies CASA >=40% as premium (HDFC/SBI/Kotak tier)", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { casa_pct: 42 })]);
    expect(r.depositFranchise.level).toBe("premium");
  });

  it("classifies CASA in 30-40% as above-average", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { casa_pct: 35 })]);
    expect(r.depositFranchise.level).toBe("above-average");
  });

  it("classifies CASA in 22-30% as average", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { casa_pct: 25 })]);
    expect(r.depositFranchise.level).toBe("average");
  });

  it("classifies CASA <22% as weak", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { casa_pct: 18 })]);
    expect(r.depositFranchise.level).toBe("weak");
  });

  it("emits trend when 2+ periods are present", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { casa_pct: 35 }),
      p("2023-03-31", { casa_pct: 36 }),
      p("2024-03-31", { casa_pct: 39 }),
      p("2025-03-31", { casa_pct: 42 }),
    ]);
    expect(r.depositFranchise.trend).toBe("improving");
  });

  it("trend is null when only one CASA observation exists", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { casa_pct: 42 })]);
    expect(r.depositFranchise.trend).toBeNull();
  });
});

// ─── Capital buffer ────────────────────────────────────────────────

describe("computeBankAssetQuality — capital buffer", () => {
  it("flags comfortable when Tier-1 headroom >= 3pp", () => {
    const r = computeBankAssetQuality([
      p("2025-03-31", { tier1_pct: 17.5, crar_pct: 19.6 }),
    ]);
    expect(r.capitalBuffer.severity).toBe("comfortable");
    expect(r.capitalBuffer.headroom_pp).toBeCloseTo(17.5 - RBI_TIER1_MINIMUM_PCT, 5);
  });

  it("flags adequate when headroom is 1-3pp", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { tier1_pct: 11.5 })]);
    expect(r.capitalBuffer.severity).toBe("adequate");
  });

  it("flags thin when headroom is 0-1pp", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { tier1_pct: 10.0 })]);
    expect(r.capitalBuffer.severity).toBe("thin");
  });

  it("flags breach when headroom is negative", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { tier1_pct: 8.0 })]);
    expect(r.capitalBuffer.severity).toBe("breach");
    expect(r.capitalBuffer.headroom_pp).toBeLessThan(0);
  });

  it("falls back to CRAR-as-proxy when Tier-1 missing (with 1.5pp haircut)", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { crar_pct: 13.0 })]);
    // Effective ratio = 13-1.5 = 11.5 vs 9.5 floor = 2.0pp headroom → adequate
    expect(r.capitalBuffer.severity).toBe("adequate");
    expect(r.capitalBuffer.headroom_pp).toBeCloseTo(2.0, 5);
    expect(r.capitalBuffer.latest_tier1_pct).toBeNull();
    expect(r.capitalBuffer.latest_crar_pct).toBe(13.0);
  });

  it("skips when neither Tier-1 nor CRAR present", () => {
    const r = computeBankAssetQuality([p("2025-03-31", { gnpa_pct: 1.5 })]);
    expect(r.capitalBuffer.dataSufficient).toBe(false);
  });
});

// ─── Coverage diagnostic ───────────────────────────────────────────

describe("computeBankAssetQuality — coverage diagnostic", () => {
  it("reports the fraction of populated fields in the latest period", () => {
    const r = computeBankAssetQuality([
      p("2025-03-31", {
        gnpa_pct: 1.3,
        nnpa_pct: 0.4,
        pcr_pct: 70,
        crar_pct: 19.6,
        tier1_pct: 17.5,
        casa_pct: 42,
        advances_growth_pct: 5,
        // slippage_pct missing — so 7/8 = 0.875
      }),
    ]);
    expect(r.coverage.latestFieldDensity).toBeCloseTo(7 / 8, 5);
  });

  it("density is 0 when no quality periods provided", () => {
    const r = computeBankAssetQuality([]);
    expect(r.coverage.latestFieldDensity).toBe(0);
  });
});

// ─── HDFC Bank FY25 realistic shape — end-to-end smoke ────────────

describe("computeBankAssetQuality — HDFC FY25 realistic shape", () => {
  it("produces a complete signal bundle for a well-curated 4y window", () => {
    const r = computeBankAssetQuality([
      p("2022-03-31", { gnpa_pct: 1.17, nnpa_pct: 0.32, pcr_pct: 73, crar_pct: 18.9, tier1_pct: 17.9, casa_pct: 48, advances_growth_pct: 21 }),
      p("2023-03-31", { gnpa_pct: 1.12, nnpa_pct: 0.27, pcr_pct: 76, crar_pct: 19.3, tier1_pct: 17.1, casa_pct: 44, advances_growth_pct: 16.9 }),
      p("2024-03-31", { gnpa_pct: 1.24, nnpa_pct: 0.33, pcr_pct: 73.92, crar_pct: 18.8, tier1_pct: 16.8, casa_pct: 38, advances_growth_pct: 55.4 }),
      p("2025-03-31", { gnpa_pct: 1.33, nnpa_pct: 0.43, pcr_pct: 67.92, crar_pct: 19.6, tier1_pct: 17.69, casa_pct: 34.36, advances_growth_pct: 5.4 }),
    ]);

    // GNPA went 1.17 → 1.33 — a delta of 0.16 < 0.5 threshold → stable
    expect(r.npaCycle.position).toBe("stable");
    // PCR fell 73 → 67.92 = -5.08pp (just past the threshold)
    expect(r.pcrTrend.direction).toBe("weakening");
    // Capital comfortable
    expect(r.capitalBuffer.severity).toBe("comfortable");
    // CASA was 48, now 34.36 — premium → above-average, weakening trend
    expect(r.depositFranchise.level).toBe("above-average");
    expect(r.depositFranchise.trend).toBe("weakening");
    // FY25 advances growth 5.4% << 12% system → lagging
    expect(r.loanGrowth.interpretation).toBe("lagging-system");
    // No slippage in this fixture → skip-with-reason
    expect(r.slippage.dataSufficient).toBe(false);
    // Coverage: every field except slippage is populated → 7/8
    expect(r.coverage.latestFieldDensity).toBeCloseTo(7 / 8, 5);
  });
});
