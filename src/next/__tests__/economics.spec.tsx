/**
 * Phase 2 exit criteria (docs/ui-revamp-plan.md):
 *  - every number the Economics section shares with today's Statements tab is
 *    the same string, for the same years;
 *  - the lineage drawer resolves every number the section displays.
 * On real bundled data: TCS (no material minority) and M&M (minority interest,
 * so MII is live).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCapitalineZip } from "../../engine/capitalineParser";
import { processCompanyDataFull } from "../../engine/pipeline";
import { DEFAULT_CONFIG, type CompanyType, type RecastPeriod } from "../../engine/types";
import RecastStatements from "../../components/RecastStatements";
import { ECONOMICS_YEARS, EconomicsSection } from "../sections/EconomicsSection";
import { BALANCE_LINES, INCOME_LINES, RATIOS, resolveLineage } from "../lineage";

const companies: Record<string, RecastPeriod[]> = {};

beforeAll(async () => {
  for (const [folder, type] of [["Tata Consultancy Services Ltd", "it-services"], ["Mahindra & Mahindra", "cyclical"]] as const) {
    const buf = readFileSync(join(process.cwd(), "public", "data", "companies", folder, `${folder}.zip`));
    const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: folder });
    companies[folder] = processCompanyDataFull(parsed.periods, { ...DEFAULT_CONFIG, company_type: type as CompanyType }).periods;
  }
}, 180_000);

const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();

/** The cells of the table row whose first cell is exactly `label`. */
function rowCells(html: string, label: string): string[] | null {
  for (const row of html.split("<tr").slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1]!));
    if (cells[0] === label) return cells.slice(1);
  }
  return null;
}

/** Statements-tab label → Economics label, for every line both show. */
const SHARED_ROWS: [string, string][] = [
  ["Sales (Revenue)", "Sales"],
  ["Core OI (persistent)", "Core OI"],
  ["Unusual OI (UOI)", "Unusual OI"],
  ["Operating Income OI", "Operating income (OI)"],
  ["Net Fin. Expense NFE", "Net financial expense (NFE)"],
  ["NCI Income Share (MII)", "Minority interest in income (MII)"],
  ["CNI (to common)", "Comprehensive income to common (CNI)"],
  ["Operating Assets (OA=TA−FA)", "Operating assets (OA)"],
  ["Operating Liabilities (OL)", "Operating liabilities (OL)"],
  ["Net Operating Assets (NOA)", "Net operating assets (NOA)"],
  ["Financial Assets (FA)", "Financial assets (FA)"],
  ["Financial Obligations (FO)", "Financial obligations (FO)"],
  ["Net Financial Obl. (NFO)", "Net financial obligations (NFO)"],
  ["Minority Interest (MI)", "Minority interest (MI)"],
  ["Common Equity (CSE)", "Common equity (CSE)"],
];

describe.each(["Tata Consultancy Services Ltd", "Mahindra & Mahindra"])("Economics section — %s", (folder) => {
  it("shows the Statements tab's figures, string for string, for the years it shows", () => {
    const periods = companies[folder]!;
    const statements = renderToStaticMarkup(<RecastStatements data={periods} />);
    const economics = renderToStaticMarkup(<EconomicsSection periods={periods} />);
    const shown = Math.min(ECONOMICS_YEARS, periods.length);
    for (const [statementsLabel, economicsLabel] of SHARED_ROWS) {
      const theirs = rowCells(statements, statementsLabel);
      const ours = rowCells(economics, economicsLabel);
      expect(theirs, statementsLabel).not.toBeNull();
      expect(ours, economicsLabel).not.toBeNull();
      // Statements shows every year; Economics the latest `shown`. Missing is
      // "—" there and "n/a" here.
      expect(ours!.map((c) => (c === "n/a" ? "—" : c)), economicsLabel).toEqual(theirs!.slice(-shown));
    }
  });

  it("resolves every displayed number in the lineage drawer", () => {
    const periods = companies[folder]!;
    const first = Math.max(0, periods.length - ECONOMICS_YEARS);
    let resolved = 0;
    for (let period = first; period < periods.length; period++) {
      for (const line of [...INCOME_LINES, ...BALANCE_LINES]) {
        if (line.value(periods[period]!) == null) continue;
        const lineage = resolveLineage(periods, { kind: "line", id: line.id, period });
        expect(lineage, `${line.id} ${period}`).not.toBeNull();
        // Evidence, not just a title: source rows, or components to drill into.
        expect(lineage!.sources.length + lineage!.components.length, `${line.id} ${periods[period]!.period_end}`).toBeGreaterThan(0);
        resolved++;
      }
      for (const ratio of RATIOS) {
        if (ratio.value(periods[period]!) == null) continue;
        const lineage = resolveLineage(periods, { kind: "ratio", id: ratio.id, period });
        expect(lineage!.formula).toBeTruthy();
        expect(lineage!.components.length).toBeGreaterThan(0);
        resolved++;
      }
    }
    expect(resolved).toBeGreaterThan(100);
  });

  it("drills into components that actually add up", () => {
    const periods = companies[folder]!;
    const last = periods.length - 1;
    const get = (id: string) => resolveLineage(periods, { kind: "line", id, period: last })!;
    const noa = get("noa");
    expect(noa.components.map((c) => c.target.id)).toEqual(["oa", "ol"]);
    expect(noa.components[0]!.value! - noa.components[1]!.value!).toBeCloseTo(noa.value!, 6);
    const oi = get("oi");
    expect(oi.components.reduce((sum, c) => sum + c.value!, 0)).toBeCloseTo(oi.value!, 6);
  });
});
