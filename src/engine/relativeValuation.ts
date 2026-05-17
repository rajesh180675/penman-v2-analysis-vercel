/**
 * Relative Valuation Module
 *
 * Computes sector-appropriate trading multiples and historical bands.
 * Multiples are computed from the company's own history (no peer data needed)
 * and can be compared against user-supplied sector medians.
 *
 * Sector routing:
 *   Industrial / IT / Consumer  → PE, EV/EBITDA, PS, PB
 *   Bank / NBFC                 → PB, PE (ROE-based), Price/NII
 *   Holding company             → PB (NAV discount)
 *
 * All monetary values: ₹ Crore
 * Per-share values: ₹
 *
 * Design principle: multiples are computed from recast data where possible
 * (CoreOI, NOA, NFO, CSE) so they are consistent with the Penman-Nissim
 * reformulation rather than raw reported numbers.
 */

import { RecastPeriod } from "./types";
import { BankPeriodMetrics } from "./bankPipeline";

// ─── Input ───────────────────────────────────────────────────────────────────

export interface MarketInputs {
  /** Current market capitalisation in ₹ Crore */
  marketCap: number;
  /** Current share price in ₹ (used for per-share multiples) */
  sharePrice?: number | null;
  /** Net debt in ₹ Crore (for EV = marketCap + netDebt) */
  netDebt?: number | null;
}

export interface SectorMedians {
  /** Sector median PE */
  pe?: number | null;
  /** Sector median PB */
  pb?: number | null;
  /** Sector median EV/EBITDA */
  evEbitda?: number | null;
  /** Sector median PS */
  ps?: number | null;
  /** Sector median Price/NII (banks) */
  priceNii?: number | null;
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface MultipleBand {
  /** Metric name */
  metric: string;
  /** Current multiple (latest period) */
  current: number | null;
  /** Historical minimum */
  min: number | null;
  /** Historical median */
  median: number | null;
  /** Historical maximum */
  max: number | null;
  /** Number of periods with valid (positive) data */
  periodsWithData: number;
  /**
   * Periods that produced a finite multiple but were excluded from the band
   * because the value was non-positive (loss-year PE, negative EV/EBIT, etc).
   * Surfaced so reviewers see when cyclical drawdowns are being smoothed
   * out of the historical range (review W3). Optional for backward compat
   * with hand-constructed bands in tests.
   */
  nonPositivePeriodsExcluded?: number;
  /** Percentile of current multiple in historical range [0–100] */
  currentPercentile: number | null;
  /** Sector median for comparison (if provided) */
  sectorMedian: number | null;
  /** Premium/discount to sector median (positive = premium) */
  premiumToSector: number | null;
  /** Implied fair value from sector median × latest fundamental */
  impliedFairValue: number | null;
}

export interface RelativeValuationResult {
  /** Company type that drove metric selection */
  companyType: "industrial" | "bank" | "generic";
  /** Primary multiples (sector-appropriate) */
  primary: MultipleBand[];
  /** Secondary multiples (supplementary context) */
  secondary: MultipleBand[];
  /** Enterprise value used (marketCap + netDebt) */
  enterpriseValue: number | null;
  /** Composite implied fair value (median of implied values from primary multiples) */
  impliedFairValueComposite: number | null;
  /** Margin of safety vs composite implied value */
  marginOfSafety: number | null;
  /** Notes on data quality or missing inputs */
  notes: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeDiv(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const result = a / b;
  return Number.isFinite(result) ? result : null;
}

/**
 * Median ignoring null/non-finite/non-positive entries. Returns the count of
 * positive observations alongside the median so callers can surface an
 * "x periods omitted as non-positive" diagnostic (review W3).
 */
function medianOf(values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v) && v > 0);
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentileOf(value: number, values: number[]): number | null {
  const clean = values.filter(v => Number.isFinite(v) && v > 0);
  if (!clean.length) return null;
  const below = clean.filter(v => v <= value).length;
  return Math.round((below / clean.length) * 100);
}

/**
 * Build a multiple band from a series of period-multiples.
 *
 * Note on "implied" naming (review W4): the input `series` represents
 * multiples computed with CURRENT marketCap and HISTORICAL fundamentals,
 * not historical share prices. They are not historical price multiples —
 * they answer "what would today's market cap look like as a multiple of
 * each year's fundamentals?". The variable names use *ImpliedSeries to
 * make this explicit.
 *
 * Loss-year handling (review W3): non-positive observations are filtered
 * out (a negative PE is meaningless; a loss year produces a "PE" that
 * would distort the historical band). The filtered count is returned via
 * `nonPositivePeriodsExcluded` so the report can warn reviewers when
 * cyclical drawdowns have been silently smoothed away.
 */
function buildBand(
  metric: string,
  series: Array<number | null>,
  current: number | null,
  sectorMedian: number | null | undefined,
  latestFundamental: number | null,
): MultipleBand {
  const finite = series.filter((v): v is number => v != null && Number.isFinite(v));
  const valid  = finite.filter(v => v > 0);
  const nonPositivePeriodsExcluded = finite.length - valid.length;

  const min    = valid.length ? Math.min(...valid) : null;
  const max    = valid.length ? Math.max(...valid) : null;
  const med    = medianOf(valid);
  const pct    = current != null ? percentileOf(current, valid) : null;

  const sm = sectorMedian ?? null;
  const premiumToSector = (current != null && sm != null && sm > 0)
    ? (current - sm) / sm
    : null;

  // Implied fair value = sector median × latest fundamental
  // e.g. sector PE × latest EPS → implied market cap
  const impliedFairValue = (sm != null && latestFundamental != null && latestFundamental > 0)
    ? sm * latestFundamental
    : null;

  return {
    metric,
    current,
    min,
    median: med,
    max,
    periodsWithData: valid.length,
    nonPositivePeriodsExcluded,
    currentPercentile: pct,
    sectorMedian: sm,
    premiumToSector,
    impliedFairValue,
  };
}

// ─── Industrial Multiples ────────────────────────────────────────────────────

/**
 * Compute multiples for industrial / IT / consumer companies.
 * Uses recast data (CoreOI, NOA, CSE, Sales) for consistency.
 */
export function computeIndustrialMultiples(
  periods: RecastPeriod[],
  market: MarketInputs,
  sectorMedians?: SectorMedians,
): RelativeValuationResult {
  const notes: string[] = [];
  const sorted = [...periods].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  const latest = sorted[sorted.length - 1];
  const latestPAT   = latest.is?.PAT;
  const latestCSE   = latest.bs?.CSE;
  const latestSales = latest.is?.Sales;
  const latestNFO   = latest.bs?.NFO;

  // EV = market cap + net debt (NFO proxy if not provided)
  const netDebt = market.netDebt ?? latestNFO ?? null;
  const ev = netDebt != null ? market.marketCap + netDebt : null;

  // EBITDA proxy = CoreOI + Depreciation (from recast)
  // We use CoreOI as EBIT proxy; D&A not always available in recast
  // so EV/EBITDA uses CoreOI as a conservative EBIT proxy
  const latestCoreOI = latest.cu?.CoreOI;

  if (ev == null) notes.push("Net debt not provided — EV/EBITDA uses market cap as EV proxy");
  const evProxy = ev ?? market.marketCap;

  // ── Build time series of "implied" multiples ────────────────────────────
  // Naming note (review W4): these are NOT historical multiples. They are
  // CURRENT marketCap / HISTORICAL fundamentals — i.e. "where would today's
  // valuation rank against each past year's earnings/book/sales?". Treat as
  // a fundamentals-relative band, not a price-relative band.
  const peImpliedSeries:       Array<number | null> = [];
  const pbImpliedSeries:       Array<number | null> = [];
  const evEbitImpliedSeries:   Array<number | null> = [];
  const psImpliedSeries:       Array<number | null> = [];

  for (const p of sorted) {
    const pat    = p.is?.PAT;
    const cse    = p.bs?.CSE;
    const sales  = p.is?.Sales;
    const coreOI = p.cu?.CoreOI;
    const nfo    = p.bs?.NFO;
    const evP    = netDebt != null ? market.marketCap + (nfo ?? netDebt) : market.marketCap;

    // Implied PE = current marketCap / period PAT
    peImpliedSeries.push(safeDiv(market.marketCap, pat));
    // Implied PB = current marketCap / period CSE
    pbImpliedSeries.push(safeDiv(market.marketCap, cse));
    // Implied EV/CoreOI (EBIT proxy)
    evEbitImpliedSeries.push(safeDiv(evP, coreOI));
    // Implied PS = current marketCap / period Sales
    psImpliedSeries.push(safeDiv(market.marketCap, sales));
  }

  const currentPE      = safeDiv(market.marketCap, latestPAT);
  const currentPB      = safeDiv(market.marketCap, latestCSE);
  const currentEvEbit  = safeDiv(evProxy, latestCoreOI);
  const currentPS      = safeDiv(market.marketCap, latestSales);

  // Implied fair values use latest fundamentals
  const primary: MultipleBand[] = [
    buildBand("PE",         peImpliedSeries,     currentPE,     sectorMedians?.pe,       latestPAT),
    buildBand("EV/CoreOI",  evEbitImpliedSeries, currentEvEbit, sectorMedians?.evEbitda, latestCoreOI),
    buildBand("PB",         pbImpliedSeries,     currentPB,     sectorMedians?.pb,       latestCSE),
  ];

  const secondary: MultipleBand[] = [
    buildBand("PS", psImpliedSeries, currentPS, sectorMedians?.ps, latestSales),
  ];

  // Composite implied fair value = median of non-null implied values
  const impliedValues = primary
    .map(b => b.impliedFairValue)
    .filter((v): v is number => v != null && v > 0);
  const impliedFairValueComposite = medianOf(impliedValues);

  const marginOfSafety = impliedFairValueComposite != null
    ? (impliedFairValueComposite - market.marketCap) / impliedFairValueComposite
    : null;

  if (latestPAT == null)   notes.push("PAT unavailable — PE not computed");
  if (latestCSE == null)   notes.push("CSE unavailable — PB not computed");
  if (latestCoreOI == null) notes.push("CoreOI unavailable — EV/CoreOI not computed");

  // W3: surface loss-year exclusions so reviewers see when cyclical drawdowns
  // are silently dropped from historical bands.
  for (const band of [...primary, ...secondary]) {
    if ((band.nonPositivePeriodsExcluded ?? 0) > 0) {
      notes.push(
        `${band.metric}: ${band.nonPositivePeriodsExcluded} period(s) omitted from band as non-positive (loss/negative observation)`,
      );
    }
  }

  return {
    companyType: "industrial",
    primary,
    secondary,
    enterpriseValue: ev,
    impliedFairValueComposite,
    marginOfSafety,
    notes,
  };
}

// ─── Bank Multiples ──────────────────────────────────────────────────────────

/**
 * Compute multiples for banks / NBFCs.
 * Primary: PB (book value anchor), PE (earnings quality)
 * Secondary: Price/NII (revenue multiple for banks)
 */
export function computeBankMultiples(
  bankMetrics: BankPeriodMetrics[],
  market: MarketInputs,
  sectorMedians?: SectorMedians,
): RelativeValuationResult {
  const notes: string[] = [];
  const sorted = [...bankMetrics].sort(
    (a, b) => new Date(a.period_end).getTime() - new Date(b.period_end).getTime(),
  );

  const latest = sorted[sorted.length - 1];
  const latestEquity = latest.totalEquity;
  const latestPAT    = latest.pat;
  const latestNII    = latest.nii;

  // ── Build time series ────────────────────────────────────────────────────
  // See W4 note in computeIndustrialMultiples — these are CURRENT marketCap
  // against HISTORICAL fundamentals, not historical price-multiples.
  const pbImpliedSeries:       Array<number | null> = [];
  const peImpliedSeries:       Array<number | null> = [];
  const priceNiiImpliedSeries: Array<number | null> = [];

  for (const m of sorted) {
    pbImpliedSeries.push(safeDiv(market.marketCap, m.totalEquity));
    peImpliedSeries.push(safeDiv(market.marketCap, m.pat));
    priceNiiImpliedSeries.push(safeDiv(market.marketCap, m.nii));
  }

  const currentPB       = safeDiv(market.marketCap, latestEquity);
  const currentPE       = safeDiv(market.marketCap, latestPAT);
  const currentPriceNII = safeDiv(market.marketCap, latestNII);

  const primary: MultipleBand[] = [
    buildBand("PB",         pbImpliedSeries,       currentPB,       sectorMedians?.pb,       latestEquity),
    buildBand("PE",         peImpliedSeries,       currentPE,       sectorMedians?.pe,       latestPAT),
  ];

  const secondary: MultipleBand[] = [
    buildBand("Price/NII",  priceNiiImpliedSeries, currentPriceNII, sectorMedians?.priceNii, latestNII),
  ];

  const impliedValues = primary
    .map(b => b.impliedFairValue)
    .filter((v): v is number => v != null && v > 0);
  const impliedFairValueComposite = medianOf(impliedValues);

  const marginOfSafety = impliedFairValueComposite != null
    ? (impliedFairValueComposite - market.marketCap) / impliedFairValueComposite
    : null;

  if (latestEquity == null) notes.push("Book value unavailable — PB not computed");
  if (latestPAT == null)    notes.push("PAT unavailable — PE not computed");
  if (latestNII == null)    notes.push("NII unavailable — Price/NII not computed");

  for (const band of [...primary, ...secondary]) {
    if ((band.nonPositivePeriodsExcluded ?? 0) > 0) {
      notes.push(
        `${band.metric}: ${band.nonPositivePeriodsExcluded} period(s) omitted from band as non-positive (loss/negative observation)`,
      );
    }
  }

  return {
    companyType: "bank",
    primary,
    secondary,
    enterpriseValue: null,  // Not applicable for banks
    impliedFairValueComposite,
    marginOfSafety,
    notes,
  };
}

// ─── Historical Multiple Summary ─────────────────────────────────────────────

/**
 * Summarise where the current multiple sits in its own history.
 * Returns a human-readable label for UI display.
 */
export function multiplePositionLabel(band: MultipleBand): string {
  const pct = band.currentPercentile;
  if (pct == null || band.current == null) return "N/A";
  if (pct >= 90) return "Near historical high";
  if (pct >= 70) return "Above median";
  if (pct >= 30) return "Near median";
  if (pct >= 10) return "Below median";
  return "Near historical low";
}

/**
 * Return a valuation signal based on current multiple vs historical median.
 */
export type MultipleSignal = "expensive" | "fair" | "cheap" | "unknown";

export function multipleSignal(band: MultipleBand): MultipleSignal {
  if (band.current == null || band.median == null) return "unknown";
  const ratio = band.current / band.median;
  if (ratio > 1.3)  return "expensive";
  if (ratio > 0.75) return "fair";
  return "cheap";
}
