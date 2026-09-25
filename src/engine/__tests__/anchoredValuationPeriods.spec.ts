/**
 * Latest-anchored valuation periods — on real data (ITC).
 *
 * @vitest-environment jsdom
 *
 * computeValuation treats periods[0] as the valuation date. The Valuation,
 * Academic, Comparison and V3 surfaces used to hand it raw history, dating the
 * whole valuation at the oldest balance sheet. These pin the replacement:
 *  1. the valuation date is the LATEST reported period, forecast years follow;
 *  2. with the base card's own ke/kw/g it reproduces the command center's base
 *     case exactly — the Valuation tab's cards and hero share one forecast;
 *  3. the anchor balance sheet is today's, so implied P/B is against today's book.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseCapitalineZip } from "../capitalineParser";
import { processCompanyDataFull } from "../pipeline";
import { buildValuationCommandCenter } from "../valuationCommandCenter/core";
import { resolveShareBasis } from "../shareCountTools";
import { resolveValuationReadiness } from "../valuationPolicy";
import { computeValuation } from "../PenmanNissimEngine";
import { buildAnchoredValuationPeriods } from "../anchoredValuationPeriods";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../types";
import { INRAbsolute } from "../types/units";
import type { ValuationScenarioCard } from "../valuationCommandCenter/types";

const ZIP_PATH = resolve(__dirname, "../../../public/data/companies", "ITC", "ITC.zip");
const itIfData = existsSync(ZIP_PATH) ? it : it.skip;

describe("buildAnchoredValuationPeriods (ITC)", () => {
  let history: RecastPeriod[] = [];
  let config: EngineConfig = DEFAULT_CONFIG;
  let baseCard: ValuationScenarioCard | null = null;

  beforeAll(async () => {
    if (!existsSync(ZIP_PATH)) return;
    const parsed = await parseCapitalineZip(new File([readFileSync(ZIP_PATH)], "ITC.zip", { type: "application/zip" }));
    config = { ...DEFAULT_CONFIG, company_type: "consumer", market_price: INRAbsolute(440) };
    const periods = processCompanyDataFull(parsed.periods, config).periods;
    const readiness = resolveValuationReadiness(periods);
    history = periods.slice(0, Math.max(2, readiness.anchorIndex + 1));
    baseCard = buildValuationCommandCenter({ data: periods, config }).scenarios.find((s) => s.key === "base") ?? null;
  }, 120_000);

  itIfData("dates the valuation at the latest period and steps forward a year at a time", () => {
    const latest = history[history.length - 1]!;
    const periods = buildAnchoredValuationPeriods({ history, config, ke: 0.12, kw: 0.11, g: 0.04 });
    expect(periods[0]).toBe(latest);
    expect(periods.length).toBeGreaterThan(1);
    const latestYear = Number(latest.period_end.slice(0, 4));
    periods.slice(1).forEach((p, i) => {
      expect(Number(p.period_end.slice(0, 4))).toBe(latestYear + i + 1);
    });
  });

  itIfData("reproduces the command center's base case from the same ke/kw/g", () => {
    expect(baseCard).not.toBeNull();
    const { ke, kw, g } = baseCard!.assumptions;
    const valuationConfig = resolveShareBasis(history, config).valuationConfig;
    const periods = buildAnchoredValuationPeriods({ history, config, ke, kw, g });
    const val = computeValuation(periods, ke, kw, g, valuationConfig);
    expect(val.V_RE_CV3).not.toBeNull();
    expect(val.V_RE_CV3!).toBeCloseTo(baseCard!.valuation.V_RE_CV3!, 6);
    expect(val.V_ReOI_CV03!).toBeCloseTo(baseCard!.valuation.V_ReOI_CV03!, 6);
  });

  itIfData("anchors book value on today's balance sheet, not the oldest one", () => {
    const latest = history[history.length - 1]!;
    const oldest = history[0]!;
    expect(latest.bs.CSE).not.toBe(oldest.bs.CSE);
    const val = computeValuation(
      buildAnchoredValuationPeriods({ history, config, ke: 0.12, kw: 0.11, g: 0.04 }),
      0.12, 0.11, 0.04, config,
    );
    expect(val.CSE0).toBe(latest.bs.CSE);
    expect(val.NFO0).toBe(latest.bs.NFO);
  });
});
