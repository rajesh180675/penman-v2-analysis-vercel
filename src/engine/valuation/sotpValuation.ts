/* ================================================================
   Plan 5 PR-5.4 — Sum-of-the-Parts (SOTP) valuation.

   For diversified businesses (Reliance, ITC, Larsen, Tata
   conglomerates), a single multiple lies. SOTP values each
   reportable segment with its peer multiple, sums, then deducts
   net debt to get equity value.

   Algorithm:
     for each segment s:
       evMethodA = revenue * peer.evRevenue
       evMethodB = ebitda  * peer.evEbitda
       segmentEv = average(methodA, methodB) if both available,
                   else whichever is available
     totalEv  = sum(segmentEv)
     equity   = totalEv - netDebt + cashSurplus
     perShare = equity / sharesOutstanding

   PR-5.4 ships:
     - peer-multiples data file (19 Indian segments, retrieval-date
       cited)
     - sotpValuation pure function
     - schema bump v14 -> v15 (so old runs are flagged for re-run)
     - ADR

   Wiring SOTP into the valuation pipeline (so a diversified flag
   in config.subtype routes through here) is a follow-up.
================================================================ */

import peerMultiplesData from "./data/peer-multiples/india-2026-01.json";

export interface PeerMultipleRow {
  segment: string;
  evRevenue: number;
  evEbitda: number;
  peRatio: number;
  peerCount: number;
}

export interface PeerMultiplesSnapshot {
  retrievalDate: string;
  source: string;
  geography: string;
  version: string;
  segments: PeerMultipleRow[];
}

const PEER_DATA: PeerMultiplesSnapshot = peerMultiplesData as PeerMultiplesSnapshot;

export function getPeerMultiples(): PeerMultiplesSnapshot {
  return PEER_DATA;
}

/** Best-match by segment name. Same logic as Damodaran lookup. */
export function selectPeerMultiple(segment: string): PeerMultipleRow {
  const fallback = PEER_DATA.segments.find((s) => s.segment === "Diversified")!;
  if (!segment) return fallback;
  const target = segment.trim().toLowerCase();
  const exact = PEER_DATA.segments.find((s) => s.segment.toLowerCase() === target);
  if (exact) return exact;
  let best: PeerMultipleRow | null = null;
  let bestScore = 0;
  for (const row of PEER_DATA.segments) {
    const lower = row.segment.toLowerCase();
    if (lower.includes(target) || target.includes(lower)) {
      const score = Math.min(target.length, lower.length);
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
  }
  return best ?? fallback;
}

export interface SotpSegmentInput {
  /** Reportable segment name. Must match a peer-multiples row. */
  segment: string;
  /** Segment revenue in absolute ₹. Required. */
  revenue: number;
  /** Segment EBITDA in absolute ₹. Optional — when absent, EV/Revenue is used alone. */
  ebitda?: number;
}

export interface SotpInputs {
  segments: ReadonlyArray<SotpSegmentInput>;
  /** Net debt in absolute ₹ (debt - cash). Subtracted from total EV. */
  netDebt: number;
  /** Investments / non-operating asset surplus in absolute ₹. Added to equity value. */
  surplusAssets?: number;
  /** Shares outstanding (absolute count, not crore). */
  sharesOutstanding: number;
}

export interface SotpSegmentResult {
  segment: string;
  matchedPeer: string;
  revenue: number;
  ebitda: number | null;
  evFromRevenue: number;
  evFromEbitda: number | null;
  /** Average of available method results. */
  segmentEv: number;
  /** Citation for audit. */
  multiplesUsed: { evRevenue: number; evEbitda: number };
}

export interface SotpResult {
  perSegment: SotpSegmentResult[];
  totalEnterpriseValue: number;
  netDebt: number;
  surplusAssets: number;
  equityValue: number;
  perShareValue: number;
  /** Citation block for the valuation envelope. */
  citation: {
    retrievalDate: string;
    source: string;
    version: string;
    segmentCount: number;
  };
}

export function sotpValuation(inputs: SotpInputs): SotpResult {
  const perSegment: SotpSegmentResult[] = [];
  let totalEv = 0;

  for (const seg of inputs.segments) {
    const peer = selectPeerMultiple(seg.segment);
    const evFromRevenue = seg.revenue * peer.evRevenue;
    const evFromEbitda = seg.ebitda != null ? seg.ebitda * peer.evEbitda : null;
    const segmentEv = evFromEbitda != null ? 0.5 * (evFromRevenue + evFromEbitda) : evFromRevenue;
    perSegment.push({
      segment: seg.segment,
      matchedPeer: peer.segment,
      revenue: seg.revenue,
      ebitda: seg.ebitda ?? null,
      evFromRevenue,
      evFromEbitda,
      segmentEv,
      multiplesUsed: { evRevenue: peer.evRevenue, evEbitda: peer.evEbitda },
    });
    totalEv += segmentEv;
  }

  const surplus = inputs.surplusAssets ?? 0;
  const equity = totalEv - inputs.netDebt + surplus;
  const perShare = inputs.sharesOutstanding > 0 ? equity / inputs.sharesOutstanding : 0;

  return {
    perSegment,
    totalEnterpriseValue: totalEv,
    netDebt: inputs.netDebt,
    surplusAssets: surplus,
    equityValue: equity,
    perShareValue: perShare,
    citation: {
      retrievalDate: PEER_DATA.retrievalDate,
      source: PEER_DATA.source,
      version: PEER_DATA.version,
      segmentCount: PEER_DATA.segments.length,
    },
  };
}
