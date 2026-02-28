import { RawPeriodData } from "./types";

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
