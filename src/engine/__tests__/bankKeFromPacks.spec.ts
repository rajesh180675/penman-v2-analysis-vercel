/**
 * The financial-institution valuation's cost of equity comes from the market
 * packs the caller supplies, the same way every other valuation surface's
 * does (S-9.4C). Without them it is the undated sector prior, which gave every
 * bank the same beta of 1.10 whatever its measured beta was.
 */
import { describe, expect, it } from "vitest";
import { computeBankValuation } from "../bankValuation";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import { ACTIVE_MARKET_PACKS } from "../marketPacks";
import { DEFAULT_CONFIG, type EngineConfig } from "../types";
import type { BankPeriodMetrics } from "../bankPipeline";

const history: BankPeriodMetrics[] = [0.16, 0.17, 0.16, 0.17, 0.166].map((roe, i) => ({
  period_end: `${2021 + i}-03-31`,
  totalEquity: 400_000 + i * 35_000,
  pat: roe * (400_000 + i * 35_000),
  roe,
}) as unknown as BankPeriodMetrics);

const packs = { ...ACTIVE_MARKET_PACKS, analysisAsOf: "2026-10-01" };

describe("bank valuation cost of equity", () => {
  it("resolves the sourced CAPM rate the packs give, the same one the shared resolver returns", () => {
    for (const ticker of ["HDFCBANK", "KOTAKBANK"]) {
      const config = { ...DEFAULT_CONFIG, company_type: "bank", ticker } as EngineConfig;
      const sourced = resolveCostOfCapitalFromConfig({ config, ...packs });
      const prior = resolveCostOfCapitalFromConfig({ config });
      // The packs matter: a measured beta and dated rf/ERP, not the sector prior.
      expect(Math.abs(sourced.ke - prior.ke)).toBeGreaterThan(0.001);
      expect(computeBankValuation(history, config, null, 0.2, false, false, packs).ke).toBe(sourced.ke);
      expect(computeBankValuation(history, config, null, 0.2).ke).toBe(prior.ke);
    }
  });

  it("gives two banks different rates once their betas are measured", () => {
    const keOf = (ticker: string) =>
      computeBankValuation(history, { ...DEFAULT_CONFIG, company_type: "bank", ticker } as EngineConfig, null, 0.2, false, false, packs).ke;
    expect(keOf("HDFCBANK")).not.toBeCloseTo(keOf("KOTAKBANK"), 3);
  });
});
