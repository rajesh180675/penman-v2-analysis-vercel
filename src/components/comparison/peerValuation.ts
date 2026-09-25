import { buildAnchoredValuationPeriods } from "../../engine/anchoredValuationPeriods";
import { computeValuation, deriveKwFromStructure } from "../../engine/PenmanNissimEngine";
import type { CompanyType, EngineConfig, RecastPeriod } from "../../engine/types";

export interface PeerSeries {
  readonly id: string;
  readonly company: string;
  readonly companyType: CompanyType | null;
  readonly series: RecastPeriod[];
}

export interface PeerBaseRow {
  readonly id: string;
  readonly company: string;
  readonly re: number | null;
  readonly reoi: number | null;
  readonly fcff: number | null;
  readonly fcfe: number | null;
  readonly ddm: number | null;
  readonly aeg: number | null;
}

export interface PeerMarketInput {
  readonly price: number;
  readonly shares: number;
}

/**
 * One peer's company-level values (₹ Cr), under ITS OWN scope.
 *
 * The workspace config carries the workspace issuer's share count and price;
 * spreading it into a peer's valuation used to divide every peer's equity by
 * someone else's shares. The peer's history is valued from ITS latest balance
 * sheet — raw history dated each peer at its oldest period, and series of
 * different lengths put peers at different valuation dates.
 */
export function valuePeer(peer: PeerSeries, config: EngineConfig, ke: number, g: number): PeerBaseRow {
  const n = peer.series.length;
  const kw = n >= 2
    ? deriveKwFromStructure(peer.series[n - 1]!, peer.series[n - 2]!, ke, config.risk_free_rate, config)
    : config.risk_free_rate;
  const peerConfig: EngineConfig = {
    ...config,
    shares_outstanding: undefined,
    market_price: undefined,
    company_type: peer.companyType ?? config.company_type,
  };
  const anchoredPeriods = buildAnchoredValuationPeriods({ history: peer.series, config: peerConfig, ke, kw, g });
  const v = computeValuation(anchoredPeriods, ke, kw, g, peerConfig);
  return {
    id: peer.id,
    company: peer.company,
    re: v.V_RE_CV3,
    reoi: v.V_ReOI_CV03,
    fcff: v.fcf?.V_FCFF_equity ?? null,
    fcfe: v.fcf?.V_FCFE ?? null,
    ddm: v.ddm.V_DDM,
    aeg: v.aeg?.V_AEG ?? null,
  };
}

/** Per-share value and upside from the PEER's own entered price and share count. */
export function withPeerMarketInput(base: PeerBaseRow, input: PeerMarketInput | undefined) {
  const inp = input ?? { price: 0, shares: 0 };
  const intrinsicPerShare = base.re != null && inp.shares > 0 ? base.re / inp.shares : null;
  const upside = intrinsicPerShare != null && inp.price > 0 ? intrinsicPerShare / inp.price - 1 : null;
  return { ...base, intrinsicPerShare, price: inp.price, shares: inp.shares, upside };
}
