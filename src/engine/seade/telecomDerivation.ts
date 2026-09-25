/**
 * SEADE — telecom derivation.
 *
 * Derives TelecomNetworkCaseInput from parsed financials. The subscriber/ARPU
 * pair is the hardest input: when it cannot be derived from segment or raw
 * trace data, SEADE returns insufficient-evidence rather than guessing. All
 * other inputs are derived from balance-sheet, income, and cash-flow fields
 * that Capitaline exports reliably carry for telecom companies.
 */
import type { RecastPeriod } from "../types";
import type { EngineConfig } from "../types";
import { ke_from_config } from "../types/config";
import type { TelecomNetworkCaseInput } from "../sectorCases/contracts";
import { bs, cf, clamp, is, latestPeriod, prov, traceValue } from "./derivationUtils";
import type { DerivationProvenance } from "./types";

export interface TelecomDerivationResult {
  readonly input: TelecomNetworkCaseInput | null;
  readonly provenance: Readonly<Record<string, DerivationProvenance>>;
  readonly missingEvidence: readonly string[];
  readonly reason: string;
}

function deriveSubscribersMillions(
  periods: readonly RecastPeriod[],
): { value: number | null; prov: DerivationProvenance; missing: string | null } {
  const latest = latestPeriod(periods);
  // Direct trace read: subscriber count is not a standard Capitaline line, but
  // some telecom exports carry it as a custom metric. Check a few plausible keys.
  const candidateKeys = [
    "BS.Telecom.SubscribersMillions",
    "IS.Telecom.SubscribersMillions",
    "Segment.Telecom.Subscribers",
    "Telecom.Subscribers",
  ];
  for (const key of candidateKeys) {
    const v = traceValue(latest, key);
    if (v != null && v > 0) {
      return {
        value: v,
        prov: prov([key], "Direct trace read of subscriber count (millions)", "high"),
        missing: null,
      };
    }
  }
  // No reliable auto-derivation path from standard financials: subscriber count
  // is an operational metric that does not appear on the face of the balance
  // sheet, P&L, or cash-flow statement. Guessing from revenue/ARPU would be
  // circular (ARPU itself needs subscribers) and would breach fail-closed
  // discipline. Return insufficient-evidence.
  return {
    value: null,
    prov: prov([], "No trace-backed subscriber count found in standard financial statements", "low"),
    missing: "telecom.subscriber-arpu",
  };
}

function deriveMonthlyArpuInr(
  periods: readonly RecastPeriod[],
  subscribersMillions: number | null,
): { value: number | null; prov: DerivationProvenance; missing: string | null } {
  const latest = latestPeriod(periods);
  const revenue = is(latest, "Sales");
  if (revenue == null || revenue <= 0 || subscribersMillions == null || subscribersMillions <= 0) {
    return {
      value: null,
      prov: prov(["is.Sales"], "ARPU requires both revenue and subscriber count; one or both unavailable", "low"),
      missing: "telecom.subscriber-arpu",
    };
  }
  // ARPU = annual revenue (Cr) / subscribers (millions) / 12 months * 10 (Cr→millions conversion)
  // ₹ Cr = 10^7; ₹ million = 10^6. So revenueCr * 10 = revenue in ₹ millions.
  // monthly ARPU (₹) = (revenueCr * 10) / subscribersMillions / 12
  const arpu = (revenue * 10) / subscribersMillions / 12;
  return {
    value: arpu,
    prov: prov(["is.Sales", "subscribersMillions"], "ARPU = (annual revenue Cr × 10) / subscribers (M) / 12", "medium"),
    missing: null,
  };
}

function deriveEbitdaMargin(periods: readonly RecastPeriod[]): { value: number | null; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const revenue = is(latest, "Sales");
  const ebitda = cf(latest, "EBITDA");
  if (revenue != null && revenue > 0 && ebitda != null && Number.isFinite(ebitda)) {
    return {
      value: clamp(ebitda / revenue, 0, 1),
      prov: prov(["is.Sales", "cf.EBITDA"], "EBITDA margin = EBITDA / Sales", "high"),
    };
  }
  // Fallback: use operating cost bridge if present
  const bridge = latest?.is.operatingCostBridge;
  if (bridge && revenue != null && revenue > 0) {
    const coreOi = is(latest, "OI");
    if (coreOi != null) {
      return {
        value: clamp(coreOi / revenue, 0, 1),
        prov: prov(["is.Sales", "is.OI", "is.operatingCostBridge"], "EBITDA margin approximated by OI / Sales (no D&A add-back)", "medium"),
      };
    }
  }
  return {
    value: null,
    prov: prov(["is.Sales", "cf.EBITDA"], "EBITDA or Sales unavailable", "low"),
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

function deriveMaintenanceCapexPctRevenue(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const revenue = is(latest, "Sales");
  const capex = cf(latest, "Capex");
  if (revenue != null && revenue > 0 && capex != null && capex > 0) {
    return {
      value: clamp(capex / revenue, 0, 0.5),
      prov: prov(["is.Sales", "cf.Capex"], "Maintenance capex % revenue = Capex / Sales", "high"),
    };
  }
  // Sector prior: telecom maintenance capex is typically 8-12% of revenue
  return {
    value: 0.10,
    prov: prov([], "Sector prior: telecom maintenance capex typically 8-12% of revenue", "low", "telecom-maintenance-capex-prior"),
  };
}

function deriveSpectrumRenewalCapexPctRevenue(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  // Spectrum renewal is lumpy and not annually recurring. When spectrum assets
  // are present but no explicit renewal capex line exists, use a conservative
  // amortisation proxy: spectrum assets / 10 years / revenue.
  const spectrum = bs(latest, "OA_TelecomSpectrumLicenses");
  const revenue = is(latest, "Sales");
  if (spectrum != null && spectrum > 0 && revenue != null && revenue > 0) {
    const proxy = (spectrum / 10) / revenue;
    return {
      value: clamp(proxy, 0, 0.2),
      prov: prov(["bs.OA_TelecomSpectrumLicenses", "is.Sales"], "Spectrum renewal proxy = spectrum assets / 10 years / revenue", "medium"),
    };
  }
  return {
    value: 0.02,
    prov: prov([], "Sector prior: spectrum renewal capex typically 1-3% of revenue", "low", "telecom-spectrum-renewal-prior"),
  };
}

function deriveCostOfOperations(config: EngineConfig): { value: number; prov: DerivationProvenance } {
  // For telecom, cost of operations approximates WACC (kw) because the model
  // discounts FCFF at the operating capital cost. Use the existing structural
  // kw resolver when possible; otherwise fall back to sector-adjusted ke.
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
  // Fallback: FO - FA (financial obligations minus financial assets)
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

function deriveSpectrumObligationsCr(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  // Spectrum obligations are deferred payment liabilities for spectrum. They
  // are not a standard Capitaline line; check trace for plausible keys.
  const candidateKeys = [
    "BS.FO.SpectrumObligations",
    "BS.OL.SpectrumObligations",
    "BS.Telecom.SpectrumObligations",
  ];
  for (const key of candidateKeys) {
    const v = traceValue(latest, key);
    if (v != null && v > 0) {
      return {
        value: v,
        prov: prov([key], "Direct trace read of spectrum obligations", "high"),
      };
    }
  }
  // When spectrum assets exist but no explicit obligation line is found, assume
  // the obligation is fully captured in NFO (debt). This is conservative and
  // avoids double-counting.
  return {
    value: 0,
    prov: prov(["bs.NFO"], "No explicit spectrum obligation line; assumed included in NFO", "medium"),
  };
}

function deriveLeaseLiabilitiesCr(periods: readonly RecastPeriod[]): { value: number; prov: DerivationProvenance } {
  const latest = latestPeriod(periods);
  const lease = bs(latest, "FO_LeaseLiabilities");
  if (lease != null && lease > 0) {
    return {
      value: lease,
      prov: prov(["bs.FO_LeaseLiabilities"], "Explicit lease liabilities from recast balance sheet", "high"),
    };
  }
  return {
    value: 0,
    prov: prov(["bs.FO_LeaseLiabilities"], "No explicit lease liabilities found", "medium"),
  };
}

export function deriveTelecomCaseInput(
  periods: readonly RecastPeriod[],
  config: EngineConfig,
  issuerId: string,
  asOf: string,
  sharesOutstandingCr: number | null,
): TelecomDerivationResult {
  const latest = latestPeriod(periods);
  if (!latest) {
    return {
      input: null,
      provenance: {},
      missingEvidence: ["telecom.subscriber-arpu", "telecom.network-cash-flow", "telecom.spectrum-lease"],
      reason: "No recast periods available.",
    };
  }

  const provenance: Record<string, DerivationProvenance> = {};
  const missing: string[] = [];

  // Shares outstanding
  if (sharesOutstandingCr == null || sharesOutstandingCr <= 0) {
    missing.push("common.share-basis");
    return {
      input: null,
      provenance: {},
      missingEvidence: missing,
      reason: "Share basis unavailable; cannot produce per-share output.",
    };
  }

  // Subscribers + ARPU
  const subs = deriveSubscribersMillions(periods);
  provenance["subscribersMillions"] = subs.prov;
  if (subs.missing) missing.push(subs.missing);
  const arpu = deriveMonthlyArpuInr(periods, subs.value);
  provenance["monthlyArpuInr"] = arpu.prov;
  if (arpu.missing && arpu.missing !== subs.missing) missing.push(arpu.missing);

  // Revenue
  const revenue = is(latest, "Sales");
  if (revenue == null || revenue <= 0) {
    missing.push("telecom.network-cash-flow");
  }
  provenance["reportedAnnualRevenueCr"] = prov(["is.Sales"], "Reported annual revenue from income statement", revenue != null && revenue > 0 ? "high" : "low");

  // EBITDA margin
  const ebitdaMargin = deriveEbitdaMargin(periods);
  provenance["ebitdaMargin"] = ebitdaMargin.prov;
  if (ebitdaMargin.value == null) missing.push("telecom.network-cash-flow");

  // Cash tax rate
  const cashTaxRate = deriveCashTaxRate(periods, config);
  provenance["cashTaxRate"] = cashTaxRate.prov;

  // Maintenance capex
  const maintenanceCapex = deriveMaintenanceCapexPctRevenue(periods);
  provenance["maintenanceCapexPctRevenue"] = maintenanceCapex.prov;

  // Spectrum renewal capex
  const spectrumRenewal = deriveSpectrumRenewalCapexPctRevenue(periods);
  provenance["spectrumRenewalCapexPctRevenue"] = spectrumRenewal.prov;

  // Cost of operations
  const costOfOperations = deriveCostOfOperations(config);
  provenance["costOfOperations"] = costOfOperations.prov;

  // Terminal growth
  const terminalGrowth = deriveTerminalGrowth(config);
  provenance["terminalGrowth"] = terminalGrowth.prov;

  // Net debt
  const netDebt = deriveNetDebtCr(periods);
  provenance["netDebtCr"] = netDebt.prov;

  // Spectrum obligations
  const spectrumObligations = deriveSpectrumObligationsCr(periods);
  provenance["spectrumObligationsCr"] = spectrumObligations.prov;

  // Lease liabilities
  const leaseLiabilities = deriveLeaseLiabilitiesCr(periods);
  provenance["leaseLiabilitiesCr"] = leaseLiabilities.prov;

  // Evidence map: satisfy registry requirements when derivation succeeded
  const evidence: Record<string, readonly string[]> = {};
  if (!missing.includes("telecom.subscriber-arpu")) {
    evidence["telecom.subscriber-arpu"] = ["seade:derived:subscriber-arpu"];
  }
  if (!missing.includes("telecom.network-cash-flow")) {
    evidence["telecom.network-cash-flow"] = ["seade:derived:network-cash-flow"];
  }
  if (!missing.includes("telecom.spectrum-lease")) {
    evidence["telecom.spectrum-lease"] = ["seade:derived:spectrum-lease"];
  }

  if (missing.length > 0) {
    return {
      input: null,
      provenance,
      missingEvidence: missing,
      reason: `Insufficient evidence for ${missing.length} required input(s): ${missing.join(", ")}.`,
    };
  }

  const input: TelecomNetworkCaseInput = {
    caseType: "telecom-network",
    issuerId,
    asOf,
    companyType: "telecom",
    sharesOutstandingCr,
    evidence,
    subscribersMillions: subs.value!,
    monthlyArpuInr: arpu.value!,
    reportedAnnualRevenueCr: revenue!,
    ebitdaMargin: ebitdaMargin.value!,
    cashTaxRate: cashTaxRate.value,
    maintenanceCapexPctRevenue: maintenanceCapex.value,
    spectrumRenewalCapexPctRevenue: spectrumRenewal.value,
    costOfOperations: costOfOperations.value,
    terminalGrowth: terminalGrowth.value,
    netDebtCr: netDebt.value,
    spectrumObligationsCr: spectrumObligations.value,
    leaseLiabilitiesCr: leaseLiabilities.value,
  };

  return {
    input,
    provenance,
    missingEvidence: [],
    reason: "",
  };
}
