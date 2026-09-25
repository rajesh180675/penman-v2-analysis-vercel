/**
 * SEADE — cyclical derivation.
 *
 * Derives CyclicalMidCycleCaseInput from parsed financials using an honest
 * index-normalization approach. Cyclical companies (steel, cement, autos) do
 * not disclose physical volume/price on the face of financial statements, so
 * SEADE does NOT fabricate tonnes/realizations. Instead it normalizes through
 * the cycle:
 *
 *   normalizedVolume   = mid-cycle revenue index (median Sales across history)
 *   midCyclePricePerUnit = 1 (price index; volume IS revenue at mid-cycle)
 *   cashCostPerUnit    = median COGS share of revenue (variable cash cost)
 *   annualFixedCostsCr = residual operating cost after variable COGS
 *   sustainingCapexCr  = median capex across the cycle
 *
 * This keeps the mid-cycle EBITDA margin faithful to history while making the
 * volume/price/cost split explicit and auditable. Mid-cycle FCFF is positive
 * whenever the historical median EBITDA margin exceeds the fixed-cost share.
 */
import type { RecastPeriod } from "../types";
import type { EngineConfig } from "../types";
import { ke_from_config } from "../types/config";
import type { CyclicalMidCycleCaseInput } from "../sectorCases/contracts";
import { bs, clamp, is, latestPeriod, median, prov } from "./derivationUtils";
import type { DerivationProvenance } from "./types";

export interface CyclicalDerivationResult {
  readonly input: CyclicalMidCycleCaseInput | null;
  readonly provenance: Readonly<Record<string, DerivationProvenance>>;
  readonly missingEvidence: readonly string[];
  readonly reason: string;
}

/** Minimum periods needed to observe a cycle. */
const MIN_CYCLE_PERIODS = 5;

function seriesValues(
  periods: readonly RecastPeriod[],
  pick: (p: RecastPeriod) => number | null | undefined,
): number[] {
  return [...periods]
    .sort((a, b) => a.period_end.localeCompare(b.period_end))
    .map(pick)
    .filter((v): v is number => v != null && Number.isFinite(v));
}

function deriveNormalizedVolume(periods: readonly RecastPeriod[]): { value: number | null; prov: DerivationProvenance } {
  const sales = seriesValues(periods, (p) => p.is.Sales);
  if (sales.length < MIN_CYCLE_PERIODS) {
    return {
      value: null,
      prov: prov(["is.Sales"], `Need ≥${MIN_CYCLE_PERIODS} periods of Sales for mid-cycle normalization; have ${sales.length}`, "low"),
    };
  }
  const med = median(sales);
  return {
    value: med,
    prov: prov(["is.Sales"], `Normalized volume = median Sales across ${sales.length} periods (revenue index at mid-cycle)`, "medium"),
  };
}

function deriveCashCostShare(periods: readonly RecastPeriod[]): { value: number | null; prov: DerivationProvenance } {
  const ratios = seriesValues(periods, (p) => {
    const sales = p.is.Sales;
    const cogs = p.is.COGS;
    if (sales == null || sales <= 0 || cogs == null || !Number.isFinite(cogs) || cogs < 0) return null;
    return cogs / sales;
  });
  if (ratios.length < MIN_CYCLE_PERIODS) {
    return {
      value: null,
      prov: prov(["is.COGS", "is.Sales"], `Need ≥${MIN_CYCLE_PERIODS} periods of COGS/Sales; have ${ratios.length}`, "low"),
    };
  }
  const med = median(ratios);
  if (med == null) return { value: null, prov: prov(["is.COGS", "is.Sales"], "COGS share median unavailable", "low") };
  return {
    value: clamp(med, 0, 0.95),
    prov: prov(["is.COGS", "is.Sales"], `Cash cost share = median(COGS / Sales) across ${ratios.length} periods`, "medium"),
  };
}

function deriveAnnualFixedCostsCr(
  periods: readonly RecastPeriod[],
  midCycleRevenue: number | null,
  cashCostShare: number | null,
): { value: number | null; prov: DerivationProvenance } {
  // Fixed costs = operating costs that are NOT variable COGS. Approximate from
  // the median EBITDA margin: EBITDA = Revenue − COGS − FixedCosts, so
  // FixedCosts = Revenue − COGS − EBITDA. Use mid-cycle values for stability.
  const ebitdaMargins = seriesValues(periods, (p) => {
    const sales = p.is.Sales;
    const ebitda = p.cf.EBITDA;
    if (sales == null || sales <= 0 || ebitda == null || !Number.isFinite(ebitda)) return null;
    return ebitda / sales;
  });
  if (midCycleRevenue == null || cashCostShare == null || ebitdaMargins.length < MIN_CYCLE_PERIODS) {
    return {
      value: null,
      prov: prov(["cf.EBITDA", "is.Sales", "is.COGS"], "Fixed costs require mid-cycle revenue, COGS share, and EBITDA margin series", "low"),
    };
  }
  const medEbitdaMargin = median(ebitdaMargins)!;
  // At mid-cycle: EBITDA = midRevenue × medEbitdaMargin; COGS = midRevenue × cashCostShare.
  // FixedCosts = midRevenue − COGS − EBITDA = midRevenue × (1 − cashCostShare − medEbitdaMargin).
  const fixedCosts = midCycleRevenue * (1 - cashCostShare - medEbitdaMargin);
  if (fixedCosts < 0) {
    // Margins imply negative fixed costs — the decomposition is degenerate for
    // this company (COGS share + EBITDA margin > 100%). Fail closed.
    return {
      value: null,
      prov: prov(["cf.EBITDA", "is.Sales", "is.COGS"], `Degenerate fixed-cost decomposition: COGS share ${(cashCostShare * 100).toFixed(0)}% + EBITDA margin ${(medEbitdaMargin * 100).toFixed(0)}% exceeds revenue`, "low"),
    };
  }
  return {
    value: fixedCosts,
    prov: prov(["cf.EBITDA", "is.Sales", "is.COGS"], `Fixed costs = midRevenue × (1 − COGS share − EBITDA margin) = ₹${fixedCosts.toFixed(0)} Cr`, "medium"),
  };
}

function deriveSustainingCapexCr(periods: readonly RecastPeriod[]): { value: number | null; prov: DerivationProvenance } {
  const capex = seriesValues(periods, (p) => (p.cf.Capex != null && p.cf.Capex > 0 ? Math.abs(p.cf.Capex) : null));
  if (capex.length < 3) {
    return {
      value: null,
      prov: prov(["cf.Capex"], `Need ≥3 periods of capex for sustaining-capex estimate; have ${capex.length}`, "low"),
    };
  }
  const med = median(capex);
  return {
    value: med,
    prov: prov(["cf.Capex"], `Sustaining capex = median capex across ${capex.length} periods`, "medium"),
  };
}

function deriveCashTaxRate(periods: readonly RecastPeriod[], config: EngineConfig): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const taxRate = is(latest, "taxRate");
  if (taxRate != null && taxRate > 0.01 && taxRate < 0.55) {
    return {
      value: clamp(taxRate, 0, 0.5),
      prov: prov(["is.taxRate"], "Latest-period effective tax rate", "high"),
    };
  }
  return {
    value: clamp(config.statutory_tax_rate, 0, 0.5),
    prov: prov(["config.statutory_tax_rate"], "Statutory tax rate (no effective rate available)", "medium", "statutory-tax-rate"),
  };
}

function deriveCostOfOperations(config: EngineConfig): { value: number; prov: DerivationProvenance } {
  // Cyclical FCFF is discounted at the operating cost of capital. Use
  // sector-adjusted ke as the operating cost proxy (cyclical companies carry
  // high beta, so ke is the binding discount rate).
  const ke = ke_from_config(config);
  return {
    value: clamp(ke, 0.05, 0.25),
    prov: prov(["config.ke", "config.risk_free_rate", "config.beta", "config.company_type"], "Cost of operations ≈ sector-adjusted cost of equity (ke)", "medium", "sector-ke-prior"),
  };
}

function deriveTerminalGrowth(config: EngineConfig): { value: number; prov: DerivationProvenance } {
  const g = config.terminal_growth_rate ?? config.g_terminal_override ?? 0.04;
  return {
    value: clamp(g, -0.02, 0.06),
    prov: prov(["config.terminal_growth_rate", "config.g_terminal_override"], "Terminal growth from config (default 4%)", "medium", "terminal-growth-prior"),
  };
}

function deriveNetDebtCr(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const nfo = bs(latest, "NFO");
  if (nfo != null) {
    return {
      value: nfo,
      prov: prov(["bs.NFO"], "Net financial obligations (NFO) from recast balance sheet", "high"),
    };
  }
  const fo = bs(latest, "FO");
  const fa = bs(latest, "FA");
  if (fo != null && fa != null) {
    return {
      value: fo - fa,
      prov: prov(["bs.FO", "bs.FA"], "Net debt = FO - FA (NFO unavailable)", "medium"),
    };
  }
  return {
    value: 0,
    prov: prov(["bs.NFO", "bs.FO", "bs.FA"], "No debt fields available; assuming zero net debt", "low"),
  };
}

export function deriveCyclicalCaseInput(
  periods: readonly RecastPeriod[],
  config: EngineConfig,
  issuerId: string,
  asOf: string,
  sharesOutstandingCr: number | null,
): CyclicalDerivationResult {
  const latest = latestPeriod(periods);
  if (!latest) {
    return {
      input: null,
      provenance: {},
      missingEvidence: ["cyclical.volume-price-cost", "cyclical.sustaining-capex", "cyclical.net-debt"],
      reason: "No recast periods available.",
    };
  }

  const provenance: Record<string, DerivationProvenance> = {};
  const missing: string[] = [];

  // Shares outstanding
  if (sharesOutstandingCr == null || sharesOutstandingCr <= 0) {
    return {
      input: null,
      provenance: {},
      missingEvidence: ["common.share-basis"],
      reason: "Share basis unavailable; cannot produce per-share output.",
    };
  }

  // Mid-cycle volume (revenue index)
  const volume = deriveNormalizedVolume(periods);
  provenance["normalizedVolume"] = volume.prov;
  if (volume.value == null) missing.push("cyclical.volume-price-cost");

  // Cash cost share (COGS share of revenue)
  const cashCostShare = deriveCashCostShare(periods);
  provenance["cashCostPerUnit"] = cashCostShare.prov;
  if (cashCostShare.value == null) missing.push("cyclical.volume-price-cost");

  // Fixed costs
  const fixedCosts = deriveAnnualFixedCostsCr(periods, volume.value, cashCostShare.value);
  provenance["annualFixedCostsCr"] = fixedCosts.prov;
  if (fixedCosts.value == null) missing.push("cyclical.volume-price-cost");

  // Sustaining capex
  const sustainingCapex = deriveSustainingCapexCr(periods);
  provenance["sustainingCapexCr"] = sustainingCapex.prov;
  if (sustainingCapex.value == null) missing.push("cyclical.sustaining-capex");

  // Cash tax rate
  const cashTaxRate = deriveCashTaxRate(periods, config);
  provenance["cashTaxRate"] = cashTaxRate.prov;

  // Cost of operations
  const costOfOperations = deriveCostOfOperations(config);
  provenance["costOfOperations"] = costOfOperations.prov;

  // Terminal growth
  const terminalGrowth = deriveTerminalGrowth(config);
  provenance["terminalGrowth"] = terminalGrowth.prov;

  // Net debt
  const netDebt = deriveNetDebtCr(periods);
  provenance["netDebtCr"] = netDebt.prov;

  // Dedupe missing
  const missingUnique = [...new Set(missing)];

  // Evidence map
  const evidence: Record<string, readonly string[]> = {};
  if (!missingUnique.includes("cyclical.volume-price-cost")) {
    evidence["cyclical.volume-price-cost"] = ["seade:derived:mid-cycle-volume-price-cost"];
  }
  if (!missingUnique.includes("cyclical.sustaining-capex")) {
    evidence["cyclical.sustaining-capex"] = ["seade:derived:sustaining-capex"];
  }
  evidence["cyclical.net-debt"] = ["seade:derived:net-debt"];

  if (missingUnique.length > 0) {
    return {
      input: null,
      provenance,
      missingEvidence: missingUnique,
      reason: `Insufficient evidence for ${missingUnique.length} required input(s): ${missingUnique.join(", ")}.`,
    };
  }

  // price = 1 (index); volume carries the revenue scale; cashCost = COGS share
  const input: CyclicalMidCycleCaseInput = {
    caseType: "cyclical-mid-cycle",
    issuerId,
    asOf,
    companyType: "cyclical",
    sharesOutstandingCr,
    evidence,
    normalizedVolume: volume.value!,
    midCyclePricePerUnit: 1,
    cashCostPerUnit: cashCostShare.value!,
    annualFixedCostsCr: fixedCosts.value!,
    sustainingCapexCr: sustainingCapex.value!,
    cashTaxRate: cashTaxRate.value,
    costOfOperations: costOfOperations.value,
    terminalGrowth: terminalGrowth.value,
    netDebtCr: netDebt.value,
  };

  return {
    input,
    provenance,
    missingEvidence: [],
    reason: "",
  };
}
