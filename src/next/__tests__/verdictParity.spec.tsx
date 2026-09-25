/**
 * Phase 1 exit criterion (docs/ui-revamp-plan.md): the Verdict shows the
 * current Valuation hero's numbers. Both render from ONE real command center
 * built from a bundled company, and the figures they share must be the same
 * strings — not merely close.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCapitalineZip } from "../../engine/capitalineParser";
import { processCompanyDataFull } from "../../engine/pipeline";
import { ACTIVE_MARKET_PACKS } from "../../engine/marketPacks";
import { buildValuationCommandCenter, formatPct } from "../../engine/valuationCommandCenter";
import { solveBreakEvens } from "../../engine/valuationCommandCenter/breakEven";
import { DEFAULT_CONFIG, type CompanyType } from "../../engine/types";
import { INRAbsolute } from "../../engine/types/units";
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import ValuationCommandCenterHero from "../../components/valuation/ValuationCommandCenterHero";
import { VerdictSection } from "../sections/VerdictSection";

const COMPANIES = join(process.cwd(), "public", "data", "companies");

async function commandCenterFor(folder: string, type: CompanyType, price: number) {
  const buf = readFileSync(join(COMPANIES, folder, `${folder}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: folder });
  const config = { ...DEFAULT_CONFIG, company_type: type, market_price: INRAbsolute(price) };
  const periods = processCompanyDataFull(parsed.periods, config).periods;
  return { config, cc: buildValuationCommandCenter({ data: periods, config, ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-09-26" }) };
}

/** The value rendered after a label (a figure, "—", or "Withheld"), markup stripped. */
function figure(html: string, label: string): string | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const escaped = label.replace(/[()]/g, (c) => `\\${c}`);
  const match = new RegExp(String.raw`${escaped} (₹-?[\d.]+|-?[\d.]+%|—|Withheld)`).exec(text);
  return match?.[1] ?? null;
}

describe("Verdict ↔ Valuation hero parity", () => {
  for (const [folder, type, price] of [
    ["Tata Consultancy Services Ltd", "it-services", 3100],
    ["Mahindra & Mahindra", "cyclical", 3200],
  ] as const) {
    it(`shows the hero's figures for ${folder}`, async () => {
      const { config, cc } = await commandCenterFor(folder, type, price);
      const hero = renderToStaticMarkup(
        <ValuationCommandCenterHero
          marketSymbol={null}
          commandCenter={cc}
          liveMarketData={null}
          marketDataLoading={false}
          marketDataError={null}
          onRefresh={async () => {}}
          config={config}
        />,
      );
      const result = { status: "completed", run: { family: "industrial" }, materialization: { commandCenter: cc } } as unknown as LegacyAnalysisRunExecutionResult;
      const verdict = renderToStaticMarkup(<VerdictSection result={result} />);

      for (const label of ["Current price", "Stress value", "Base value", "Expected CAGR (stress)"]) {
        const fromHero = figure(hero, label);
        expect(fromHero, `hero shows ${label}`).not.toBeNull();
        // A number must be the same string; the hero's bare "—" must be an
        // explicit Withheld (with its reason) in the Verdict, never a number.
        expect(figure(verdict, label), label).toBe(fromHero === "—" ? "Withheld" : fromHero);
      }

      // What would change our mind: every solved break-even is shown as solved.
      expect(verdict).toContain("What would change our mind");
      for (const r of solveBreakEvens(cc)) {
        if (r.breakEven != null) expect(verdict).toContain(formatPct(r.breakEven, 1));
      }
    }, 120_000);
  }
});
