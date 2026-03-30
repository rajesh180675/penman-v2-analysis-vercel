import { RawPeriodData } from "./types";

export interface RawMetricMatch {
  key: string;
  value: number | null;
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function baseKey(compositeKey: string) {
  const idx = compositeKey.lastIndexOf("__");
  return idx >= 0 ? compositeKey.slice(0, idx) : compositeKey;
}

export function listRawBaseKeys(period: RawPeriodData | null | undefined) {
  if (!period) return [];
  return Object.keys(period.raw_metric_values ?? {}).map(baseKey);
}

export function findRawMetric(
  period: RawPeriodData | null | undefined,
  aliases: string[],
): RawMetricMatch | null {
  if (!period) return null;
  const normalizedAliases = aliases.map(normalizeLabel);
  for (const [compositeKey, rawValue] of Object.entries(period.raw_metric_values ?? {})) {
    if (rawValue == null || !Number.isFinite(rawValue)) continue;
    const label = normalizeLabel(baseKey(compositeKey));
    if (normalizedAliases.includes(label)) {
      return {
        key: baseKey(compositeKey),
        value: rawValue,
      };
    }
  }
  return null;
}

export function findAllRawMetrics(period: RawPeriodData | null | undefined, aliases: string[]) {
  if (!period) return [];
  const normalizedAliases = aliases.map(normalizeLabel);
  return Object.entries(period.raw_metric_values ?? {})
    .map(([compositeKey, rawValue]) => ({
      key: baseKey(compositeKey),
      value: rawValue,
      normalized: normalizeLabel(baseKey(compositeKey)),
    }))
    .filter((entry) => entry.value != null && Number.isFinite(entry.value) && normalizedAliases.includes(entry.normalized))
    .map(({ key, value }) => ({ key, value }));
}

export function periodMetricValue(period: RawPeriodData | null | undefined, aliases: string[]) {
  return findRawMetric(period, aliases)?.value ?? null;
}

export function seriesMetricValues(periods: RawPeriodData[], aliases: string[]) {
  return periods.map((period) => ({
    periodEnd: period.period_end,
    match: findRawMetric(period, aliases),
  }));
}
