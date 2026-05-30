import { describe, expect, it } from "vitest";
import {
  tokenJaccard,
  tokenDice,
  pearsonCorrelation,
  clusterUnknownLabels,
  findCorrelationMatches,
  UnmappedLabel,
} from "../mappingClusterEngine";

describe("Token similarity functions", () => {
  it("exact match returns high similarity", () => {
    expect(tokenDice("Cash and Cash Equivalents", "Cash and Cash Equivalents")).toBeCloseTo(1, 4);
  });

  it("similar labels return moderate similarity", () => {
    expect(tokenDice("Trade Receivables Less Than 3 Months", "Trade Receivables")).toBeGreaterThan(0.4);
  });

  it("unrelated labels return zero similarity", () => {
    expect(tokenDice("Goodwill", "Employee Benefit Obligation")).toBe(0);
  });

  it("Jaccard similarity is consistent", () => {
    const jack = tokenJaccard("Cash and Bank", "Cash and Equivalents");
    const dice = tokenDice("Cash and Bank", "Cash and Equivalents");
    expect(jack).toBeGreaterThanOrEqual(0);
    expect(jack).toBeLessThanOrEqual(1);
    expect(jack).toBeLessThan(dice); // Jaccard is always <= Dice
  });

  it("handles trailing colons and case differences", () => {
    const sim = tokenDice("Other Comprehensive Income That Will Be Reclassified to Profit or Loss :", "other comprehensive income that will be reclassified to profit or loss");
    expect(sim).toBeCloseTo(1, 2); // Noise words removed by tokenizer, so not exactly 1
  });
});

describe("Pearson correlation", () => {
  it("returns 1 for perfect correlation", () => {
    const x = [10, 20, 30, 40, 50];
    const y = [20, 40, 60, 80, 100];
    const r = pearsonCorrelation(x, y);
    expect(r).toBeCloseTo(1, 4);
  });

  it("returns -1 for perfect negative correlation", () => {
    const x = [10, 20, 30, 40, 50];
    const y = [50, 40, 30, 20, 10];
    const r = pearsonCorrelation(x, y);
    expect(r).toBeCloseTo(-1, 4);
  });

  it("returns ~0 for uncorrelated data", () => {
    const x = [10, 20, 30, 40, 50];
    const y = [5, 100, 15, 80, 25];
    const r = Math.abs(pearsonCorrelation(x, y));
    expect(r).toBeLessThan(0.5);
  });
});

describe("Cluster unknown labels", () => {
  // Uses CapitalineMappingSpec imported via clustering engine

  it("clusters similar labels to known spec keys", () => {
    const unknown: UnmappedLabel[] = [
      { key: "Total Cash and Cash Equivalents", statement: "BalanceSheet", values: [100, 110, 120] },
      { key: "Trade Receivables Less Than 1 Year", statement: "BalanceSheet", values: [50, 55, 60] },
    ];

    const result = clusterUnknownLabels(unknown);
    expect(result.clusters.length).toBeGreaterThan(0);
    expect(result.stats.clusteredCount).toBeGreaterThan(0);
  });

  it("leaves unrelated labels unclustered", () => {
    const unknown: UnmappedLabel[] = [
      { key: "XyZ123 CompletelyUnique Label", statement: "BalanceSheet", values: [1, 2, 3] },
      { key: "BlahBlah NoMatch Here", statement: "BalanceSheet", values: [10, 20, 30] },
    ];

    const result = clusterUnknownLabels(unknown, { simThreshold: 0.7 });
    expect(result.unclustered.length).toBeGreaterThan(0);
  });

  it("returns alias recommendation for high similarity", () => {
    const unknown: UnmappedLabel[] = [
      { key: "Total Cash and Cash Equivalents", statement: "BalanceSheet", values: [100, 110, 120] },
    ];

    const result = clusterUnknownLabels(unknown);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.recommendation).toBeOneOf(["add-alias", "add-sub-key", "review-manual"]);
  });

  it("limits results to maxSuggestions", () => {
    const unknown: UnmappedLabel[] = Array.from({ length: 30 }, (_, i) => ({
      key: `Some Label ${i}`,
      statement: "BalanceSheet" as const,
      values: [1, 2, 3],
    }));

    const result = clusterUnknownLabels(unknown, { maxSuggestions: 5 });
    expect(result.clusters.length).toBeLessThanOrEqual(5);
  });
});

describe("Correlation-based matching", () => {
  const knownLabels = new Map<string, number[]>([
    ["balanceSheet.cashAndBank", [100, 120, 140, 160, 180]],
    ["balanceSheet.tradeReceivables", [50, 60, 70, 80, 95]],
  ]);

  it("finds strong correlation with known label", () => {
    const unknown: UnmappedLabel[] = [
      { key: "Cash Balances", statement: "BalanceSheet", values: [200, 240, 280, 320, 360] }, // perfectly correlated 2x
    ];

    const matches = findCorrelationMatches(unknown, knownLabels, 0.99);
    expect(matches.filter((m) => m.recommendation === "strong-candidate").length).toBeGreaterThan(0);
  });

  it("does not match low-correlation labels", () => {
    const unknown: UnmappedLabel[] = [
      { key: "Some Random Metric", statement: "BalanceSheet", values: [1, 5, 2, 10, 3] },
    ];

    const matches = findCorrelationMatches(unknown, knownLabels, 0.95);
    expect(matches).toHaveLength(0);
  });
});
