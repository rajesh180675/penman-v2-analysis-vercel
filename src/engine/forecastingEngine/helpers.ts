/**
 * Forecasting Engine — shared helpers
 * §4.3 Pro Forma, Fade Analysis, Scenario Analysis
 * Nissim & Penman (2001) §2.6, Table 3
 */
import { FADE_PARAMS, NP_BENCHMARKS } from "../types";

/* §4.3.1 Fade-adjusted single ratio forecast */
export function fadeRatio(
  historicalValue: number,
  ratioKey: keyof typeof FADE_PARAMS,
  horizonT: number,
  industryMedian?: number | undefined,
): number[] {
  const alpha = FADE_PARAMS[ratioKey] ?? 0.85;
  const target = industryMedian ?? (NP_BENCHMARKS[ratioKey]?.median ?? historicalValue);
  const result: number[] = [];
  let prev = historicalValue;
  for (let t = 1; t <= horizonT; t++) {
    const next = alpha * prev + (1 - alpha) * target;
    result.push(next);
    prev = next;
  }
  return result;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[middle - 1]! + filtered[middle]!) / 2 : filtered[middle]!;
}

export function latestFinite(values: Array<number | null | undefined>) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

export function spreadValues(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!filtered.length) return null;
  return Math.max(...filtered) - Math.min(...filtered);
}

export function makeFadeArray(base: number, alpha: number, target: number, horizon: number) {
  const values: number[] = [];
  let previous = base;
  for (let i = 0; i < horizon; i += 1) {
    const next = alpha * previous + (1 - alpha) * target;
    values.push(next);
    previous = next;
  }
  return values;
}
