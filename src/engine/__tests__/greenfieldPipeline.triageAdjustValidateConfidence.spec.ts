import { describe, expect, it } from "vitest";
import { runGreenfieldPipeline, triageSignals, validateAdjustments, type AnomalySignal, type NormalizedPeriod } from "../greenfieldPipeline";
import { DEFAULT_CONFIG, type RawPeriodData } from "../types";

function signal(id: string, detectorId: AnomalySignal["detectorId"], period: string, suggestedAdjusters: AnomalySignal["suggestedAdjusters"] = []): AnomalySignal {
  return {
    id,
    detectorId,
    period,
    severity: "WARNING",
    p_artifact: 0.9,
    label: id,
    message: id,
    affectedFields: [],
    evidence: {},
    suggestedAdjusters,
    suppresses: [],
    blocksValuation: false,
    blocksAdjustment: false,
  };
}

function raw(period_end: string, values: Record<string, number | null>): RawPeriodData {
  return { company_id: "DMART", period_end, accounting_standard: "ind-as", currency_unit: "Crores", raw_metric_values: values };
}

function normalized(periodEnd: string): NormalizedPeriod {
  return {
    companyId: "X",
    periodEnd,
    periodStart: null,
    isPartialPeriod: false,
    periodLengthDays: 365,
    accountingStandard: "ind-as",
    standardAdoptions: { indAS109: true, indAS115: true, indAS116: true, adoptionDateEvidence: {} },
    industry: { companyType: "consumer", inferredIndustry: "consumer", confidence: "explicit" },
    values: {
      revenue: 100,
      cse: 50,
      totalAssets: 120,
      totalLiabilities: 70,
      cfo: 10,
      capex: 5,
      fcfCash: -1,
      leaseLiabilities: 20,
      rightOfUseAssets: 15,
      financialDebtExLease: 25,
      nfo: 18,
      nfoExLease: 18,
      leaseNeutralEquity: null,
      dividendsPaid: 0,
      equityIssued: 0,
      buybacks: 0,
      netIncome: 10,
      oci: 0,
    },
    derived: { rnoa: 0.2, flev: 0.36, pm: 0.1, ato: 2, dirtySurplusSeed: 5 },
    lineage: [],
  };
}

describe("greenfield L3-L6 integration", () => {
  it("triages D4 suppression and orders A1 before downstream adjusters", () => {
    const dirty = signal("dirty", "D2_DIRTY_SURPLUS", "2025-03-31", ["A2_DIRTY_SURPLUS_ADJUSTER"]);
    const oci = { ...signal("oci", "D4_FX_OCI_TRANSLATION", "2025-03-31", ["A2_DIRTY_SURPLUS_ADJUSTER"]), suppresses: [{ detectorId: "D2_DIRTY_SURPLUS" as const, period: "2025-03-31", reason: "OCI explains residual" }] };
    const lease = signal("lease", "D3_LEASE_ACCOUNTING", "2025-03-31", ["A1_LEASE_ADJUSTER"]);
    const buyback = signal("buyback", "D7_BUYBACK_CAPITAL_RETURN", "2025-03-31", ["A4_BUYBACK_ADJUSTER"]);
    const triage = triageSignals([dirty, oci, lease, buyback], DEFAULT_CONFIG);

    expect(triage.suppressedSignals.map((item) => item.signal.id)).toContain("dirty");
    expect(triage.adjusterOrder.indexOf("A1_LEASE_ADJUSTER")).toBeLessThan(triage.adjusterOrder.indexOf("A4_BUYBACK_ADJUSTER"));
  });

  it("validates field-level adjustments and rejects any attempted FCF change", () => {
    const asReported = [normalized("2025-03-31")];
    const adjusted = [normalized("2025-03-31")];
    adjusted[0]!.values.fcfCash = 100;
    const { auditTrail, validation } = validateAdjustments(asReported, adjusted, [{
      adjusterId: "A1_LEASE_ADJUSTER",
      field: "values.fcfCash",
      period: "2025-03-31",
      before: -1,
      after: 100,
      delta: 101,
      reason: "bad test adjustment",
      driven_by: [],
      validationStatus: "pending",
      rejectedBy: [],
    }]);

    expect(auditTrail[0]!.validationStatus).toBe("rejected");
    expect(adjusted[0]!.values.fcfCash).toBe(-1);
    expect(validation.rejectedCount).toBe(1);
  });

  it("runs the six-layer sidecar and keeps DMART story non-distressed but confidence-capped when stale", () => {
    const result = runGreenfieldPipeline({
      rawData: [
        raw("2020-03-31", { "Total Equity__BalanceSheet": -100, "Profit After Tax__ProfitLoss": 50, "Lease Liabilities__BalanceSheet": 600, "Right of Use Assets__BalanceSheet": 500 }),
        raw("2021-03-31", { "Total Equity__BalanceSheet": -50, "Profit After Tax__ProfitLoss": 60, "Lease Liabilities__BalanceSheet": 700, "Right of Use Assets__BalanceSheet": 600 }),
        raw("2025-03-31", { "Revenue From Operations(Net)__ProfitLoss": 59_358.05, "Total Equity__BalanceSheet": 21_426.7, "Profit After Tax__ProfitLoss": 2_900, "Net Cash from Operating Activities__CashFlow": 2_462.97, "Purchased of Fixed Assets__CashFlow": 3_423.04, "Lease Liabilities__BalanceSheet": 1_000, "Right of Use Assets__BalanceSheet": 900 }),
      ],
      config: { ...DEFAULT_CONFIG, company_type: "consumer" },
      context: { asOf: "2026-06-02", marketExpectation: { marginOfSafetyPct: -0.95, reverseDcfSaturated: true } },
    });

    const solvency = result.signals.find((item) => item.detectorId === "D5_NEGATIVE_EQUITY_SOLVENCY");
    expect(solvency).toBeDefined();
    expect(solvency!.blocksValuation).toBe(false);
    expect(result.signals.some((item) => item.detectorId === "D10_EXPANSION_CAPEX_FCF")).toBe(true);
    expect(result.signals.some((item) => item.label === "OVERVALUATION_SIGNAL")).toBe(true);
    expect(result.confidence.adjusted.score).toBeLessThanOrEqual(55);
  });
});
