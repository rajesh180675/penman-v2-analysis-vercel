/**
 * @vitest-environment node
 *
 * A Capitaline fact set holds a fact for every value the recast can read, on
 * a real export (TCS), with each line's unit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCapitalineZip } from "../../capitalineParser";
import type { RawPeriodData } from "../../types";
import {
  RECAST_LINE_CONCEPT_PREFIX,
  adaptLegacyRawPeriodsToFactSet,
  buildCapitalineCanonicalFactBundle,
  type FactSet,
} from "../index";
import { isRecastLine } from "../recastLineCatalog";

const FOLDER = "Tata Consultancy Services Ltd";
let rawData: RawPeriodData[];
let factSet: FactSet;

beforeAll(async () => {
  const buf = readFileSync(join(process.cwd(), "public", "data", "companies", FOLDER, `${FOLDER}.zip`));
  const parsed = await parseCapitalineZip(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { companyId: "TCS" });
  rawData = [...parsed.periods].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const bundle = buildCapitalineCanonicalFactBundle({ rawData, debug: parsed.debug, scope: "consolidated", contentClass: "spec" })!;
  const adapted = await adaptLegacyRawPeriodsToFactSet({ rawData, ...bundle });
  if (adapted.status !== "created") throw new Error(adapted.diagnostics.map((d) => d.message).join("; "));
  factSet = adapted.factSet!;
}, 120_000);

const lineFacts = () => factSet.facts.filter((fact) => fact.conceptId.startsWith(RECAST_LINE_CONCEPT_PREFIX));

describe("recast-line facts", () => {
  it("records each finite value of a line the recast reads, once, at its value", () => {
    const expected = new Map<string, number>();
    for (const period of rawData) {
      for (const [rawLabel, value] of Object.entries(period.raw_metric_values)) {
        const separator = rawLabel.lastIndexOf("__");
        if (separator < 0 || value == null || !Number.isFinite(value)) continue;
        if (!["BalanceSheet", "ProfitLoss", "CashFlow"].includes(rawLabel.slice(separator + 2))) continue;
        if (isRecastLine(rawLabel.slice(0, separator))) expected.set(`${period.period_end}\u0000${rawLabel}`, value);
      }
    }
    const recorded = new Map<string, number>();
    for (const fact of lineFacts()) {
      const key = `${fact.period.end}\u0000${fact.rawLabel}`;
      expect(recorded.has(key), key).toBe(false);
      if (fact.value.kind === "numeric") recorded.set(key, Number(fact.value.decimal));
    }
    expect(expected.size).toBeGreaterThan(5_000);
    expect(recorded).toEqual(expected);
  });

  it("keeps the ontology's facts beside them, on the same lines", () => {
    const revenue = factSet.facts.filter((fact) => fact.conceptId === "revenue");
    expect(revenue.length).toBeGreaterThan(0);
    for (const fact of revenue) {
      const twin = lineFacts().find((line) => line.rawLabel === fact.rawLabel && line.period.end === fact.period.end);
      expect(twin, `${fact.period.end} ${fact.rawLabel}`).toBeDefined();
      expect(twin!.value).toEqual(fact.value);
    }
  });

  it("records share counts, face values and the dividend percentage in their own units", () => {
    const unitOf = (label: string) => new Set(lineFacts().filter((fact) => fact.rawLabel === label).map((fact) => fact.value.kind === "numeric" ? fact.value.normalizedUnit : null));
    expect(unitOf("Total Assets__BalanceSheet")).toEqual(new Set(["INR_CRORE"]));
    expect(unitOf("Weighted Average Number of Shares in Issue - Basic__ProfitLoss")).toEqual(new Set(["CRORE_SHARES"]));
    expect(unitOf("Face Value of Subscribed Shares Fully Paid up__BalanceSheet")).toEqual(new Set(["INR_PER_SHARE"]));
    expect(unitOf("Total Dividend Percentage__ProfitLoss")).toEqual(new Set(["RATIO"]));
  });

  it("dates a balance-sheet line at the period end and a flow over the year", () => {
    const assets = lineFacts().find((fact) => fact.rawLabel === "Total Assets__BalanceSheet")!;
    expect(assets.period).toMatchObject({ kind: "instant", start: null });
    const sales = lineFacts().find((fact) => fact.rawLabel === "Revenue From Operations__ProfitLoss")!;
    expect(sales.period.kind).toBe("duration");
    expect(sales.period.start).not.toBeNull();
  });
});
