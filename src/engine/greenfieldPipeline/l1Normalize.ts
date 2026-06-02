import type { CompanyType, EngineConfig, RawPeriodData, RecastPeriod } from "../types";
import { croreToInrNumber } from "./adapters";
import type { AccountingStandard, NormalizedFieldLineage, NormalizedPeriod } from "./types";

const DAY_MS = 86_400_000;
const IND_AS_116_DEFAULT_DATE = "2019-04-01";
const IND_AS_115_DEFAULT_DATE = "2018-04-01";
const IND_AS_109_DEFAULT_DATE = "2016-04-01";

type RawStandard = RawPeriodData["accounting_standard"];

const RAW_ALIASES = {
  revenue: ["Revenue From Operations(Net)", "Revenue From Operations", "Total Revenue", "Total Income"],
  cse: ["Total Equity", "Shareholders Funds", "Other Equity"],
  totalAssets: ["Total Assets"],
  leaseLiabilities: ["Lease Liabilities"],
  rightOfUseAssets: ["Right of Use Assets", "Right-of-Use Assets"],
  longBorrowings: ["Long Term Borrowings"],
  shortBorrowings: ["Short Term Borrowings"],
  otherFinancialLiabilitiesLong: ["Others Financial Liabilities - Long-term"],
  otherFinancialLiabilitiesShort: ["Others Financial Liabilities - Short-term"],
  cfo: ["Net Cash from Operating Activities"],
  capex: ["Purchased of Fixed Assets", "Payment for Acquisition of Property, Plant and Equipment"],
  dividendPaid: ["Dividend Paid"],
  equityIssued: ["Proceeds from Issue of Share Capital", "Equity Share Capital"],
  buybacks: ["Buy Back of Shares", "Share Buybacks"],
  netIncome: ["Profit After Tax", "Net Profit / Loss For The Year"],
  oci: ["Other Comprehensive Income That Will Not Be Reclassified to Profit Or Loss", "Other Comprehensive Income That Will Be Reclassified to Profit Or Loss", "Other Comprehensive Income no Specification"],
} as const;

function normalizeStandard(std: RawStandard): AccountingStandard {
  if (std === "ind-as") return "ind-as";
  if (std === "revised-sch-vi") return "revised-sch-vi";
  if (std === "standard") return "gaap";
  return "unknown";
}

function pickRaw(raw: RawPeriodData, aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    for (const [key, value] of Object.entries(raw.raw_metric_values)) {
      if (value == null || !Number.isFinite(value)) continue;
      const base = key.split("__")[0] ?? key;
      if (base.toLowerCase() === alias.toLowerCase() || key.toLowerCase() === alias.toLowerCase()) return value;
    }
  }
  return null;
}

function sumRaw(raw: RawPeriodData, aliases: readonly string[]): number | null {
  let total = 0;
  let seen = false;
  for (const alias of aliases) {
    const value = pickRaw(raw, [alias]);
    if (value != null) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

function daysBetween(start: string, end: string): number | null {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.round((endMs - startMs) / DAY_MS);
}

function nextDay(date: string): string | null {
  const value = new Date(date).getTime();
  if (!Number.isFinite(value)) return null;
  return new Date(value + DAY_MS).toISOString().slice(0, 10);
}

function periodOnOrAfter(periodEnd: string, adoptionDate: string): boolean {
  return periodEnd > adoptionDate;
}

function lineage(field: string, source: NormalizedFieldLineage["source"], sourceKey: string, confidence: NormalizedFieldLineage["confidence"] = "high"): NormalizedFieldLineage {
  return { field, source, sourceKey, originalUnit: source === "derived" ? "ratio" : "INR_CRORE", normalizedUnit: source === "derived" ? "ratio" : "INR_ABSOLUTE", confidence };
}

function fromRecastOrRaw(recastValueCr: number | null | undefined, raw: RawPeriodData, aliases: readonly string[], field: string, rows: NormalizedFieldLineage[]): number | null {
  if (recastValueCr != null && Number.isFinite(recastValueCr)) {
    rows.push(lineage(field, "recast", field));
    return croreToInrNumber(recastValueCr);
  }
  const rawValueCr = pickRaw(raw, aliases);
  if (rawValueCr != null) {
    rows.push(lineage(field, "raw", aliases[0] ?? field, "medium"));
    return croreToInrNumber(rawValueCr);
  }
  rows.push(lineage(field, "default", field, "low"));
  return null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function resolveIndustry(config: EngineConfig): NormalizedPeriod["industry"] {
  const configured: CompanyType | "auto" = config.company_type ?? "auto";
  if (configured !== "auto") {
    return { companyType: configured, inferredIndustry: configured, confidence: "explicit" };
  }
  return { companyType: "auto", inferredIndustry: null, confidence: "unknown" };
}

export function normalizePeriods(rawData: RawPeriodData[], config: EngineConfig, recastData: RecastPeriod[] = []): NormalizedPeriod[] {
  const recastByPeriod = new Map(recastData.map((period) => [period.period_end, period]));
  const sorted = [...rawData].sort((a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime());
  const output: NormalizedPeriod[] = [];

  for (let index = 0; index < sorted.length; index++) {
    const raw = sorted[index]!;
    const recast = recastByPeriod.get(raw.period_end);
    const previousRaw = index > 0 ? sorted[index - 1]! : null;
    const periodLengthDays = previousRaw ? daysBetween(previousRaw.period_end, raw.period_end) : null;
    const isPartialPeriod = periodLengthDays != null && (periodLengthDays < 330 || periodLengthDays > 400);
    const lineageRows: NormalizedFieldLineage[] = [];

    const revenue = fromRecastOrRaw(recast?.is.Sales, raw, RAW_ALIASES.revenue, "values.revenue", lineageRows);
    const cse = fromRecastOrRaw(recast?.bs.CSE, raw, RAW_ALIASES.cse, "values.cse", lineageRows);
    const totalAssets = fromRecastOrRaw(recast?.bs.TA, raw, RAW_ALIASES.totalAssets, "values.totalAssets", lineageRows);
    const cfo = fromRecastOrRaw(recast?.cf.CFO, raw, RAW_ALIASES.cfo, "values.cfo", lineageRows);
    const capex = fromRecastOrRaw(recast?.cf.Capex, raw, RAW_ALIASES.capex, "values.capex", lineageRows);
    let fcfCash = fromRecastOrRaw(recast?.cf.FCF_cash, raw, ["Free Cash Flow"], "values.fcfCash", lineageRows);
    if (fcfCash == null && cfo != null && capex != null) {
      fcfCash = cfo - capex;
      lineageRows.push(lineage("values.fcfCash", "derived", "CFO-Capex", "medium"));
    }
    const leaseLiabilities = fromRecastOrRaw(recast?.bs.FO_LeaseLiabilities, raw, RAW_ALIASES.leaseLiabilities, "values.leaseLiabilities", lineageRows);
    const rightOfUseAssets = fromRecastOrRaw(recast?.bs.OA_ROU, raw, RAW_ALIASES.rightOfUseAssets, "values.rightOfUseAssets", lineageRows);
    const rawFinancialDebtCr = sumRaw(raw, [
      ...RAW_ALIASES.longBorrowings,
      ...RAW_ALIASES.shortBorrowings,
      ...RAW_ALIASES.otherFinancialLiabilitiesLong,
      ...RAW_ALIASES.otherFinancialLiabilitiesShort,
    ]);
    const financialDebtExLease = fromRecastOrRaw(recast?.bs.FO_FinancialDebtExLease ?? rawFinancialDebtCr, raw, RAW_ALIASES.longBorrowings, "values.financialDebtExLease", lineageRows);
    const nfo = fromRecastOrRaw(recast?.bs.NFO, raw, ["Net Financial Obligation"], "values.nfo", lineageRows);
    const dividendsPaid = fromRecastOrRaw(recast?.cf.DividendPaid, raw, RAW_ALIASES.dividendPaid, "values.dividendsPaid", lineageRows);
    const equityIssued = fromRecastOrRaw(recast?.cf.EquityIssued, raw, RAW_ALIASES.equityIssued, "values.equityIssued", lineageRows);
    const buybacks = fromRecastOrRaw(recast?.cf.ShareBuybacks, raw, RAW_ALIASES.buybacks, "values.buybacks", lineageRows);
    const netIncome = fromRecastOrRaw(recast?.is.CNI, raw, RAW_ALIASES.netIncome, "values.netIncome", lineageRows);
    const oci = fromRecastOrRaw(recast?.is.OCI, raw, RAW_ALIASES.oci, "values.oci", lineageRows);
    const totalLiabilities = totalAssets != null && cse != null ? totalAssets - cse : null;
    const nfoExLease = nfo != null && leaseLiabilities != null ? nfo - leaseLiabilities : financialDebtExLease;
    const leaseNeutralEquity = cse != null && leaseLiabilities != null && rightOfUseAssets != null ? cse + leaseLiabilities - rightOfUseAssets : null;
    const previous = output.length > 0 ? output[output.length - 1]! : null;
    const dirtySurplusSeed = previous?.values.cse != null && cse != null && netIncome != null
      ? (cse - previous.values.cse) - (netIncome - (dividendsPaid ?? 0) + (equityIssued ?? 0) - (buybacks ?? 0))
      : null;

    const derivedRnoa = recast?.ratios?.RNOA ?? ratio(recast?.is.OI != null ? croreToInrNumber(recast.is.OI) : null, recast?.bs.NOA != null ? croreToInrNumber(recast.bs.NOA) : null);
    const derivedPm = recast?.ratios?.PM ?? ratio(recast?.is.OI != null ? croreToInrNumber(recast.is.OI) : null, revenue);
    const derivedAto = recast?.ratios?.ATO ?? ratio(revenue, recast?.bs.NOA != null ? croreToInrNumber(recast.bs.NOA) : null);
    const derivedFlev = recast?.ratios?.FLEV ?? ratio(nfo, cse);

    output.push({
      companyId: raw.company_id,
      periodEnd: raw.period_end,
      periodStart: previousRaw ? nextDay(previousRaw.period_end) : null,
      isPartialPeriod,
      periodLengthDays,
      accountingStandard: normalizeStandard(raw.accounting_standard),
      standardAdoptions: {
        indAS109: periodOnOrAfter(raw.period_end, IND_AS_109_DEFAULT_DATE),
        indAS115: periodOnOrAfter(raw.period_end, IND_AS_115_DEFAULT_DATE),
        indAS116: periodOnOrAfter(raw.period_end, IND_AS_116_DEFAULT_DATE),
        adoptionDateEvidence: {
          indAS109: raw.accounting_standard === "ind-as" ? IND_AS_109_DEFAULT_DATE : null,
          indAS115: raw.accounting_standard === "ind-as" ? IND_AS_115_DEFAULT_DATE : null,
          indAS116: raw.accounting_standard === "ind-as" ? IND_AS_116_DEFAULT_DATE : null,
        },
      },
      industry: resolveIndustry(config),
      values: {
        revenue,
        cse,
        totalAssets,
        totalLiabilities,
        cfo,
        capex,
        fcfCash,
        leaseLiabilities,
        rightOfUseAssets,
        financialDebtExLease,
        nfo,
        nfoExLease,
        leaseNeutralEquity,
        dividendsPaid,
        equityIssued,
        buybacks,
        netIncome,
        oci,
      },
      derived: {
        rnoa: derivedRnoa ?? null,
        flev: derivedFlev ?? null,
        pm: derivedPm ?? null,
        ato: derivedAto ?? null,
        dirtySurplusSeed,
      },
      lineage: lineageRows,
      asReportedRecast: recast,
    });
  }

  return output;
}
