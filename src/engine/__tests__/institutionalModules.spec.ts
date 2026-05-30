import { describe, expect, it } from "vitest";
import { summarizeConceptCoverage } from "../conceptOntology";
import { detectCorporateActions } from "../corporateActions";
import { buildFinancialInstitutionValuation } from "../financialInstitutionFramework";
import { buildPeerValuationSnapshot } from "../peerValuation";
import { buildQuarterlyDriverSummary } from "../quarterlyDriverModel";
import { calibrateSignalBacktest } from "../signalBacktest";
import { buildStatementDiagnostics } from "../statementDiagnostics";
import { buildStatementLineage } from "../statementLineage";
import { DEFAULT_CONFIG, RawPeriodData } from "../types";

describe("institutional expansion modules", () => {
  const industrialPeriods: RawPeriodData[] = [
    {
      company_id: "INDUSTRIAL",
      period_end: "2024-03-31",
      raw_metric_values: {
        "Revenue From Operations__ProfitLoss": 1000,
        "Profit After Tax__ProfitLoss": 120,
        "Total Equity__BalanceSheet": 600,
        "Property, Plant and Equipment__BalanceSheet": 400,
        "Inventory__BalanceSheet": 120,
        "Trade Receivables__BalanceSheet": 130,
        "Trade Payables__BalanceSheet": 90,
        "Net Cash From Operating Activities__CashFlow": 160,
        "Purchase of Fixed Assets__CashFlow": -80,
        "Number of Equity Shares - Subscribed Fully Paid up__BalanceSheet": 100,
      },
    },
    {
      company_id: "INDUSTRIAL",
      period_end: "2025-03-31",
      raw_metric_values: {
        "Revenue From Operations__ProfitLoss": 1700,
        "Profit After Tax__ProfitLoss": 180,
        "Total Equity__BalanceSheet": 760,
        "Property, Plant and Equipment__BalanceSheet": 610,
        "Inventory__BalanceSheet": 180,
        "Trade Receivables__BalanceSheet": 210,
        "Trade Payables__BalanceSheet": 100,
        "Net Cash From Operating Activities__CashFlow": 220,
        "Purchase of Fixed Assets__CashFlow": -160,
        "Number of Equity Shares - Subscribed Fully Paid up__BalanceSheet": 140,
        "Issue of Share Capital__CashFlow": 90,
      },
    },
  ];

  it("summarizes ontology coverage and diagnostics", () => {
    const coverage = summarizeConceptCoverage(industrialPeriods);
    const diagnostics = buildStatementDiagnostics(industrialPeriods);
    expect(coverage.coreMatchedCount).toBeGreaterThan(3);
    expect(diagnostics.diagnostics.length).toBeGreaterThan(0);
  });

  it("detects corporate actions and values financial companies with the new framework", () => {
    const actions = detectCorporateActions(industrialPeriods);
    expect(actions.some((item) => item.kind === "capital-raise" || item.kind === "dilution")).toBe(true);

    const financialPeriods: RawPeriodData[] = [
      {
        company_id: "NBFC",
        period_end: "2025-03-31",
        raw_metric_values: {
          "Total Equity__BalanceSheet": 1250,
          "Profit After Tax__ProfitLoss": 175,
          "Number of Equity Shares - Issued__BalanceSheet": 100,
          "Loan Assets__BalanceSheet": 8500,
          "Interest Income__ProfitLoss": 920,
        },
      },
    ];

    const valuation = buildFinancialInstitutionValuation(financialPeriods, DEFAULT_CONFIG);
    expect(valuation?.bookValuePerShare).toBeCloseTo(12.5, 4);
    expect(valuation?.roe).toBeGreaterThan(0.1);
    expect(valuation?.institutionKind).toBe("nbfc");
    expect(valuation?.keyMetrics.length).toBeGreaterThan(2);
  });

  it("builds statement lineage, quarterly drivers, peers, and calibration summaries", () => {
    const lineage = buildStatementLineage(industrialPeriods);
    expect(lineage.versions).toHaveLength(2);
    expect(lineage.filingMix.annual).toBe(2);

    const quarterly = buildQuarterlyDriverSummary(industrialPeriods, []);
    expect(quarterly.filingCadence).toBe("annual-only");
    expect(quarterly.capacitySignal.length).toBeGreaterThan(10);

    const peers = buildPeerValuationSnapshot({
      registry: { companies: {} },
      sector: "consumer",
      workspaceCompanies: [
        {
          companyId: "A",
          label: "A",
          issuer: { sector: "consumer" },
          valuations: [{ signalLabel: "Interesting", marketPrice: 100, expectedCagrStress: 0.18, stressUpsidePct: 0.25, opportunityScore: 72 }],
        },
        {
          companyId: "B",
          label: "B",
          issuer: { sector: "consumer" },
          valuations: [{ signalLabel: "Watch", marketPrice: 90, expectedCagrStress: 0.1, stressUpsidePct: 0.12, opportunityScore: 55 }],
        },
      ],
    });
    expect(peers.medians.expectedCagrStress).toBeGreaterThan(0.1);
    expect(peers.peers[0]!.historyPoints).toBeGreaterThan(0);

    const calibration = calibrateSignalBacktest({
      available: true,
      points: [],
      countsByState: {
        blocked: 0,
        guarded: 1,
        watchlist: 2,
        interesting: 2,
        "high-conviction": 1,
        "screaming-buy": 0,
      },
      investableCount: 3,
      highConvictionCount: 1,
      screamingBuyCount: 0,
      forwardWinRate1Y: 0.6,
      forwardWinRate3Y: 0.75,
      median1Y: 0.12,
      median3Y: 0.32,
      latestComparedToHistory: "better-than-median",
    });
    expect(calibration.calibrationBand).toBe("thin");
    expect(calibration.hitRateSummary).toContain("1Y");
  });
});
