import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import { processCompanyDataFull } from "../../pipeline";
import { ACTIVE_MARKET_PACKS } from "../../marketPacks";
import { DEFAULT_CONFIG } from "../../types";
import { INRAbsolute } from "../../types/units";
import { computeValuation } from "../../PenmanNissimEngine";
import { adaptForecastCaseToLegacyValuation, buildIndustrialForecastFromLegacyScenario, legacyValuationAnchor } from "../../forecastState";
import { buildValuationCommandCenter } from "../core";
import { valuationPeriodDividendsPerShare } from "../helpers";

// TCS: owners paid most of each year's earnings, so the case's distributions
// reach every card's dividend value and its carry to the price's date.
const FOLDER = "Tata Consultancy Services Ltd";
const CONFIG = { ...DEFAULT_CONFIG, company_type: "it-services" as const, market_price: INRAbsolute(3100) };
let cc: ReturnType<typeof buildValuationCommandCenter>;

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: FOLDER });
  cc = buildValuationCommandCenter({ data: processCompanyDataFull(parsed.periods, CONFIG).periods, config: CONFIG, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-09-26" });
}, 120_000);

describe("scenario cards value their forecast cases", () => {
  it("values each card on its scenario's forecast case, the native engine's balanced statements", () => {
    expect(cc.scenarios).toHaveLength(4);
    for (const card of cc.scenarios) {
      expect(card.forecastSource).toEqual({ kind: "forecast-case" });
      // The card carries the solved kw; its case was built at the structural
      // seed, as buildScenarioCards builds it, on the run's own config.
      const forecastCase = buildIndustrialForecastFromLegacyScenario({
        caseId: card.key,
        label: card.label,
        scenario: { ...card.scenario, drivers: { ...card.scenario.drivers, kw: card.kwConsistency?.kwStructural ?? card.scenario.drivers.kw } },
        latest: cc.anchorPeriod,
        config: CONFIG,
        analysisWindowId: "spec",
        assumptionIds: [],
        evidenceRefs: [],
        probabilityStatus: "not-assigned",
        probabilityRationale: null,
      });
      expect(forecastCase.status).toBe("computed");
      if (forecastCase.status !== "computed") continue;
      const periods = adaptForecastCaseToLegacyValuation(legacyValuationAnchor(cc.anchorPeriod), forecastCase.forecastCase);
      const { ke, kw, g } = card.valuation;
      const valued = computeValuation(periods, ke, kw, g, cc.shareBasis.valuationConfig);
      expect(valued.V_RE_CV3).toBe(card.valuation.V_RE_CV3);
      expect(valued.perShare?.intrinsic_ddm_per_share).toBe(card.valuation.perShare?.intrinsic_ddm_per_share);
      // The distributions that carry the value to the price's date are the case's.
      const shares = cc.shareBasis.sharesForPerShare ?? cc.shareBasis.shares ?? null;
      expect(card.dividendsPerShare).toEqual(valuationPeriodDividendsPerShare(periods, shares));
    }
  });
});
