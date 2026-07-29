import { RecastPeriod } from "./types";

/** Peer-median EV/EBITDA context for cross-check valuation. */
export interface EvEbitdaPeerContext {
  company: string;
  evEbitda: number | null;
}

export interface EvEbitdaCrossCheck {
  ebitdaT: number;
  /**
   * Null until a multiple exists to build it from — either the company's own
   * (market price present) or the peer median (at least one finite peer).
   *
   * Was `number`, which forced the `?? 0` this used to compute: with no peers
   * and no market price, both multiples are null and the field resolved to a
   * confident ₹0 enterprise value. Every sibling below already propagates null
   * in that case, so the non-nullable type was the outlier, not the arithmetic.
   */
  enterpriseValue: number | null;
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
  /**
   * How many peers contributed a finite positive multiple — i.e. the size of
   * the set the median and quartiles above were computed from, after the
   * null/non-finite/non-positive entries are dropped.
   *
   * New. `SotpSection` shipped a tile labelled "Peer count" that rendered
   * `label`, a semicolon-joined summary beginning `EBITDA_T: <n>`, because no
   * count existed to render. A reviewer read an EBITDA figure as a peer count.
   */
  peerCount: number;
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

  // Enterprise value at whichever multiple is available: the company's own once
  // market price has been applied, else the peer median.
  //
  // Null when neither exists. This read `?? 0`, and `config.ev_ebitda_peers` has
  // no writer anywhere in the app — no UI control, absent from DEFAULT_CONFIG,
  // absent from every company data file and market pack — so `peerMultiples` is
  // always empty in production and this field always resolved to ₹0. Zero is a
  // valuation a reviewer cannot tell apart from a real one; the six fields below
  // all return null in the same state, so the `number` type was the outlier.
  const multiple = evEbitdaCompany ?? evEbitdaMedian;
  const enterpriseValue = multiple != null ? ebitda * multiple : null;

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
    // Post-filter, so it counts the peers that actually reached the percentiles
    // rather than the peers a caller supplied. A peer with a null or negative
    // multiple contributes nothing to the median and must not be counted as if
    // it had.
    peerCount: peerMultiples.length,
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
