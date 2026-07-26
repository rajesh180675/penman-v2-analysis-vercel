/**
 * Peer Relative Valuation (Phase G)
 *
 * Computes cross-company ratio percentiles and multiple-implied fair values
 * from the CompanyRegistry. When multiple companies are loaded, this module
 * derives sector medians and ranks the target company against its peers.
 *
 * Key outputs:
 *   - Ratio percentiles (ROCE, PM, ATO, growth) vs loaded peers
 *   - Trading multiple percentiles (PE, PB, EV/EBITDA) vs peers
 *   - Multiple-implied fair value (peer median × target fundamental)
 *   - Composite peer-implied value range
 */

import { CompanyRegistry, MultiCompanyRecord, RecastPeriod, EngineConfig, CompanyType } from "./types";
import {
  resolvePeerPackEligibility,
  usablePeerConstituents,
  type PeerPack,
} from "./marketPacks";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PeerRatioEntry {
  companyId: string;
  label: string;
  value: number;
}

export interface PeerRatioRanking {
  metric: string;
  /** Human-readable label */
  label: string;
  /** Target company's value */
  targetValue: number | null;
  /** Percentile of target within peer set [0-100] */
  targetPercentile: number | null;
  /** Peer median */
  peerMedian: number | null;
  /** Peer count (with valid data) */
  peerCount: number;
  /** All peer entries sorted descending */
  peers: PeerRatioEntry[];
}

export interface PeerMultipleImplied {
  metric: string;
  /** Peer median multiple */
  peerMedianMultiple: number | null;
  /** Target's fundamental (EPS, BVPS, etc.) */
  targetFundamental: number | null;
  /** Implied fair value = peerMedian × fundamental */
  impliedFairValue: number | null;
  /** Premium/discount of market price to implied value */
  premiumDiscount: number | null;
  peerCount: number;
}

/**
 * Why the multiple-implied lens did or did not run.
 *
 * Previously its absence was indistinguishable from a peer signal of zero:
 * `multipleImplied` came back `[]` and `compositeFairValue` came back null with
 * no statement of why. A reviewer needs to tell "withheld" from "computed and
 * uninformative".
 */
export interface PeerMultipleLensStatus {
  status: "computed" | "skipped";
  /** Present when skipped. */
  reason?: string | undefined;
  /** Pack date backing the multiples, when computed. */
  asOf?: string | undefined;
  /** Pack source backing the multiples, when computed. */
  source?: string | undefined;
  /** Constituents that carried both a dated price and a share count. */
  usableConstituentCount: number;
}

export interface PeerRelativeResult {
  /** Target company ID */
  targetId: string;
  /** Number of valid peers used */
  peerCount: number;
  /** Fundamental ratio rankings */
  ratioRankings: PeerRatioRanking[];
  /** Multiple-implied fair values */
  multipleImplied: PeerMultipleImplied[];
  /** Disclosure for the multiple-implied lens — never silently empty. */
  multipleLens: PeerMultipleLensStatus;
  /** Composite implied fair value (median of all implied values) */
  compositeFairValue: number | null;
  /** Margin of safety vs composite (positive = undervalued) */
  compositeMarginOfSafety: number | null;
  /** Summary explanation */
  explanation: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function median(arr: number[]): number | null {
  const clean = arr.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function percentileOf(value: number, arr: number[]): number | null {
  const clean = arr.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const below = clean.filter(v => v <= value).length;
  return Math.round((below / clean.length) * 100);
}

function normalizeComparableType(type: CompanyType | null | undefined): Exclude<CompanyType, "auto"> | null {
  return type && type !== "auto" ? type : null;
}

function recordIsBlocked(record: MultiCompanyRecord): boolean {
  return record.traceability?.confidence?.status === "blocked"
    || record.traceability?.qualityGate?.valuationBlocked === true
    || record.traceability?.qualityGate?.scopeBlocked === true;
}

function samePeerGroup(target: MultiCompanyRecord, peer: MultiCompanyRecord, targetType: Exclude<CompanyType, "auto">): boolean {
  const peerType = normalizeComparableType(peer.companyType);
  if (peerType !== targetType) return false;
  if (target.sector && peer.sector !== target.sector) return false;
  if (recordIsBlocked(peer)) return false;
  return true;
}

/** Extract latest-period ratios from a company's recast data. */
function extractLatestRatios(data: RecastPeriod[]): {
  ROCE: number | null;
  PM: number | null;
  ATO: number | null;
  FLEV: number | null;
  salesGrowth: number | null;
  ROE: number | null;
  RNOA: number | null;
} | null {
  if (data.length < 1) return null;
  const latest = data[data.length - 1]!;
  const ratios = latest.ratios;
  if (!ratios) return null;

  // Sales growth from last 2 periods
  let salesGrowth: number | null = null;
  if (data.length >= 2) {
    const prev = data[data.length - 2]!;
    if (prev.is.Sales > 0 && latest.is.Sales > 0) {
      salesGrowth = (latest.is.Sales - prev.is.Sales) / prev.is.Sales;
    }
  }

  return {
    ROCE: ratios.ROCE ?? null,
    PM: ratios.PM ?? null,
    ATO: ratios.ATO ?? null,
    FLEV: ratios.FLEV ?? null,
    salesGrowth,
    ROE: ratios.ROCE ?? null, // ROCE ≈ ROE in N&P framework
    RNOA: ratios.RNOA ?? null,
  };
}

/** Extract per-share fundamentals for multiple-implied valuation. */
function extractFundamentals(data: RecastPeriod[], config: EngineConfig): {
  eps: number | null;
  bvps: number | null;
  salesPerShare: number | null;
  marketPrice: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
} {
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const shares = config.shares_outstanding ?? null;
  const price = config.market_price ?? null;

  if (!latest || !shares || shares <= 0) {
    return { eps: null, bvps: null, salesPerShare: null, marketPrice: price, pe: null, pb: null, ps: null };
  }

  const eps = latest.is.CNI / shares;
  const bvps = latest.bs.CSE / shares;
  const salesPerShare = latest.is.Sales / shares;

  const pe = price != null && eps > 0 ? price / eps : null;
  const pb = price != null && bvps > 0 ? price / bvps : null;
  const ps = price != null && salesPerShare > 0 ? price / salesPerShare : null;

  return { eps, bvps, salesPerShare, marketPrice: price, pe, pb, ps };
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Compute peer-relative valuation for a target company against the registry.
 *
 * @param targetId - Company ID to evaluate
 * @param registry - All loaded companies
 * @param config - Target company's engine config (for shares, market price)
 */
export function computePeerRelativeValuation(
  targetId: string,
  registry: CompanyRegistry,
  config: EngineConfig,
  options?: {
    /**
     * Dated per-constituent prices and share counts. Without it the
     * multiple-implied lens is skipped with a reason rather than returning an
     * empty array that reads like a peer signal of zero.
     */
    readonly peerPack?: PeerPack | null | undefined;
    /** Analysis date, for the pack's staleness and look-ahead checks. */
    readonly analysisAsOf?: string | null | undefined;
  },
): PeerRelativeResult | null {
  const allCompanies = Object.values(registry.companies).filter(c => c.recastData.length >= 2);
  if (allCompanies.length < 2) return null; // need at least 1 peer

  const target = allCompanies.find(c => c.id === targetId);
  if (!target || recordIsBlocked(target)) return null;

  const targetType = normalizeComparableType(target.companyType) ?? normalizeComparableType(config.company_type);
  if (!targetType) return null;

  const peers = allCompanies.filter(c => c.id !== targetId && samePeerGroup(target, c, targetType));
  if (peers.length === 0) return null;

  // ── Ratio Rankings ──────────────────────────────────────────────────────
  const targetRatios = extractLatestRatios(target.recastData);
  if (!targetRatios) return null;

  const peerRatioData = peers
    .map(p => ({ company: p, ratios: extractLatestRatios(p.recastData) }))
    .filter((entry): entry is { company: MultiCompanyRecord; ratios: NonNullable<ReturnType<typeof extractLatestRatios>> } =>
      entry.ratios != null
    );

  const ratioMetrics: Array<{ key: keyof NonNullable<ReturnType<typeof extractLatestRatios>>; label: string }> = [
    { key: "ROCE", label: "Return on Capital Employed" },
    { key: "RNOA", label: "Return on Net Operating Assets" },
    { key: "PM", label: "Profit Margin (OI/Sales)" },
    { key: "ATO", label: "Asset Turnover (Sales/NOA)" },
    { key: "salesGrowth", label: "Revenue Growth (YoY)" },
    { key: "FLEV", label: "Financial Leverage (NFO/CSE)" },
  ];

  const ratioRankings: PeerRatioRanking[] = ratioMetrics.map(({ key, label }) => {
    const targetVal = targetRatios[key];
    const peerValues = peerRatioData
      .map(p => p.ratios[key])
      .filter((v): v is number => v != null && Number.isFinite(v));

    const allValues = targetVal != null ? [...peerValues, targetVal] : peerValues;

    const peerEntries: PeerRatioEntry[] = peerRatioData
      .filter(p => p.ratios[key] != null && Number.isFinite(p.ratios[key]))
      .map(p => ({ companyId: p.company.id, label: p.company.label, value: p.ratios[key] as number }))
      .sort((a, b) => b.value - a.value);

    return {
      metric: key,
      label,
      targetValue: targetVal,
      targetPercentile: targetVal != null ? percentileOf(targetVal, allValues) : null,
      peerMedian: median(peerValues),
      peerCount: peerValues.length,
      peers: peerEntries,
    };
  });

  // ── Multiple-Implied Fair Values ────────────────────────────────────────
  const targetFundamentals = extractFundamentals(target.recastData, config);

  // A peer multiple needs that peer's own price and share count. `EngineConfig`
  // carries exactly one of each — the target's — so the previous implementation
  // blanked them for peers and every peer PE/PB came back null. `allPEs` could
  // then hold only the target's own PE, which the median call filtered out, so
  // the lens was unreachable for all inputs. Peer prices now come from the
  // pinned pack, which is the only place they exist.
  const packEligibility = resolvePeerPackEligibility(options?.peerPack, {
    analysisAsOf: options?.analysisAsOf ?? null,
  });

  const multipleImplied: PeerMultipleImplied[] = [];
  let multipleLens: PeerMultipleLensStatus;

  if (packEligibility.status !== "eligible") {
    multipleLens = {
      status: "skipped",
      reason: packEligibility.reason,
      usableConstituentCount: packEligibility.usableCount,
    };
  } else {
    const constituents = usablePeerConstituents(options!.peerPack!);
    const peerMultiples = peers.flatMap((peer) => {
      const quote = constituents.get(peer.id);
      if (!quote?.price || !quote.shares) return [];
      const latest = peer.recastData[peer.recastData.length - 1];
      if (!latest) return [];
      const eps = latest.is.CNI / quote.shares;
      const bvps = latest.bs.CSE / quote.shares;
      return [{
        pe: eps > 0 ? quote.price / eps : null,
        pb: bvps > 0 ? quote.price / bvps : null,
      }];
    });

    // Bands drop implausible multiples rather than letting one distressed or
    // near-zero-earnings peer drag the median.
    const peerPEs = peerMultiples
      .map((item) => item.pe)
      .filter((value): value is number => value != null && value > 0 && value < 200);
    const peerPBs = peerMultiples
      .map((item) => item.pb)
      .filter((value): value is number => value != null && value > 0 && value < 50);

    const peerMedianPE = median(peerPEs);
    if (peerMedianPE != null && targetFundamentals.eps != null && targetFundamentals.eps > 0) {
      const implied = peerMedianPE * targetFundamentals.eps;
      multipleImplied.push({
        metric: "PE",
        peerMedianMultiple: peerMedianPE,
        targetFundamental: targetFundamentals.eps,
        impliedFairValue: implied,
        premiumDiscount: targetFundamentals.marketPrice != null ? (targetFundamentals.marketPrice - implied) / implied : null,
        peerCount: peerPEs.length,
      });
    }

    const peerMedianPB = median(peerPBs);
    if (peerMedianPB != null && targetFundamentals.bvps != null && targetFundamentals.bvps > 0) {
      const implied = peerMedianPB * targetFundamentals.bvps;
      multipleImplied.push({
        metric: "PB",
        peerMedianMultiple: peerMedianPB,
        targetFundamental: targetFundamentals.bvps,
        impliedFairValue: implied,
        premiumDiscount: targetFundamentals.marketPrice != null ? (targetFundamentals.marketPrice - implied) / implied : null,
        peerCount: peerPBs.length,
      });
    }

    multipleLens = multipleImplied.length
      ? {
          status: "computed",
          asOf: packEligibility.asOf,
          source: packEligibility.source,
          usableConstituentCount: packEligibility.usableCount,
        }
      : {
          status: "skipped",
          reason: "Peer pack was eligible but no peer produced a usable PE or PB, or the target has no positive EPS/BVPS.",
          usableConstituentCount: packEligibility.usableCount,
        };
  }

  // Composite implied fair value
  const impliedValues = multipleImplied
    .map(m => m.impliedFairValue)
    .filter((v): v is number => v != null && v > 0);
  const compositeFairValue = median(impliedValues);
  const compositeMarginOfSafety = compositeFairValue != null && targetFundamentals.marketPrice != null && targetFundamentals.marketPrice > 0
    ? (compositeFairValue - targetFundamentals.marketPrice) / targetFundamentals.marketPrice
    : null;

  // ── Explanation ─────────────────────────────────────────────────────────
  const explanation: string[] = [
    `Peer relative valuation using ${peers.length} eligible peer(s) after company-type, sector, and quality gates.`,
    ...ratioRankings
      .filter(r => r.targetPercentile != null)
      .map(r => `${r.label}: ${((r.targetValue ?? 0) * 100).toFixed(1)}% (P${r.targetPercentile} vs peers, median ${((r.peerMedian ?? 0) * 100).toFixed(1)}%)`),
    ...multipleImplied.map(m =>
      `${m.metric}-implied: ₹${m.impliedFairValue?.toFixed(1)} (peer median ${m.metric}=${m.peerMedianMultiple?.toFixed(1)}x × ₹${m.targetFundamental?.toFixed(1)}, ${m.peerCount} peer(s) priced ${multipleLens.asOf ?? "undated"})`
    ),
    // Say plainly that the lens was withheld. An absent line reads as "no peer
    // signal"; this distinguishes it from "peer signal of zero".
    ...(multipleLens.status === "skipped" ? [`Peer multiple lens skipped: ${multipleLens.reason}`] : []),
    ...(compositeFairValue != null ? [`Composite peer-implied fair value: ₹${compositeFairValue.toFixed(1)}`] : []),
    ...(compositeMarginOfSafety != null ? [`Margin of safety vs peer-implied: ${(compositeMarginOfSafety * 100).toFixed(1)}%`] : []),
  ];

  return {
    targetId,
    peerCount: peers.length,
    ratioRankings,
    multipleImplied,
    multipleLens,
    compositeFairValue,
    compositeMarginOfSafety,
    explanation,
  };
}
