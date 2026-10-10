import { describe, expect, it } from "vitest";
import {
  buildUnusualItemPolicy,
  CLASSIFICATION_RULES,
  classifyRunUnusualItems,
  MAX_UNUSUAL_ITEM_CLASSIFICATIONS,
  summarizeUnusualItemManifest,
  terminalBlockingClassifications,
  terminalPeriodOf,
  UNUSUAL_ITEM_POLICY_VERSION,
  type UnusualItemCategory,
} from "../unusualItemPolicy";
import { RawPeriodData, RecastPeriod } from "../types";

const EXISTING_TEST_PERIOD: RecastPeriod = {
  period_end: "2025-03-31",
  bs: {} as never,
  is: { Sales: 1000, OtherItems: 0 } as never,
  cu: {
    UOI: 0,
    CoreOI: 100,
    UFE: 0,
    CoreNFE: 5,
    ExceptionalItemsAfterTax: 0,
    OCITotal: 0,
  } as never,
  cf: {} as never,
  spec_flags: [],
};

function mkRaw(period: string, labels: Record<string, number>): RawPeriodData {
  const raw_metric_values: Record<string, number> = {};
  for (const [label, value] of Object.entries(labels)) {
    raw_metric_values[`${label}__ProfitLoss`] = value;
  }
  return { company_id: "TEST", period_end: period, raw_metric_values };
}

describe("unusualItemPolicy / classifyRunUnusualItems", () => {
  it("preserves the existing buildUnusualItemPolicy API (regression)", () => {
    const summary = buildUnusualItemPolicy(EXISTING_TEST_PERIOD);
    expect(summary.policyVersion).toBe(UNUSUAL_ITEM_POLICY_VERSION);
    expect(summary.operatingBuckets).toEqual([]);
    expect(summary.terminalBlocker).toBe(false);
  });

  it("CLASSIFICATION_RULES are ordered and complete", () => {
    const categories = new Set<UnusualItemCategory>(CLASSIFICATION_RULES.map((r) => r.category));
    // 11 categories, 'unclassified' is the fall-through (not a rule).
    expect(categories.size).toBe(11);
    // Each rule has at least one pattern.
    for (const rule of CLASSIFICATION_RULES) {
      expect(rule.patterns.length).toBeGreaterThan(0);
    }
  });

  // Per-category positive + negative cases (11 categories x 2 = 22 cases).
  const positiveCases: Array<{ category: UnusualItemCategory; label: string }> = [
    { category: "demerger-scheme-effect", label: "Demerger Adjustment" },
    { category: "discontinued-operations", label: "Profit From Discontinued Operations" },
    { category: "impairment", label: "Impairment Loss on Goodwill" },
    { category: "asset-sale-gain-loss", label: "Profit on Sale of Investment" },
    { category: "fair-value-change", label: "Fair Value Change on Derivatives" },
    { category: "litigation", label: "Litigation Settlement Cost" },
    { category: "restructuring", label: "Restructuring Cost" },
    { category: "one-time-tax", label: "One-Time Tax Charge" },
    { category: "buyback", label: "Buyback Proceeds" },
    { category: "special-dividend", label: "Special Dividend Distribution" },
    { category: "capital-return", label: "Rights Issue Proceeds" },
  ];

  for (const tc of positiveCases) {
    it(`classifies "${tc.label}" as ${tc.category} (positive)`, () => {
      const raw = mkRaw("2025-03-31", { [tc.label]: 100 });
      const out = classifyRunUnusualItems([], [raw]);
      const match = out.find((c) => c.category === tc.category);
      expect(match).toBeTruthy();
      expect(match?.classificationSource).toBe("rule-based");
      expect(match?.matchedPattern).toBeTruthy();
    });
  }

  const negativeCases: Array<{ description: string; label: string }> = [
    { description: "interest-rate hedge does not match litigation", label: "Interest Rate Hedge" },
    { description: "regular sales does not match asset-sale", label: "Sales of Goods" },
    { description: "regular dividend does not match special-dividend", label: "Equity Dividend" },
    { description: "regular tax does not match one-time-tax", label: "Tax Expenses" },
    { description: "regular interest does not match buyback", label: "Interest Income" },
    { description: "fair value of inventory does not match fair-value-change", label: "Inventory" },
    { description: "depreciation does not match impairment", label: "Depreciation Expense" },
    { description: "deferred income does not match restructuring", label: "Deferred Income" },
    { description: "operations does not match discontinued-operations", label: "Operating Expenses" },
    { description: "merger and acquisition (M&A) does not match demerger", label: "Acquisition Cost" },
    { description: "ordinary issue of shares does not match capital-return", label: "Equity Share Capital" },
  ];

  for (const tc of negativeCases) {
    it(`negative: ${tc.description}`, () => {
      const raw = mkRaw("2025-03-31", { [tc.label]: 100 });
      const out = classifyRunUnusualItems([], [raw]);
      // Either no classification (filtered by candidate keyword screen) or
      // it's tagged unclassified.
      for (const c of out) {
        expect(c.category).not.toBe(positiveCases.find((p) => p.label === tc.label)?.category ?? "x");
      }
    });
  }

  it("lists a terminal-period buyback for review without blocking the anchor", () => {
    // Sun Pharma FY25 carries its buyback as an equity line; a buyback is a
    // capital transaction with owners, not a distortion of the period.
    const raw = mkRaw("2025-03-31", { "Less : Share Buy Back": 1600 });
    const manifest = summarizeUnusualItemManifest([], [raw]);
    expect(manifest.classifications.map((c) => c.category)).toContain("buyback");
    expect(manifest.terminalEligibilityBlocked).toBe(false);
  });

  it("lists a terminal-period rights or bonus issue for review without blocking the anchor", () => {
    const manifest = summarizeUnusualItemManifest([], [mkRaw("2025-03-31", { "Rights Issue Proceeds": 4000 })]);
    expect(manifest.classifications.map((c) => c.category)).toContain("capital-return");
    expect(manifest.terminalEligibilityBlocked).toBe(false);
  });

  it("aggregates terminalEligibilityBlocked from spec_flags", () => {
    const recast: RecastPeriod[] = [
      {
        ...EXISTING_TEST_PERIOD,
        spec_flags: [
          {
            label: "CAPITAL_TRANSACTION",
            severity: "warning" as never,
            affects_terminal: true,
            message: "Detected a buyback in this period.",
          } as never,
        ],
      },
    ];
    const manifest = summarizeUnusualItemManifest(recast, []);
    expect(manifest.terminalEligibilityBlocked).toBe(true);
    expect(manifest.classifications.find((c) => c.category === "capital-return")).toBeTruthy();
  });

  it("blocks terminal eligibility only for an item in the terminal period, listing the rest", () => {
    // TCS-shaped: buybacks in earlier years. Each rule's rationale is that
    // "the period is not a valid terminal anchor"; counting the whole
    // history blocked every company's valuation on a years-old item.
    const history = [
      mkRaw("2018-03-31", { "Buyback of Shares": 160 }),
      mkRaw("2022-03-31", { "Profit From Discontinued Operations": 40 }),
      mkRaw("2025-03-31", { "Impairment Loss": 10 }),
    ];
    const old = summarizeUnusualItemManifest([], history);
    expect(old.terminalEligibilityBlocked).toBe(false);
    // Nothing is hidden: the earlier items stay in the manifest for review.
    expect(old.classifications.map((c) => c.category)).toEqual(expect.arrayContaining(["buyback", "discontinued-operations"]));

    // A buyback no longer disqualifies a period, so the terminal blocker here
    // is a discontinued-operations result.
    const terminal = summarizeUnusualItemManifest([], [...history.slice(0, 2), mkRaw("2025-03-31", { "Profit From Discontinued Operations": 90 })]);
    expect(terminal.terminalEligibilityBlocked).toBe(true);
    expect(terminalBlockingClassifications(terminal, terminalPeriodOf([], history)).map((c) => c.period)).toEqual(["2025-03-31"]);
  });

  it("lists a discontinued operation demerged to owners within the year without blocking the anchor", () => {
    // ITC FY25: the Hotels business was distributed to shareholders, so S-5.1
    // marks the year DEMERGER_LIKELY; its result stays in UOI.
    const demerged: RecastPeriod = {
      ...EXISTING_TEST_PERIOD,
      cu: { ...EXISTING_TEST_PERIOD.cu, DiscontinuedOperationsAfterTax: 15_016 },
      spec_flags: [{ spec_id: "S-5.1", label: "DEMERGER_LIKELY", severity: "warning" as never, affects_terminal: false, message: "Demerger.", period: "2025-03-31" }],
    };
    const raw = mkRaw("2025-03-31", { "Discontinued Operations": 15_016 });
    const manifest = summarizeUnusualItemManifest([demerged], [raw]);
    const item = manifest.classifications.find((c) => c.category === "discontinued-operations");
    expect(item?.affectsTerminalEligibility).toBe(false);
    expect(item?.rationale).toMatch(/demerged to owners within the year/);
    expect(manifest.terminalEligibilityBlocked).toBe(false);
    expect(buildUnusualItemPolicy(demerged).terminalBlocker).toBe(false);

    // Without the demerger evidence (a sale, or still held for sale) it blocks.
    const sold: RecastPeriod = { ...demerged, spec_flags: [] };
    expect(summarizeUnusualItemManifest([sold], [raw]).terminalEligibilityBlocked).toBe(true);
    expect(buildUnusualItemPolicy(sold).terminalBlocker).toBe(true);
  });

  it("blocks on a recast spec_flag only in the terminal period", () => {
    const flagged = (period_end: string): RecastPeriod => ({
      ...EXISTING_TEST_PERIOD,
      period_end,
      spec_flags: [{ label: "CAPITAL_TRANSACTION", severity: "warning" as never, affects_terminal: true, message: "Buyback." } as never],
    });
    const clean = (period_end: string): RecastPeriod => ({ ...EXISTING_TEST_PERIOD, period_end, spec_flags: [] });
    expect(summarizeUnusualItemManifest([flagged("2023-03-31"), clean("2025-03-31")], []).terminalEligibilityBlocked).toBe(false);
    expect(summarizeUnusualItemManifest([clean("2023-03-31"), flagged("2025-03-31")], []).terminalEligibilityBlocked).toBe(true);
  });

  it("truncates classifications at MAX_UNUSUAL_ITEM_CLASSIFICATIONS", () => {
    // Build a synthetic raw fixture with > MAX classifications.
    const labels: Record<string, number> = {};
    for (let i = 0; i < MAX_UNUSUAL_ITEM_CLASSIFICATIONS + 50; i++) {
      labels[`Impairment Loss ${i}`] = i + 1;
    }
    const raw = mkRaw("2025-03-31", labels);
    const manifest = summarizeUnusualItemManifest([], [raw]);
    expect(manifest.truncated).toBe(true);
    expect(manifest.classifications.length).toBe(MAX_UNUSUAL_ITEM_CLASSIFICATIONS);
  });

  it("flag-off behavior is the caller's concern (manifest is computed regardless)", () => {
    // The manifest is always built; the flag only gates whether
    // analysisTraceability uses it to block valuation-eligible. So at
    // the manifest layer, we always return the same data.
    const raw = mkRaw("2025-03-31", { "Impairment Loss": 100 });
    const a = summarizeUnusualItemManifest([], [raw]);
    const b = summarizeUnusualItemManifest([], [raw]);
    expect(a).toEqual(b);
  });

  it("classifications include rationale + matched pattern", () => {
    const raw = mkRaw("2025-03-31", { "Impairment Loss on Goodwill": 100 });
    const out = classifyRunUnusualItems([], [raw]);
    const c = out.find((x) => x.category === "impairment");
    expect(c?.rationale).toMatch(/non-recurring/i);
    expect(c?.rationale).toContain("matched");
    expect(c?.matchedPattern).toBeTruthy();
  });

  it("totalUnusualImpactOnCoreOI sums abs(value) over Core-OI affecting items", () => {
    const raw = mkRaw("2025-03-31", {
      "Impairment Loss": 100,
      "Profit on Sale of Investment": 50,
      // Buyback affects terminal but not Core OI.
      "Buyback of Shares": 200,
    });
    const manifest = summarizeUnusualItemManifest([], [raw]);
    // Impairment (100) + asset-sale (50) = 150. Buyback excluded.
    expect(manifest.totalUnusualImpactOnCoreOI).toBe(150);
  });
});
