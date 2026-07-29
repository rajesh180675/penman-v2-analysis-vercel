import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DebugPanel from "../DebugPanel";
import { CapitalineParseDebug } from "../../engine/capitalineParser";
import { getAnalysisPolicyVersions } from "../../engine/policyVersions";
import { QualityGateReport } from "../../engine/mappingAudit";
import type { RawPeriodData, RecastPeriod } from "../../engine/types";

const versions = getAnalysisPolicyVersions();

function mkDebugInfo(): CapitalineParseDebug {
  return {
    companyId: "BANK",
    files: [{ name: "BalanceSheet.xlsx", statementGuess: "BalanceSheet" }],
    detectedPeriods: ["2025-03-31"],
    sourceArtifactHashes: [],
    rawGrids: [],
    metrics: {
      totalCompositeKeys: 1,
      totalBaseKeys: 1,
      baseKeyCollisions: [],
        byStatement: {
          BalanceSheet: 2,
          ProfitLoss: 4,
          CashFlow: 2,
          Unknown: 0,
          Segment: 0,
        },
    },
    warnings: [],
    sample: { firstRows: [] },
    rawMetricKeys: ["Deposits"],
  };
}

function mkQualityGate(): QualityGateReport {
  return {
    tier: "Tier 1",
    valuationBlocked: true,
    missingMinimum: [],
    missingCore: [],
    blockingReasons: ["Terminal anchor remains guarded."],
    policyVersion: versions.mappingPolicyVersion,
    coverageSummary: {
      policyVersion: versions.mappingPolicyVersion,
      issues: [],
      unresolvedBySeverity: { critical: [], warning: [], info: [] },
      unresolvedByTier: { "Tier A": [], "Tier B": [], "Tier C": [], "Tier D": [] },
      totalsByTier: {
        "Tier A": { total: 0, resolved: 0, unresolved: 0 },
        "Tier B": { total: 0, resolved: 0, unresolved: 0 },
        "Tier C": { total: 0, resolved: 0, unresolved: 0 },
        "Tier D": { total: 0, resolved: 0, unresolved: 0 },
      },
    },
    valuationCriticalGaps: [],
    ratioCriticalGaps: [],
    scopeAssessment: {
      policyVersion: versions.scopePolicyVersion,
      classification: "unsupported-financial-company",
      analysisFamily: "financial-institution",
      blocked: true,
      label: "Unsupported scope",
      reasons: ["Banking issuer is outside current supported scope."],
      recommendedAction: "Do not proceed",
      signals: [
        {
          kind: "banking",
          key: "Deposits",
          periodsObserved: 1,
        },
      ],
    },
  };
}

describe("DebugPanel mapping coverage audit", () => {
  it("labels raw counts as mapping counts when blocked trust gates exceed mapping blockers", () => {
    const html = renderToStaticMarkup(
      <DebugPanel
        debugInfo={mkDebugInfo()}
        rawData={[
          {
            company_id: "BANK",
            period_end: "2025-03-31",
            raw_metric_values: {
              "Deposits__BalanceSheet": 1000,
            },
          },
        ]}
        recastData={[]}
        qualityGate={mkQualityGate()}
        engineError={null}
      />,
    );

    expect(html).toContain("Mapping blocking");
    expect(html).toContain("Mapping diagnostic");
    expect(html).toContain("Mapping optional");
    expect(html).not.toContain(">Blocking<");
    expect(html).not.toContain(">Diagnostic<");
    expect(html).not.toContain(">Optional<");
  });
});

/* ── Realistic fixture that exercises every major panel (regression safety net
      for the DebugPanel → src/components/debug/ extraction). ───────────────── */

function mkRichDebugInfo(): CapitalineParseDebug {
  return {
    companyId: "ACME",
    files: [
      { name: "BalanceSheet.xlsx", statementGuess: "BalanceSheet" },
      { name: "ProfitLoss.xlsx", statementGuess: "ProfitLoss" },
    ],
    detectedPeriods: ["2024-03-31", "2025-03-31"],
    sourceArtifactHashes: [],
    metrics: {
      totalCompositeKeys: 14,
      totalBaseKeys: 7,
      baseKeyCollisions: [],
      byStatement: {
        BalanceSheet: 4,
        ProfitLoss: 8,
        CashFlow: 2,
        Unknown: 0,
        Segment: 0,
      },
    },
    rawGrids: [
      {
        file: "BalanceSheet.xlsx",
        rowCount: 3,
        colCount: 3,
        bestMethod: "table",
        methods: ["table"],
        headerDetected: true,
        headerRowIndex: 0,
        periodLabels: ["2024-03", "2025-03"],
        errors: [],
        firstRows: [
          ["Metric", "2024-03", "2025-03"],
          ["Total Assets", "900", "1000"],
        ],
      },
    ],
    warnings: [
      { file: "ProfitLoss.xlsx", message: "Heuristic header fallback used", detail: "row 2 chosen" },
    ],
    sample: {
      firstRows: [
        { metric: "Total Assets", statement: "BalanceSheet", values: ["900", "1000"] },
      ],
    },
    rawMetricKeys: ["Total Assets", "Total Equity", "Revenue From Operations(Net)"],
  };
}

/* Both composite and base keys, because that is what a real parse produces:
   `capitalineParser.ts:536-539` writes the base-key winners into
   `raw_metric_values` alongside the `__`-suffixed composites. The 2025 period
   carries one key the 2024 period does not, so a distinct count over both
   periods is distinguishable from either a per-period sum or a single-period
   read. */
function mkRichRaw(): RawPeriodData[] {
  return [
    {
      company_id: "ACME",
      period_end: "2024-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 900,
        "Total Equity__BalanceSheet": 540,
        "Revenue From Operations(Net)__ProfitLoss": 760,
        "Profit Before Tax__ProfitLoss": 120,
        "Tax Expenses__ProfitLoss": 30,
        "Profit After Tax__ProfitLoss": 90,
        "Net Cash from Operating Activities__CashFlow": 130,
        "Total Assets": 900,
        "Total Equity": 540,
        "Revenue From Operations(Net)": 760,
        "Profit Before Tax": 120,
        "Tax Expenses": 30,
        "Profit After Tax": 90,
        "Net Cash from Operating Activities": 130,
      },
    },
    {
      company_id: "ACME",
      period_end: "2025-03-31",
      raw_metric_values: {
        "Total Assets__BalanceSheet": 1000,
        "Total Equity__BalanceSheet": 600,
        "Revenue From Operations(Net)__ProfitLoss": 850,
        "Profit Before Tax__ProfitLoss": 130,
        "Tax Expenses__ProfitLoss": 32,
        "Profit After Tax__ProfitLoss": 98,
        "Net Cash from Operating Activities__CashFlow": 145,
        "Exceptional Items__ProfitLoss": 4,
        "Total Assets": 1000,
        "Total Equity": 600,
        "Revenue From Operations(Net)": 850,
        "Profit Before Tax": 130,
        "Tax Expenses": 32,
        "Profit After Tax": 98,
        "Net Cash from Operating Activities": 145,
        "Exceptional Items": 4,
      },
    },
  ];
}

function mkRecast(period_end: string): RecastPeriod {
  return {
    period_end,
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 150, FO: 150, OA: 850, OL: 250,
      NOA: 600, NFO: 0, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
      CurrentAssets: 400, CurrentLiabilities: 200, Inventory: 90, TradeReceivables: 110, TradePayables: 80,
      PPE: 320, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 320, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0,
      OA_Inventory: 90, OA_TradeReceivables: 110, OA_DTA: 0, OA_CWIP: 0, OA_Other: 330,
      OL_TradePayables: 80, OL_OtherCurrentLiabilities: 50, OL_ProvisionsCurrent: 10, OL_ProvisionsLongTerm: 10,
      OL_CurrentTaxLiabilities: 10, OL_NonCurrentTaxLiabilities: 10, OL_DeferredTaxLiabilitiesNet: 0, OL_OtherNonCurrentLiabilities: 90,
    },
    is: {
      Sales: 900, TaxExpense: 30, taxRate: 0.25, PAT: 90, OCI: 0, TCI: 90, TCI_NCI: 0,
      CNI: 90, FinanceCost: 10, FinanceIncome: 0, FinanceIncomeRung: 1, PreferredDividend: 0,
      relatedPartyTransactions: 0, auditorChange: false, qualifiedOpinion: false,
      NFE: 10, OI: 100, OtherItems: 0, OI_from_sales: 100, MII: 0, COGS: 600,
    },
    cu: {
      UOI: 0, CoreOI: 100, UFE: 0, CoreNFE: 10, ExceptionalItemsAfterTax: 0, OCITotal: 0,
    },
    cf: {
      CFO: 120, Capex: 40, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 0, DividendReceived: 0, DebtProceeds: 0, DebtRepayment: 0,
      FCF_accounting: 60, FCF_cash: 80, d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 140,
    },
    trace: {
      "Sales": [
        { statement: "ProfitLoss", key: "Revenue From Operations(Net)", value: 900, matchType: "exact_composite", note: "primary read" },
      ],
    },
  } as RecastPeriod;
}

describe("DebugPanel panel rendering (SSR safety net)", () => {
  const html = renderToStaticMarkup(
    <DebugPanel
      debugInfo={mkRichDebugInfo()}
      rawData={mkRichRaw()}
      recastData={[mkRecast("2024-03-31"), mkRecast("2025-03-31")]}
      qualityGate={null}
      engineError={null}
    />,
  );

  /* A run of `{expr} literal {expr}` can be split into separate text nodes, so
     assertions that pin a number next to its unit are made against this. */
  const text = html.replace(/<!-- -->/g, "");

  it("renders the status banner with parsed period/file counts", () => {
    expect(html).toContain("Parsed 2 periods from 2 files");
  });

  it("counts distinct keys in the banner, not the parser's per-period sums", () => {
    // The fixture's `metrics` carries the mismatched pair the banner used to
    // show: 14 composite (a sum over 2 periods) beside 7 base (the oldest
    // period alone). The union is 8 composite and 8 base — the two periods
    // share seven keys and 2025 adds "Exceptional Items".
    expect(text).toContain("8 composite keys");
    expect(text).toContain("8 base metrics");
    expect(text).not.toContain("14 composite keys");
    expect(text).not.toContain("7 base metrics");
  });

  it("states the basis the two banner counts share", () => {
    expect(html).toContain("Distinct keys across all 2 periods.");
  });

  it("labels the head tiles as distinct counts", () => {
    // These sit beside a "Periods" tile. Unlabelled, Infosys read as 3,600
    // composite keys against 15 periods — which is 15 × 240.
    expect(html).toContain("Distinct Composite Keys");
    expect(html).toContain("Distinct Base Metrics");
  });

  it("names the by-statement chips as per-period reads and totals them", () => {
    // The chips are `byStatement`, incremented in the same loop iteration as
    // the old composite total, so they sum to it: 4 + 8 + 2 = 14 here. Left
    // titled "Metrics by Statement" beside a distinct count of 8, they would
    // have replaced one basis mismatch with another.
    expect(html).toContain("Composite Key Reads by Statement");
    expect(text).toContain("14 reads across 2 periods");
    expect(html).not.toContain("Metrics by Statement");
  });

  it("renders the mapping coverage audit grid with dataset/backlog sections", () => {
    expect(html).toContain("Mapping Coverage Audit");
    expect(html).toContain("BS keys in dataset");
    expect(html).toContain("PL keys in dataset");
    expect(html).toContain("CF keys in dataset");
    expect(html).toContain("Ranked backlog triage");
    expect(html).toContain("Used keys not present in YAML");
    expect(html).toContain("YAML keys not present in dataset");
    expect(html).toContain("Unresolved critical keys by statement");
  });

  it("renders the accounting identity suite with per-assertion breakdown", () => {
    expect(html).toContain("Accounting Identities (A1");
    expect(html).toContain("Assertions");
    expect(html).toContain("Passed");
    expect(html).toContain("Failed");
    // byAssertion ids are rendered as their own headers
    expect(html).toContain(">A1<");
    expect(html).toContain(">A9<");
  });

  it("renders the traceability panel with trace records and export controls", () => {
    expect(html).toContain("Traceability Panel — Source key");
    expect(html).toContain("Export Trace CSV");
    expect(html).toContain("Export Trace JSON");
    expect(html).toContain("trace rows across all periods");
    // trace line label is clickable in the left rail
    expect(html).toContain(">Sales<");
  });

  it("renders recast verification identity checks for the selected period", () => {
    expect(html).toContain("Recast Verification");
    expect(html).toContain("Balance Sheet");
    expect(html).toContain("Income Statement");
    expect(html).toContain("Identity Checks");
    expect(html).toContain("TA = OA + FA");
    expect(html).toContain("NOA = OA");
  });

  it("renders the metric key search panel", () => {
    expect(html).toContain("Metric Key Search");
    expect(html).toContain("e.g. Finance Cost");
  });

  it("renders the raw base-metric-keys grid, scoped to the period it shows", () => {
    // The title used to read "All Base Metric Keys in Period 1". The list is
    // `rawMetricKeys`, built from the oldest period only, and "Period 1" read as
    // the latest year on a panel that is newest-first everywhere else.
    expect(html).toContain("Base Metric Keys in 2024-03, oldest of 2 periods");
    expect(html).toContain("Show all keys");
  });

  it("renders the manifest verification panel", () => {
    expect(html).toContain("Verify Manifest (HMAC / SHA-256)");
    expect(html).toContain("HMAC secret (optional)");
  });

  it("renders the granularity coverage checklist", () => {
    expect(html).toContain("Granularity Coverage Checklist");
    expect(html).toContain("Export CSV");
    expect(html).toContain("Export JSON");
  });

  it("renders files-in-zip, warnings, sample, and the trace log viewer", () => {
    expect(html).toContain("Files in ZIP");
    expect(html).toContain("BalanceSheet.xlsx");
    expect(html).toContain("Heuristic header fallback used");
    expect(html).toContain("Sample Parsed Metrics");
    expect(html).toContain("Raw Grid Dumps");
    expect(html).toContain("Trace Log");
    expect(html).toContain("events");
  });
});
