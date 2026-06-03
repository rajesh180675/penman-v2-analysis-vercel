import { describe, expect, it } from "vitest";
import { buildAnalysisTraceability } from "../analysisTraceability";
import { getAnalysisPolicyVersions } from "../policyVersions";
import { assessAnalysisScope } from "../scopePolicy";
import { computeRecastPeriod } from "../PenmanNissimEngine";
import { AnalysisStatusSummary } from "../analysisStatus";
import { QualityGateReport } from "../mappingAudit";
import { DEFAULT_CONFIG, RawPeriodData, RecastPeriod } from "../types";

const CLEAN_STATUS: AnalysisStatusSummary = {
  status: "production-ready",
  label: "Production-ready",
  headline: "All checks cleared.",
  summary: "Clean.",
  reasons: [],
  tone: "emerald",
  qualityTier: "Tier 1",
  valuationStatus: "production-ready",
  scopeBlocked: false,
  valuationBlocked: false,
  blockingCount: 0,
  diagnosticCount: 0,
  optionalCount: 0,
};

function gateWithScope(scope: QualityGateReport["scopeAssessment"]): QualityGateReport {
  return {
    tier: "Tier 1",
    valuationBlocked: false,
    missingMinimum: [],
    missingCore: [],
    blockingReasons: [],
    policyVersion: getAnalysisPolicyVersions().mappingPolicyVersion,
    coverageSummary: {
      policyVersion: getAnalysisPolicyVersions().mappingPolicyVersion,
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
    scopeAssessment: scope,
  };
}

function mkTelecomRaw(period_end: string, i: number, overrides: Record<string, number> = {}): RawPeriodData {
  return {
    company_id: "TELECOM_CAP_LIFT",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 1200 + i * 100,
      "Total Equity__BalanceSheet": 650 + i * 50,
      "Total Stockholders' Equity__BalanceSheet": 650 + i * 50,
      "Minority Interest__BalanceSheet": 0,
      "Property, Plant and Equipment__BalanceSheet": 320 + i * 20,
      "Rights Under Licensing Agreement__BalanceSheet": 260 + i * 10,
      "Revenue From Operations(Net)__ProfitLoss": 950 + i * 60,
      "Profit Before Tax__ProfitLoss": 150 + i * 8,
      "Tax Expenses__ProfitLoss": 35 + i * 2,
      "Profit After Tax__ProfitLoss": 110 + i * 6,
      "Total Comprehensive Income for the Year__ProfitLoss": 110 + i * 6,
      "Finance Cost__ProfitLoss": 12 + i,
      "Other Income__ProfitLoss": 0,
      "Other Expenses__ProfitLoss": 120 + i * 5,
      "Direct Tele Communication / Network Development Expenses__ProfitLoss": 70 + i * 4,
      "License Fee / Operation Charges__ProfitLoss": 30 + i * 2,
      "Net Cash from Operating Activities__CashFlow": 150 + i * 8,
      "Purchased of Fixed Assets__CashFlow": -45 - i * 3,
      "Dividend Paid__CashFlow": -10,
      ...overrides,
    },
  };
}

function computeLatestRecast(rawData: RawPeriodData[]): RecastPeriod[] {
  const latest = rawData.at(-1);
  return latest ? [computeRecastPeriod(latest, { ...DEFAULT_CONFIG, company_type: "telecom" })] : [];
}

function buildTrace(rawData: RawPeriodData[]) {
  const scope = assessAnalysisScope(rawData);
  expect(scope.classification).toBe("detected-telecom-unmodelled");
  return buildAnalysisTraceability({
    generatedAt: "2026-06-01T00:00:00.000Z",
    runId: "run-telecom-cap-lift",
    companyId: "TELECOM_CAP_LIFT",
    sourceMode: "manual",
    rawData,
    rawMetricKeyCount: Object.keys(rawData[0]?.raw_metric_values ?? {}).length,
    periodCount: rawData.length,
    latestPeriod: rawData.at(-1)?.period_end,
    recastData: computeLatestRecast(rawData),
    config: { ...DEFAULT_CONFIG, company_type: "telecom" },
    analysisStatus: CLEAN_STATUS,
    qualityGate: gateWithScope(scope),
    valuationTriangulation: {
      methods: [
        { key: "accrual-riv", label: "Accrual RIV", perShare: 100 },
        { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: 104 },
        { key: "relative-ev-ebitda", label: "Relative EV/EBITDA", perShare: 98 },
      ],
    },
    policyVersions: getAnalysisPolicyVersions(),
  });
}

function mkUtilityRaw(period_end: string, i: number, overrides: Record<string, number> = {}): RawPeriodData {
  return {
    company_id: "UTILITY_CAP_LIFT",
    period_end,
    raw_metric_values: {
      "Total Assets__BalanceSheet": 2200 + i * 120,
      "Total Equity__BalanceSheet": 900 + i * 45,
      "Total Stockholders' Equity__BalanceSheet": 900 + i * 45,
      "Minority Interest__BalanceSheet": 0,
      "Property, Plant and Equipment__BalanceSheet": 980 + i * 60,
      "Capital Work in Progress__BalanceSheet": 240 + i * 15,
      "Regulatory Deferral Account - Debit Balance__BalanceSheet": 160 + i * 8,
      "Revenue From Operations(Net)__ProfitLoss": 1400 + i * 70,
      "Profit Before Tax__ProfitLoss": 250 + i * 10,
      "Tax Expenses__ProfitLoss": 62 + i * 2,
      "Profit After Tax__ProfitLoss": 188 + i * 8,
      "Total Comprehensive Income for the Year__ProfitLoss": 188 + i * 8,
      "Finance Cost__ProfitLoss": 55 + i * 2,
      "Other Income__ProfitLoss": 0,
      "Other Expenses__ProfitLoss": 120 + i * 5,
      "Net Cash from Operating Activities__CashFlow": 330 + i * 12,
      "Purchased of Fixed Assets__CashFlow": -210 - i * 8,
      "Dividend Paid__CashFlow": -70,
      ...overrides,
    },
  };
}

function computeLatestUtilityRecast(rawData: RawPeriodData[]): RecastPeriod[] {
  const latest = rawData.at(-1);
  return latest ? [computeRecastPeriod(latest, { ...DEFAULT_CONFIG, company_type: "utility" })] : [];
}

function buildUtilityTrace(rawData: RawPeriodData[]) {
  const scope = assessAnalysisScope(rawData);
  expect(scope.classification).toBe("detected-utility-unmodelled");
  return buildAnalysisTraceability({
    generatedAt: "2026-06-01T00:00:00.000Z",
    runId: "run-utility-cap-lift",
    companyId: "UTILITY_CAP_LIFT",
    sourceMode: "manual",
    rawData,
    rawMetricKeyCount: Object.keys(rawData[0]?.raw_metric_values ?? {}).length,
    periodCount: rawData.length,
    latestPeriod: rawData.at(-1)?.period_end,
    recastData: computeLatestUtilityRecast(rawData),
    config: { ...DEFAULT_CONFIG, company_type: "utility" },
    analysisStatus: CLEAN_STATUS,
    qualityGate: gateWithScope(scope),
    valuationTriangulation: {
      methods: [
        { key: "accrual-riv", label: "Accrual RIV", perShare: 100 },
        { key: "cash-fcff-dcf", label: "Cash-statement FCFF DCF", perShare: 103 },
        { key: "relative-ev-ebitda", label: "Relative EV/EBITDA", perShare: 97 },
      ],
    },
    policyVersions: getAnalysisPolicyVersions(),
  });
}

describe("telecom sector-native cap lift gate", () => {
  it("keeps the Phase-0 telecom cap when sector-native reconciliation is not confirmed", () => {
    const rawData = Array.from({ length: 4 }, (_, i) =>
      mkTelecomRaw(`${2022 + i}-03-31`, i, { "Rights Under Licensing Agreement__BalanceSheet": 0 }),
    );

    const trace = buildTrace(rawData);
    const readiness = trace.reconciliation.checks.find((check) => check.key === "telecom-sector-native-readiness");
    const veCheckpoint = trace.rigor.checkpoints.find((check) => check.level === "valuation-eligible");

    expect(readiness?.status).toBe("degraded");
    expect(trace.rigor.currentLevel).toBe("economically-plausible");
    expect(trace.rigor.achievedLevels).not.toContain("valuation-eligible");
    expect(veCheckpoint?.detail.toLowerCase()).toContain("sector-native reconciliation");
  });

  it("does not apply the Phase-0 telecom cap once sector-native reconciliation is confirmed", () => {
    const rawData = Array.from({ length: 4 }, (_, i) => mkTelecomRaw(`${2022 + i}-03-31`, i));

    const trace = buildTrace(rawData);
    const readiness = trace.reconciliation.checks.find((check) => check.key === "telecom-sector-native-readiness");
    const veCheckpoint = trace.rigor.checkpoints.find((check) => check.level === "valuation-eligible");

    expect(readiness?.status).toBe("confirmed");
    expect(veCheckpoint?.detail.toLowerCase()).not.toContain("no sector-native valuation model");
    expect(veCheckpoint?.detail.toLowerCase()).not.toContain("sector-native reconciliation");
  });
});

describe("utility sector-native cap lift gate", () => {
  it("does not apply the Phase-0 utility cap once regulatory-deferral rate-base evidence is confirmed", () => {
    const rawData = Array.from({ length: 4 }, (_, i) => mkUtilityRaw(`${2022 + i}-03-31`, i));

    const trace = buildUtilityTrace(rawData);
    const readiness = trace.reconciliation.checks.find((check) => check.key === "utility-sector-native-readiness");
    const veCheckpoint = trace.rigor.checkpoints.find((check) => check.level === "valuation-eligible");

    expect(readiness?.status).toBe("confirmed");
    expect(veCheckpoint?.detail.toLowerCase()).not.toContain("utility sector detected");
    expect(veCheckpoint?.detail.toLowerCase()).not.toContain("no utility-native");
  });
});
