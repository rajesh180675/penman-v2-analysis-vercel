/**
 * Phase 3 exit criteria (docs/ui-revamp-plan.md), on real bundled data:
 *  - an edited driver's value is the engine's value (revalueBase, the path
 *    behind the base card) and the forecast table is that forecast;
 *  - an edit re-values within 150 ms on the largest bundled company (ITC);
 *  - the Valuation section shows every catalogued model's result.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCapitalineZip } from "../../engine/capitalineParser";
import { processCompanyDataFull } from "../../engine/pipeline";
import { ACTIVE_MARKET_PACKS } from "../../engine/marketPacks";
import { adaptLegacyCommandCenterModelResults } from "../../engine/modelCatalog";
import { buildValuationCommandCenter, formatPct, formatPerShare } from "../../engine/valuationCommandCenter";
import { revalueBase, solveBreakEvens } from "../../engine/valuationCommandCenter/breakEven";
import { DEFAULT_CONFIG, type CompanyType } from "../../engine/types";
import { INRAbsolute } from "../../engine/types/units";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import { crore, percent } from "../format";
import { ForecastSection } from "../sections/ForecastSection";
import { VerdictSection } from "../sections/VerdictSection";
import { CasePage } from "../CasePage";
import { caseRoute } from "../route";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { MARGIN_HISTORY_YEARS } from "../ui/MarginFadeChart";
import { SENSITIVITY_G, SENSITIVITY_KE, ValuationSection } from "../sections/ValuationSection";

type CC = ReturnType<typeof buildValuationCommandCenter>;
const built: Record<string, CC> = {};

async function commandCenter(folder: string, type: CompanyType, price: number): Promise<CC> {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", folder, `${folder}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: folder });
  const config = { ...DEFAULT_CONFIG, company_type: type, market_price: INRAbsolute(price) };
  return buildValuationCommandCenter({ data: processCompanyDataFull(parsed.periods, config).periods, config, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-09-26" });
}

beforeAll(async () => {
  built.TCS = await commandCenter("Tata Consultancy Services Ltd", "it-services", 3100);
  built.ITC = await commandCenter("ITC", "conglomerate", 410);
}, 240_000);

const resultFor = (cc: CC) => ({
  status: "completed",
  run: { family: "industrial" },
  materialization: { commandCenter: cc, modelResults: adaptLegacyCommandCenterModelResults(cc) },
}) as unknown as LegacyAnalysisRunExecutionResult;

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Forecast section", () => {
  it("shows the engine's value and forecast for the reader's edits", () => {
    const cc = built.TCS!;
    const shifts = { sales_growth: 0.02, core_sales_pm: -0.01 };
    const engine = revalueBase(cc, shifts)!;
    const html = text(renderToStaticMarkup(<ForecastSection result={resultFor(cc)} initialShifts={shifts} />));
    expect(html).toContain(`With your changes ${formatPerShare(engine.value)}`);
    expect(html).toContain(`Base case ${formatPerShare(cc.scenarios.find((s) => s.key === "base")!.intrinsicPerShare)}`);
    for (const f of engine.forecast!) {
      expect(html).toContain(`${f.period_label} ${crore(f.Sales_f)} ${percent(f.sales_growth_assumption)} ${percent(f.core_sales_pm_assumption)}`);
    }
  });

  it("withholds the changed value when terminal growth reaches the discount rate", () => {
    const cc = built.TCS!;
    const card = cc.scenarios.find((s) => s.key === "base")!;
    const html = text(renderToStaticMarkup(<ForecastSection result={resultFor(cc)} initialShifts={{ g: card.assumptions.ke - card.assumptions.g }} />));
    expect(html).toContain("Terminal growth must stay below the discount rates.");
  });

  // With a lending arm carved, the filed margins are another business's (M&M
  // FY2025: 12.0% filed, 7.6% valued), and the chart drew them beside the
  // carved forecast. Here the filed recast is marked at 98.7%.
  it("draws reported margins from the periods the forecast is built on, not the filed recast", () => {
    const cc = built.TCS!;
    const filed = cc.basisPeriods.map((p) => ({ ...p, ratios: { ...p.ratios, CoreSalesPM: 0.987 } }));
    const base = resultFor(cc);
    const result = { ...base, materialization: { ...base.materialization, pipelineResult: { periods: filed } } } as unknown as LegacyAnalysisRunExecutionResult;
    const html = text(renderToStaticMarkup(<ForecastSection result={result} />));
    expect(html).not.toContain("98.7%");
    // The chart's table: each reported year beside its margin on the basis.
    for (const p of cc.basisPeriods.slice(-MARGIN_HISTORY_YEARS)) {
      expect(html).toContain(`${p.period_end.slice(0, 4)} ${(p.ratios!.CoreSalesPM! * 100).toFixed(1)}%`);
    }
  });

  it("names a carved lending arm, and draws a frozen forecast only of the same business", () => {
    const cc = built.TCS!;
    const carved = { ...cc, lendingArm: { status: "applied", link: { arm: { name: "X Finance", nseSymbol: "XFIN" } } } } as unknown as CC;
    const year = Number(cc.anchorPeriod.period_end.slice(0, 4));
    const frozen = (basis?: { lendingArm: string | null }) => ({
      madeAt: "2026-10-08",
      cutoffPeriod: cc.anchorPeriod.period_end,
      years: [{ periodEnd: `${year + 1}${cc.anchorPeriod.period_end.slice(4)}`, sales: 100, operatingIncome: 20 }],
      ...(basis ? { basis } : {}),
    });

    const v1 = text(renderToStaticMarkup(<ForecastSection result={resultFor(carved)} frozen={frozen()} />));
    expect(v1).toContain("Without X Finance: the valuation carves the lending arm out");
    expect(v1).toContain("The forecast frozen on 2026-10-08 was of the consolidated statements, lending arm included, so it is not drawn beside this one.");
    expect(v1).not.toContain("Forecast frozen 2026-10-08");

    const same = text(renderToStaticMarkup(<ForecastSection result={resultFor(carved)} frozen={frozen({ lendingArm: "X Finance" })} />));
    expect(same).toContain("Forecast frozen 2026-10-08");
    expect(same).not.toContain("not drawn beside this one");

    const uncarved = text(renderToStaticMarkup(<ForecastSection result={resultFor(cc)} frozen={frozen()} />));
    expect(uncarved).toContain("Forecast frozen 2026-10-08");
    expect(uncarved).not.toContain("Without ");
  });

  // The library's exports run a year behind what 20 of 23 companies have filed
  // (#443): the filed year is the base case's first test, scored as the frozen
  // forecasts are (scoreSnapshotAgainstFilings).
  describe("against the results filed since", () => {
    const cc = () => built.TCS!;
    const anchor = () => cc().anchorPeriod.period_end;
    const nextYear = () => `${Number(anchor().slice(0, 4)) + 1}${anchor().slice(4)}`;
    const OPENING_EQUITY = 100_000;
    /** The anchor year and the one after, filed: sales 10% under the forecast, owners' profit 2 ROE points under it. */
    const filedYears = () => {
      const f = revalueBase(cc())!.forecast![0]!;
      const sales = f.Sales_f / 1.1;
      const profit = f.CNI_f - 0.02 * OPENING_EQUITY;
      return [
        { fiscalYearEnd: anchor(), revenue: sales / 1.05, exciseDuty: null, profitAttributableToOwners: profit - 0.05 * OPENING_EQUITY, equityAttributableToOwners: OPENING_EQUITY },
        { fiscalYearEnd: nextYear(), revenue: sales, exciseDuty: null, profitAttributableToOwners: profit, equityAttributableToOwners: OPENING_EQUITY * 1.1 },
      ];
    };
    const tcsCompany = { folder: "Tata Consultancy Services Ltd", name: "Tata Consultancy Services", ticker: "TCS", sector: "IT", type: "it-services", description: "", emoji: "" } as LibraryCompany;
    const caseHtml = (basis: "consolidated" | "standalone", years: ReturnType<typeof filedYears> | null) => {
      const result = { ...resultFor(cc()), run: { family: "industrial", trustEnvelope: { confidence: { status: "ready", headline: "Ready", tone: "emerald" }, rigor: { currentLabel: "Production ready" } } } } as unknown as LegacyAnalysisRunExecutionResult;
      const ledger = years ? [{ symbol: "TCS", firstFiling: null, rows: [], latestFiling: null, filedYears: years }] : [];
      return text(renderToStaticMarkup(
        <CasePage route={{ ...caseRoute("TCS"), section: "forecast" }} company={tcsCompany} run={{ status: "ready", result, basis }} tieOut={ledger} />,
      ));
    };

    it("sets the base case's first year beside what was filed, with the random walk", () => {
      const f = revalueBase(cc())!.forecast![0]!;
      const [cutoff, filed] = filedYears();
      const html = caseHtml("consolidated", filedYears());
      expect(html).toContain("Against the results filed since");
      // Forecast 10% above filed sales; the anchor year again is 4.8% under them, so closer.
      expect(html).toContain(`${nextYear()} Sales ${crore(f.Sales_f)} ${crore(filed!.revenue)} +10.0% -4.8% Nothing changes`);
      // Earnings 2 points of the opening year's filed equity above; the anchor year again, 5 under.
      expect(html).toContain(`${nextYear()} Earnings ${crore(f.CNI_f)} ${crore(filed!.profitAttributableToOwners)} +2.0 pts -5.0 pts Forecast`);
      expect(html).toContain(`repeats ${cutoff!.fiscalYearEnd}’s filed figures`);
    });

    it("scores the base case, not the reader's edits", () => {
      const edited = revalueBase(cc(), { sales_growth: 0.05 })!.forecast![0]!;
      const f = revalueBase(cc())!.forecast![0]!;
      const html = text(renderToStaticMarkup(<ForecastSection result={resultFor(cc())} filedYears={filedYears()} initialShifts={{ sales_growth: 0.05 }} />));
      expect(html).toContain(`${nextYear()} Sales ${crore(f.Sales_f)} `);
      expect(html).not.toContain(`${nextYear()} Sales ${crore(edited.Sales_f)} `);
    });

    it("scores no year the case's data reached, and says how far the data runs", () => {
      const base = resultFor(cc());
      const walkedBack = { ...base, materialization: { ...base.materialization, pipelineResult: { periods: [{ period_end: nextYear() }] } } } as unknown as LegacyAnalysisRunExecutionResult;
      const html = text(renderToStaticMarkup(<ForecastSection result={walkedBack} filedYears={filedYears()} />));
      expect(html).toContain(`Nothing has been filed yet for a year after this case’s data, which runs to ${nextYear()}.`);
      expect(html).not.toContain(`${nextYear()} Sales`);
    });

    it("does not compare a business the consolidated filings do not describe", () => {
      expect(caseHtml("standalone", filedYears())).toContain("Not compared: a forecast on standalone accounts; the ledger is consolidated.");
      const carved = { ...cc(), lendingArm: { status: "applied", link: { arm: { name: "X Finance", nseSymbol: "XFIN" } } } } as unknown as CC;
      expect(text(renderToStaticMarkup(<ForecastSection result={resultFor(carved)} filedYears={filedYears()} />)))
        .toContain("Not compared: a forecast of the business without X Finance; the consolidated filings describe another business.");
      // No ledger for the company: no panel.
      expect(caseHtml("consolidated", null)).not.toContain("Against the results filed since");
    });
  });

  it("re-values an edit within 150 ms on the largest bundled company", () => {
    const cc = built.ITC!;
    revalueBase(cc, { sales_growth: 0.01 }); // warm
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      revalueBase(cc, { sales_growth: 0.001 * i, core_sales_pm: -0.001 * i });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[5]).toBeLessThan(150);
  });
});

describe("Verdict — what would change our mind", () => {
  it("says a growth or margin break-even moves every forecast year, and sets terminal growth against the riskless rate", () => {
    const cc = built.TCS!;
    const results = solveBreakEvens(cc);
    const at = (driver: string) => results.find((r) => r.driver === driver)!;
    const html = text(renderToStaticMarkup(<VerdictSection result={resultFor(cc)} />));
    const growth = at("sales_growth");
    expect(growth.breakEven).not.toBeNull();
    const shift = growth.breakEven! - growth.base;
    expect(html).toContain(
      `Sales growth ${formatPct(growth.base, 1)} in year 1 ${formatPct(growth.breakEven, 1)} in year 1 (${shift >= 0 ? "+" : "−"}${Math.abs(shift * 100).toFixed(1)} points in every forecast year)`,
    );
    // TCS at ₹3,100: the price needs more terminal growth than the riskless
    // rate ke starts from (7.11% G-Sec less the 1.87% default spread).
    const g = at("g");
    expect(g.breakEven).toBeGreaterThan(0.0711 - 0.0187);
    expect(html).toContain(`Terminal growth ${formatPct(g.base, 1)} ${formatPct(g.breakEven, 1)}, above the 5.24% riskless rate the cost of equity is built on`);
    // A manual ke is built on no riskless rate, so none is claimed.
    const manual = { ...cc, costOfCapital: { ...cc.costOfCapital, equityMode: "manual" } } as unknown as CC;
    expect(text(renderToStaticMarkup(<VerdictSection result={resultFor(manual)} />))).not.toContain("riskless rate");
  });
});

describe("Forecast and Valuation sections — their per-share basis", () => {
  it("say their values are at the valuation date, where the Verdict's beside the price are carried", () => {
    const cc = built.TCS!;
    // TCS at ₹3,100 as of the run's date: values carried there in the Verdict.
    const note = `Per share at the valuation date, ${cc.anchorPeriod.period_end}, on that date's ${cc.marketContext.sharesAtValuationDate!.toFixed(2)} crore shares. Beside the price the Verdict carries values to the price's date, ${cc.marketContext.priceDate}, so its figures differ from these.`
      .replace(/'/g, "&#x27;");
    expect(text(renderToStaticMarkup(<ValuationSection result={resultFor(cc)} />))).toContain(note);
    expect(text(renderToStaticMarkup(<ForecastSection result={resultFor(cc)} />))).toContain(note);
    // Without a price nothing is carried, and nothing is said.
    const unpriced = { ...cc, marketPrice: null } as unknown as CC;
    expect(text(renderToStaticMarkup(<ValuationSection result={resultFor(unpriced)} />))).not.toContain("Per share at the valuation date");
  });
});

describe("Valuation section", () => {
  it("shows every catalogued model's result: computed values and withheld reasons", () => {
    const cc = built.TCS!;
    const models = adaptLegacyCommandCenterModelResults(cc);
    const html = text(renderToStaticMarkup(<ValuationSection result={resultFor(cc)} />));
    const computed = models.filter((m) => m.status === "computed");
    expect(html).toContain(`${computed.length} of ${models.length} catalogued models computed a value`);
    for (const m of computed) if (m.perShare != null) expect(html).toContain(formatPerShare(m.perShare));
    for (const m of models) if (m.status !== "computed") expect(html).toContain(`${m.status}: ${m.reasonCode}`);
  });

  it("centres the sensitivity grid on the base card's value", () => {
    const cc = built.TCS!;
    expect(SENSITIVITY_KE[2]).toBe(0);
    expect(SENSITIVITY_G[2]).toBe(0);
    const html = renderToStaticMarkup(<ValuationSection result={resultFor(cc)} />);
    const base = formatPerShare(cc.scenarios.find((s) => s.key === "base")!.intrinsicPerShare);
    expect(html).toContain(`font-semibold">${base}</td>`);
  });

  it("shows kw as derived and the cost-of-capital provenance", () => {
    const html = text(renderToStaticMarkup(<ValuationSection result={resultFor(built.TCS!)} />));
    expect(html).toContain("kw is derived from the capital structure and is not an input");
    expect(html).toContain(percent(built.TCS!.costOfCapital.ke)!);
  });

  // The pinned ERP carries a country premium, so ke nets the sovereign default
  // spread from the risk-free rate; listed without it, the card's inputs did
  // not add up to its ke.
  it("lists the sovereign default spread, so the card's inputs add up to its ke", () => {
    const c = built.TCS!.costOfCapital;
    expect(c.sovereignDefaultSpread).toBeCloseTo(0.0187, 10);
    expect(c.riskFreeRate - c.sovereignDefaultSpread! + c.beta! * c.equityRiskPremium!).toBeCloseTo(c.ke, 10);
    const html = text(renderToStaticMarkup(<ValuationSection result={resultFor(built.TCS!)} />));
    expect(html).toContain(`Less sovereign default spread ${percent(c.sovereignDefaultSpread)}`);
    expect(html).toContain("ke = risk-free rate − sovereign default spread + beta × equity risk premium");
  });
});
