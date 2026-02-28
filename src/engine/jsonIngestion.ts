import { RawPeriodData } from "./types";

export function parseRawPeriodsJson(input: string): RawPeriodData[] {
  const parsed = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new Error("JSON must be an array of RawPeriodData objects");
  return parsed.map((p) => {
    if (!p || typeof p !== "object") throw new Error("Invalid period object");
    if (!p.company_id || !p.period_end || !p.raw_metric_values) {
      throw new Error("Each period must include company_id, period_end, raw_metric_values");
    }
    return {
      company_id: String(p.company_id),
      period_end: String(p.period_end),
      raw_metric_values: { ...p.raw_metric_values } as Record<string, number | null>,
    };
  });
}
