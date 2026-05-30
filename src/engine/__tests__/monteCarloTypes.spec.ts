import { describe, expect, it } from "vitest";
import { assertValidMonteCarloInput, normalizeMonteCarloRequest } from "../monteCarloTypes";
import { EngineConfig, RecastPeriod } from "../types";
import { PercentFraction } from "../types/units";

function mkConfig(): EngineConfig {
  return {
    ke: PercentFraction(0.12),
    kd_pretax: 0.08,
    tax_rate_for_kd: 0.25,
    risk_free_rate: 0.07,
    equity_risk_premium: 0.06,
    tax_rate_mode: "effective",
    statutory_tax_rate: 0.25,
    oci_treated_as_unusual: true,
    hybrid_perpetual_as_debt: true,
    investment_in_subsidiaries_as_operating: true,
    financial_institution_mode: false,
    noa_epsilon_ratio_of_ta: 0.1,
    separation_confidence_threshold: 70,
  };
}

function mkPeriod(): RecastPeriod {
  return {
    period_end: "2024-03-31",
    bs: {
      TA: 1000, CSE: 600, MI: 0, FA: 150, FO: 110, OA: 850, OL: 250, OL_TradePayables: 90,
      OL_OtherCurrentLiabilities: 40, OL_ProvisionsCurrent: 0, OL_ProvisionsLongTerm: 0,
      OL_CurrentTaxLiabilities: 0, OL_NonCurrentTaxLiabilities: 0, OL_DeferredTaxLiabilitiesNet: 0,
      OL_OtherNonCurrentLiabilities: 0, NOA: 600, NFO: -40, DTL: 0, PensionObl: 0, OL_ex_DTL: 250, Goodwill: 0,
      CurrentAssets: 300, CurrentLiabilities: 200, Inventory: 80, TradeReceivables: 100, TradePayables: 90,
      PPE: 240, LIFO_reserve: 0, separationScore: 90,
      OA_PPE: 240, OA_ROU: 0, OA_Goodwill: 0, OA_OtherIntangibles: 0, OA_Inventory: 80,
      OA_TradeReceivables: 100, OA_DTA: 0, OA_CWIP: 0, OA_Other: 430,
    },
    is: {
      Sales: 900, TaxExpense: 20, taxRate: 0.25, PAT: 120, OCI: 0, TCI: 120, TCI_NCI: 0, CNI: 120,
      FinanceCost: 8, FinanceIncome: 2, FinanceIncomeRung: 1, PreferredDividend: 0, NFE: 6, OI: 126, OtherItems: 0, OI_from_sales: 126, MII: 0, COGS: 500,
    },
    cu: { UOI: 0, CoreOI: 126, UFE: 0, CoreNFE: 6, ExceptionalItemsAfterTax: 0, OCITotal: 0 },
    cf: {
      CFO: 140, Capex: 35, DividendPaid: 20, EquityIssued: 0, ShareBuybacks: 0,
      InterestReceived: 2, DividendReceived: 1, FCF_accounting: 91, FCF_cash: 105,
      d_t: 20, d_t_formula: 20, d_t_discrepancy: 0, EBITDA: 150,
    },
  };
}

describe("monteCarloTypes", () => {
  it("normalizes defaults for N and horizonT", () => {
    const normalized = normalizeMonteCarloRequest({
      basePeriods: [mkPeriod()],
      config: mkConfig(),
      paramDistributions: {
        ke: { mean: 0.12, std: 0.01 },
        kw: { mean: 0.10, std: 0.01 },
        g: { mean: 0.04, std: 0.01 },
      },
    });
    expect(normalized.N).toBe(10000);
    expect(normalized.horizonT).toBe(5);
  });

  it("accepts valid normalized payload", () => {
    const input = normalizeMonteCarloRequest({
      basePeriods: [mkPeriod()],
      config: mkConfig(),
      N: 5000,
      horizonT: 7,
      seed: 123,
      paramDistributions: {
        ke: { mean: 0.12, std: 0.01 },
        kw: { mean: 0.10, std: 0.01 },
        g: { mean: 0.04, std: 0.01 },
      },
    });
    expect(() => assertValidMonteCarloInput(input)).not.toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => assertValidMonteCarloInput({})).toThrow("Monte Carlo 'basePeriods' must be a non-empty array");
    expect(() => assertValidMonteCarloInput({
      basePeriods: [mkPeriod()],
      config: mkConfig(),
      N: 0,
      horizonT: 5,
      paramDistributions: { ke: { mean: 1, std: 1 }, kw: { mean: 1, std: 1 }, g: { mean: 1, std: 1 } },
    })).toThrow("Monte Carlo 'N' must be a positive finite number");
    expect(() => assertValidMonteCarloInput({
      basePeriods: [mkPeriod()],
      config: mkConfig(),
      N: 1000,
      horizonT: 5,
      paramDistributions: { ke: { mean: 1, std: -1 }, kw: { mean: 1, std: 1 }, g: { mean: 1, std: 1 } },
    })).toThrow("Monte Carlo 'ke.std' must be a finite non-negative number");
  });
});
