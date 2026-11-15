/**
 * The ontology's concept mappings pick each concept's raw line by its
 * statement-tagged key, then by its bare label. The parser keeps every placed
 * line under its bare label too, so where a balance sheet filed no
 * inventories, the bare "Inventories" was the cash flow's working-capital
 * change and became the inventory concept's fact (18 company-years in the
 * library, the years #555 found in the recast). A bare label now maps only
 * where no other statement files it.
 */
import { describe, expect, it } from "vitest";
import { buildOntologyConceptMappings } from "../facts/sourceAdapters";
import type { RawPeriodData } from "../types";

const period = (lines: Record<string, number>): RawPeriodData => ({ company_id: "X", period_end: "2012-03-31", raw_metric_values: lines });
const inventory = (lines: Record<string, number>) =>
  buildOntologyConceptMappings([period(lines)]).find((m) => m.conceptId === "inventory") ?? null;

describe("an ontology concept maps its own statement's line", () => {
  it("does not map the cash flow's inventories change to the balance-sheet concept (DMart FY2012)", () => {
    expect(inventory({ "Inventories__CashFlow": -72.81, Inventories: -72.81 })).toBeNull();
  });

  it("maps the balance sheet's own line", () => {
    expect(inventory({ "Inventories__BalanceSheet": 671.69, Inventories: 671.69, "Inventories__CashFlow": -276.21 })?.rawLabel)
      .toBe("Inventories__BalanceSheet");
  });

  it("maps a bare label no statement files", () => {
    expect(inventory({ Inventories: 500 })?.rawLabel).toBe("Inventories");
  });
});
