/**
 * Census of every production `computeValuation` call, by what it passes as
 * the periods argument.
 *
 * `computeValuation` treats periods[0] as the valuation date. Six call sites
 * used to pass raw HISTORY — dating value at the oldest balance sheet while
 * margin of safety compared it with today's price — and nothing failed:
 * `buildAnchoredValuationPeriods` has its own tests, but a helper's tests
 * cannot pin that callers use it. Mutation testing confirmed it: reverting
 * the Valuation, V3 or Academic call to raw history left the suite green.
 *
 * This pins each call site's first argument. A new call, or a changed
 * argument, fails here until someone confirms the periods it passes start at
 * the latest balance sheet (buildAnchoredValuationPeriods /
 * buildValuationPeriodsFromForecast) and updates the census. The AST is
 * walked call by call — a text grep would miss aliased or multi-line calls.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "../../..");

/** Reviewed: every argument below is a latest-anchored or forecast period list. */
const EXPECTED_CENSUS = [
  "src/components/AcademicReport.tsx :: anchoredPeriods",
  "src/components/AcademicReport.tsx :: anchoredPeriods",
  "src/components/AcademicReport.tsx :: anchoredPeriods",
  "src/components/ForecastReport.tsx :: valuationPeriods",
  "src/components/ForecastReport.tsx :: valuationPeriods",
  "src/components/V3AnalyticsPanel.tsx :: anchoredPeriods",
  "src/components/ValuationReport.tsx :: anchoredValuationPeriods",
  "src/components/comparison/peerValuation.ts :: anchoredPeriods",
  "src/engine/baselineGuardrails.ts :: anchoredPeriods(periods, cfg)",
  "src/engine/baselineGuardrails.ts :: anchoredPeriods(periods, cfg)",
  "src/engine/baselineGuardrails.ts :: forecast",
  "src/engine/baselineGuardrails.ts :: forecast",
  // Receives ForecastReport's buildValuationPeriodsFromForecast output.
  "src/engine/monteCarloWorker.ts :: basePeriods",
  "src/engine/pvre/pvreEngine.ts :: valuationPeriods",
  "src/engine/regressionHarness.ts :: afterForecast",
  "src/engine/regressionHarness.ts :: afterForecast",
  "src/engine/regressionHarness.ts :: beforeForecast",
  "src/engine/valuationCommandCenter/builders.ts :: valuationPeriods",
];

function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") productionSources(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(spec|test)\./.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function callSitesInSource(file: string, text: string): string[] {
  if (!text.includes("computeValuation")) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "computeValuation") {
      found.push(`${file} :: ${node.arguments[0]?.getText(sf) ?? "<none>"}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("computeValuation call-site census", () => {
  it("matches the reviewed census — every call passes latest-anchored periods", () => {
    const actual = productionSources(join(ROOT, "src"))
      .flatMap((path) => callSitesInSource(relative(ROOT, path).split(sep).join("/"), readFileSync(path, "utf8")))
      .sort();
    expect(
      actual,
      "A computeValuation call site changed. Confirm its periods start at the LATEST balance sheet " +
      "(buildAnchoredValuationPeriods or buildValuationPeriodsFromForecast), then update EXPECTED_CENSUS.",
    ).toEqual([...EXPECTED_CENSUS].sort());
  });

  it("sees a raw-history call inside JSX-bearing components and multi-line calls", () => {
    const snippet = `
      const val = useMemo(() =>
        computeValuation(
          valuationData,
          ke, kw, g, config,
        ), [valuationData]);
      export const X = () => <div>{computeValuation(data, 0.1, 0.1, 0.03, cfg).V_RE_CV3}</div>;
    `;
    expect(callSitesInSource("Snippet.tsx", snippet)).toEqual([
      "Snippet.tsx :: valuationData",
      "Snippet.tsx :: data",
    ]);
  });
});
