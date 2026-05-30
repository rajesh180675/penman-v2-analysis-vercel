import { RecastPeriod } from "./types";

function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[middle - 1]! + filtered[middle]!) / 2 : filtered[middle]!;
}

export interface CyclicalNormalizationOutput {
  normalizedSalesGrowth: number | null;
  normalizedMargin: number | null;
  normalizedAto: number | null;
  normalizedRoic: number | null;
  volatilityScore: number;
  cyclical: boolean;
  label: string;
}

export function buildCyclicalNormalization(data: RecastPeriod[]) {
  const recent = data.slice(-5);
  const margins = recent.map((period) => period.ratios?.CoreSalesPM ?? period.ratios?.PM ?? null);
  const growth = recent.map((period) => period.ratios?.Sales_growth ?? null);
  const atos = recent.map((period) => period.ratios?.ATO ?? null);
  const roics = recent.map((period) => period.ratios?.ROCE ?? period.ratios?.RNOA ?? null);
  const marginSpread = Math.max(...margins.filter((v): v is number => v != null), 0) - Math.min(...margins.filter((v): v is number => v != null), 0);
  const growthSpread = Math.max(...growth.filter((v): v is number => v != null), 0) - Math.min(...growth.filter((v): v is number => v != null), 0);
  const volatilityScore = Math.min(100, (marginSpread * 180) + (growthSpread * 110));
  const cyclical = volatilityScore >= 18;

  return {
    normalizedSalesGrowth: median(growth),
    normalizedMargin: median(margins),
    normalizedAto: median(atos),
    normalizedRoic: median(roics),
    volatilityScore,
    cyclical,
    label: cyclical ? "Cyclical normalization recommended" : "Current economics close to mid-cycle",
  } satisfies CyclicalNormalizationOutput;
}
