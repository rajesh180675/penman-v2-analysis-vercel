import { RecastPeriod } from "./types";

/** Peer-median EV/EBITDA context for cross-check valuation. */
export interface EvEbitdaPeerContext {
  company: string;
  evEbitda: number | null;
}

export interface EvEbitdaCrossCheck {
  ebitdaT: number;
  enterpriseValue: number;
  evEbitdaCompany: number | null;
  evEbitdaMedian: number | null;
  evEbitdaP25: number | null;
  evEbitdaP75: number | null;
  evFromMedian: number | null;
  evFromP25: number | null;
  evFromP75: number | null;
  /** Implied equity value from median multiple minus net financial obligations. */
  equityFromMedian: number | null;
  /** Implied equity value from 25th percentile (bear case). */
  equityFromP25: number | null;
  /** Implied equity value from 75th percentile (bull case). */
  equityFromP75: number | null;
  label: string;
}

/** Compute EV/EBITDA cross-check for a single company, optionally using peer data. */
export function computeEvEbitdaCrossCheck(
  latest: RecastPeriod,
  peers?: EvEbitdaPeerContext[] | undefined,
): EvEbitdaCrossCheck {
  const ebitda = latest.cf.EBITDA ?? 0;
  const nfo = latest.bs.NFO;

  // Company's own EV/EBITDA (requires market cap / enterprise value from context)
  const evEbitdaCompany = null; // Will be set when market price is available

  // Peer statistics
  const peerMultiples = (peers ?? [])
    .map((p) => p.evEbitda)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const evEbitdaMedian = computePercentile(peerMultiples, 50);
  const evEbitdaP25 = computePercentile(peerMultiples, 25);
  const evEbitdaP75 = computePercentile(peerMultiples, 75);

  const evFromMedian = evEbitdaMedian != null ? ebitda * evEbitdaMedian : null;
  const evFromP25 = evEbitdaP25 != null ? ebitda * evEbitdaP25 : null;
  const evFromP75 = evEbitdaP75 != null ? ebitda * evEbitdaP75 : null;

  // Enterprise value of the company at median multiple
  const enterpriseValue = ebitda * (evEbitdaCompany ?? evEbitdaMedian ?? 0);

  // Implied equity value from median multiple minus nfo
  const equityFromMedian = evFromMedian != null ? evFromMedian - nfo : null;
  const equityFromP25 = evFromP25 != null ? evFromP25 - nfo : null;
  const equityFromP75 = evFromP75 != null ? evFromP75 - nfo : null;

  const label = buildLabel({
    ebitda,
    evEbitdaCompany,
    evEbitdaMedian,
    evEbitdaP25,
    evEbitdaP75,
    equityFromMedian,
  });

  return {
    ebitdaT: ebitda,
    enterpriseValue,
    evEbitdaCompany,
    evEbitdaMedian,
    evEbitdaP25,
    evEbitdaP75,
    evFromMedian,
    evFromP25,
    evFromP75,
    equityFromMedian,
    equityFromP25,
    equityFromP75,
    label,
  };
}

/** Update cross-check with actual market-derived EV/EBITDA when price available. */
export function updateEvEbitdaWithMarketPrice(
  crossCheck: EvEbitdaCrossCheck,
  marketCap: number,
  nfo: number,
): EvEbitdaCrossCheck {
  const enterpriseValue = marketCap + nfo;
  const evEbitdaCompany = crossCheck.ebitdaT > 0 ? enterpriseValue / crossCheck.ebitdaT : null;

  return {
    ...crossCheck,
    enterpriseValue,
    evEbitdaCompany,
    label: buildLabel({
      ebitda: crossCheck.ebitdaT,
      evEbitdaCompany,
      evEbitdaMedian: crossCheck.evEbitdaMedian,
      evEbitdaP25: crossCheck.evEbitdaP25,
      evEbitdaP75: crossCheck.evEbitdaP75,
      equityFromMedian: crossCheck.equityFromMedian,
    }),
  };
}

function computePercentile(sorted: number[], pct: number): number | null {
  if (sorted.length === 0) return null;
  const index = (pct / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function buildLabel(ctx: {
  ebitda: number;
  evEbitdaCompany: number | null;
  evEbitdaMedian: number | null;
  evEbitdaP25: number | null;
  evEbitdaP75: number | null;
  equityFromMedian: number | null;
}) {
  const parts: string[] = [`EBITDA_T: ${ctx.ebitda.toFixed(0)}`];

  if (ctx.evEbitdaCompany != null) {
    parts.push(`Company EV/EBITDA: ${ctx.evEbitdaCompany.toFixed(1)}x`);
  }
  if (ctx.evEbitdaMedian != null) {
    parts.push(`Peer median: ${ctx.evEbitdaMedian.toFixed(1)}x`);
  }
  if (ctx.evEbitdaP25 != null && ctx.evEbitdaP75 != null) {
    parts.push(`Peer range: P25=${ctx.evEbitdaP25.toFixed(1)}x – P75=${ctx.evEbitdaP75.toFixed(1)}x`);
  }
  if (ctx.equityFromMedian != null) {
    parts.push(`Implied equity (median): ${ctx.equityFromMedian.toFixed(0)}`);
  }

  return parts.join("; ");
}
