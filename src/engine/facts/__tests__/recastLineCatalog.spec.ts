/**
 * The recast line catalog lists every label the pipeline reads by name.
 *
 * The recast's modules, the scope check and the greenfield step name lines as
 * string elements of array literals (the key lists passed to valBS, valPL,
 * firstValid, the scope signal groups, the greenfield fallbacks). This test
 * walks their syntax trees and fails when one names a label the catalog does
 * not hold, so a new inline list cannot drop out of the fact set. Trace line
 * ids ("BS.TA"), messages and the scope's own kinds ("bank") share the shape;
 * they are not Capitaline labels and are recognized as such below.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CapitalineMappingSpec } from "../../mappingSpec";
import { RECAST_INLINE_LINES, isRecastLine, normalizeRecastLabel } from "../recastLineCatalog";

const ENGINE_DIR = join(__dirname, "..", "..");
const RECAST_DIR = join(ENGINE_DIR, "PenmanNissimEngine");
/** The pipeline's other readers of lines by name, outside the recast's modules. */
const OTHER_READERS = [join(ENGINE_DIR, "scopePolicy.ts"), join(ENGINE_DIR, "greenfieldPipeline", "l1Normalize.ts")];

/**
 * A trace line id ("BS.FA.CashBank", "IS.FinanceCost.Top"), a message, or one
 * of the scope check's kinds, not a filed label. The library's 3,024 base
 * labels are at most 101 characters and none contains an em dash; the recast's
 * and the scope check's messages are longer or use one.
 */
function isNotALabel(text: string): boolean {
  return /^(?:BS|IS|CF)\.[A-Za-z.]+$/.test(text) || text.includes(" — ") || text.length > 120 || /^[a-z]+$/.test(text);
}

function arrayElementStrings(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const files = [
    ...readdirSync(RECAST_DIR).filter((entry) => entry.endsWith(".ts")).map((entry) => join(RECAST_DIR, entry)),
    ...OTHER_READERS,
  ];
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const name = path.slice(ENGINE_DIR.length + 1).replace(/\\/g, "/");
    const visit = (node: ts.Node): void => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ts.isArrayLiteralExpression(node.parent)) {
        const where = `${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        found.set(node.text, [...(found.get(node.text) ?? []), where]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe("recast line catalog", () => {
  it("holds every label the pipeline's readers name in a key list", () => {
    const missing = [...arrayElementStrings()]
      .filter(([text]) => !isNotALabel(text) && !isRecastLine(text))
      .map(([text, where]) => `${JSON.stringify(text)} (${where.join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("lists in place only what the mapping spec does not already hold", () => {
    const spec = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "string") spec.add(normalizeRecastLabel(value));
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(CapitalineMappingSpec);
    expect(RECAST_INLINE_LINES.filter((label) => spec.has(normalizeRecastLabel(label)))).toEqual([]);
  });

  it("matches labels as the picker does, and a named label's current-block twins", () => {
    expect(isRecastLine("Total Assets")).toBe(true);
    expect(isRecastLine("TOTAL  assets")).toBe(true);
    expect(isRecastLine("Proceed from 0ther Long Term Borrowings")).toBe(true);
    expect(isRecastLine("Lease Liabilities - Current")).toBe(true);
    expect(isRecastLine("Trade Receivables - Current Assets")).toBe(true);
    expect(isRecastLine("Unrecognised Line Of The Export")).toBe(false);
    expect(isRecastLine("Unrecognised Line Of The Export - Current")).toBe(false);
  });
});
