/**
 * Every scenario is valued at a kw consistent with its own ke and forecast,
 * and where none exists, on residual earnings alone.
 *
 * @vitest-environment jsdom
 *
 * Held at the base case's kw, NTPC's stress case was valued at 8.89% while
 * its equity weight collapsed and its forecast still borrowed at 3.48%: RE
 * ₹88.7, ReOI −₹92.6 a share, and their median, −₹1.95, was shown as equity
 * worth nothing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scenarioValueBasis } from "../builders";
import { buildValuationCommandCenter } from "../core";
import type { ValuationCommandCenterOutput } from "../types";
import type { KwConsistency } from "../../valueConsistentKw";
import { RE_REOI_BLOCK_GAP, reReoiGap } from "../../reReoiConsistency";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG, type EngineConfig, type ValuationResult } from "../../types";

const valuationOf = (re: number | null, reoi: number | null) =>
  ({ perShare: { intrinsic_re_per_share: re, intrinsic_reoi_per_share: reoi } }) as ValuationResult;
const solved: KwConsistency = { kwStructural: 0.09, kw: 0.08, kd: 0.035, method: "value-consistent", reason: null };
const kept: KwConsistency = { kwStructural: 0.09, kw: 0.09, kd: 0.035, method: "structural", reason: "The value-weighted kw falls to the terminal growth rate." };

describe("scenarioValueBasis", () => {
  it("takes the RE/ReOI median where a kw reconciles them", () => {
    expect(scenarioValueBasis("stress", valuationOf(100, 104), solved)).toEqual({ model: "re-reoi", reason: null });
  });

  it("takes residual earnings alone, saying why, where the solve does not settle", () => {
    const basis = scenarioValueBasis("stress", valuationOf(88.7, -92.6), kept);
    expect(basis.model).toBe("re");
    expect(basis.reason).toContain("falls to the terminal growth rate");
  });

  it("takes residual earnings alone where the two stay beyond the block gap at the settled kw", () => {
    expect(reReoiGap(100, 140)!).toBeGreaterThan(RE_REOI_BLOCK_GAP);
    expect(scenarioValueBasis("stress", valuationOf(100, 140), solved).model).toBe("re");
    expect(reReoiGap(100, 120)!).toBeLessThan(RE_REOI_BLOCK_GAP);
    expect(scenarioValueBasis("stress", valuationOf(100, 120), solved).model).toBe("re-reoi");
  });

  it("keeps the base case on the median, which the rigor ladder gates and break-even re-values", () => {
    expect(scenarioValueBasis("base", valuationOf(100, 140), kept)).toEqual({ model: "re-reoi", reason: null });
  });

  it("keeps the median when either model is missing", () => {
    expect(scenarioValueBasis("stress", valuationOf(null, 50), kept).model).toBe("re-reoi");
  });
});

const ZIP = resolve(__dirname, "../../../../public/data/companies/NTPC/NTPC.zip");
const itIfData = existsSync(ZIP) ? it : it.skip;

describe("NTPC's scenarios, each at its own kw", () => {
  let cc: ValuationCommandCenterOutput | null = null;

  beforeAll(async () => {
    if (!existsSync(ZIP)) return;
    const parsed = await parseCapitalineZip(new File([readFileSync(ZIP)], "NTPC.zip", { type: "application/zip" }));
    // The app's config for a library company (configForCompany): the ticker
    // keys the beta pack, so the cost of equity is NTPC's own.
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "utility", ticker: "NTPC" };
    // With the packs and a date, as the app's run resolves its cost of equity.
    cc = buildValuationCommandCenter({ data: processCompanyDataFull(parsed.periods, config).periods, config, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-14" });
  }, 120_000);

  itIfData("values the historical panic on residual earnings, above zero, where no kw reconciles its models", () => {
    const panic = cc!.scenarios.find((s) => s.key === "historical-panic")!;
    expect(panic.kwConsistency?.method).toBe("structural");
    expect(panic.valueBasis?.model).toBe("re");
    expect(panic.intrinsicPerShare).toBe(panic.valuation.perShare!.intrinsic_re_per_share);
    expect(panic.intrinsicPerShare!).toBeGreaterThan(0);
  });

  itIfData("values the stress case above zero, at a kw of its own", () => {
    const stress = cc!.scenarios.find((s) => s.key === "stress")!;
    const base = cc!.scenarios.find((s) => s.key === "base")!;
    expect(stress.intrinsicPerShare!).toBeGreaterThan(0);
    // Its own solve, not the base's kw moved by the preset's tilt.
    expect(stress.kwConsistency!.kw).not.toBeCloseTo(base.kwConsistency!.kw + (stress.kwConsistency!.kwStructural - base.kwConsistency!.kwStructural), 4);
  });

  itIfData("keeps every case whose models agree within the block gap, and the cases in order", () => {
    for (const card of cc!.scenarios) {
      if (card.valueBasis?.model !== "re-reoi") continue;
      const { intrinsic_re_per_share: re, intrinsic_reoi_per_share: reoi } = card.valuation.perShare!;
      expect(reReoiGap(re!, reoi!)!, card.key).toBeLessThanOrEqual(RE_REOI_BLOCK_GAP);
    }
    const value = (key: string) => cc!.scenarios.find((s) => s.key === key)!.intrinsicPerShare!;
    expect(value("historical-panic")).toBeLessThanOrEqual(value("stress"));
    expect(value("stress")).toBeLessThanOrEqual(value("base"));
    expect(value("base")).toBeLessThanOrEqual(value("bull"));
  });
});
