import { RawPeriodData } from "./types";
import { SourceParserDiagnostics } from "./parserDiagnostics";

export interface ManualEntryPeriod {
  period_end: string;
  metrics: Record<string, number | null>;
}

export interface ManualEntryPayload {
  company_id: string;
  periods: ManualEntryPeriod[];
}

export interface ManualValidation {
  valid: boolean;
  warnings: string[];
}

export function manualPayloadToRaw(payload: ManualEntryPayload): RawPeriodData[] {
  return payload.periods.map((p) => ({
    company_id: payload.company_id,
    period_end: p.period_end,
    raw_metric_values: { ...p.metrics },
  }));
}

export function validateManualPayload(payload: ManualEntryPayload): ManualValidation {
  const warnings: string[] = [];
  for (const p of payload.periods) {
    const ta = Number(p.metrics["Total Assets"] ?? 0);
    const te = Number(p.metrics["Total Equity"] ?? 0);
    const tl = ta - te;
    if (!Number.isFinite(ta) || ta <= 0) warnings.push(`${p.period_end}: Total Assets missing/invalid`);
    if (!Number.isFinite(te)) warnings.push(`${p.period_end}: Total Equity invalid`);
    if (Math.abs(tl) > ta * 2) warnings.push(`${p.period_end}: Balance sheet appears inconsistent`);
  }
  return { valid: warnings.length === 0, warnings };
}

export function diagnoseManualRawPeriods(rawData: RawPeriodData[]): SourceParserDiagnostics {
  const uniqueCompanies = new Set(rawData.map((period) => period.company_id).filter(Boolean));
  const uniquePeriods = new Set<string>();
  let duplicatePeriods = 0;
  let missingBalanceSheetCore = 0;
  let missingOperatingCore = 0;

  for (const period of rawData) {
    if (uniquePeriods.has(period.period_end)) duplicatePeriods += 1;
    uniquePeriods.add(period.period_end);
    const metrics = period.raw_metric_values ?? {};
    const totalAssets = Number(metrics["Total Assets__BalanceSheet"] ?? metrics["Total Assets"] ?? Number.NaN);
    const totalEquity = Number(
      metrics["Total Equity__BalanceSheet"]
      ?? metrics["Total Equity"]
      ?? metrics["Total Stockholders' Equity__BalanceSheet"]
      ?? Number.NaN
    );
    const sales = Number(metrics["Revenue From Operations(Net)__ProfitLoss"] ?? metrics["Revenue From Operations(Net)"] ?? Number.NaN);
    const cfo = Number(metrics["Net Cash from Operating Activities__CashFlow"] ?? metrics["Net Cash from Operating Activities"] ?? Number.NaN);
    if (!Number.isFinite(totalAssets) || totalAssets <= 0 || !Number.isFinite(totalEquity)) {
      missingBalanceSheetCore += 1;
    }
    if (!Number.isFinite(sales) || sales <= 0 || !Number.isFinite(cfo)) {
      missingOperatingCore += 1;
    }
  }

  const validation = validateManualPayload({
    company_id: rawData[0]?.company_id ?? "MANUAL",
    periods: rawData.map((period) => ({
      period_end: period.period_end,
      metrics: period.raw_metric_values,
    })),
  });

  return {
    sourceMode: "manual",
    warningCount: [
      duplicatePeriods > 0,
      missingBalanceSheetCore > 0,
      missingOperatingCore > 0,
      validation.warnings.length > 0,
    ].filter(Boolean).length,
    errorCount: rawData.length === 0 ? 1 : 0,
    checks: [
      {
        id: "manual-periods-present",
        label: "Manual periods present",
        passed: rawData.length > 0,
        detail: rawData.length > 0
          ? `Captured ${rawData.length} manual periods.`
          : "No manual periods were submitted.",
      },
      {
        id: "manual-company-consistency",
        label: "Company consistency",
        passed: uniqueCompanies.size <= 1,
        detail: uniqueCompanies.size <= 1
          ? "All manual periods use the same company id."
          : `Observed ${uniqueCompanies.size} company ids across one manual submission.`,
      },
      {
        id: "manual-duplicate-periods",
        label: "Duplicate periods",
        passed: duplicatePeriods === 0,
        detail: duplicatePeriods === 0
          ? "No duplicate manual period_end values were found."
          : `${duplicatePeriods} duplicate manual period_end values were found.`,
      },
      {
        id: "manual-balance-sheet-core",
        label: "Balance-sheet core fields",
        passed: missingBalanceSheetCore === 0,
        detail: missingBalanceSheetCore === 0
          ? "Every manual period includes usable Total Assets and Total Equity inputs."
          : `${missingBalanceSheetCore} manual periods are missing usable Total Assets or Total Equity inputs.`,
      },
      {
        id: "manual-operating-core",
        label: "Operating core fields",
        passed: missingOperatingCore === 0,
        detail: missingOperatingCore === 0
          ? "Every manual period includes usable Sales and CFO inputs."
          : `${missingOperatingCore} manual periods are missing usable Sales or CFO inputs.`,
      },
      {
        id: "manual-validation-warnings",
        label: "Manual validation warnings",
        passed: validation.warnings.length === 0,
        detail: validation.warnings.length === 0
          ? "Manual validation did not detect balance-sheet anomalies."
          : validation.warnings[0],
      },
    ],
  };
}
