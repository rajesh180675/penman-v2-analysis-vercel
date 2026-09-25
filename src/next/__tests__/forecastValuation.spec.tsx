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
import { buildValuationCommandCenter, formatPerShare } from "../../engine/valuationCommandCenter";
import { revalueBase } from "../../engine/valuationCommandCenter/breakEven";
import { DEFAULT_CONFIG, type CompanyType } from "../../engine/types";
import { INRAbsolute } from "../../engine/types/units";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import { crore, percent } from "../format";
import { ForecastSection } from "../sections/ForecastSection";
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
});
