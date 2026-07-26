/**
 * Pinned market packs — dated inputs that valuation may rely on.
 *
 * Everything here is *supplied*, never inferred from whatever happens to be
 * loaded in the session. That is the point: a peer median assembled from the
 * loaded registry is a small-sample artifact, and a discount rate built from
 * engine constants is undated by construction.
 */
export {
  MIN_PEER_CONSTITUENTS,
  PEER_PRICE_STALENESS_DAYS,
  resolvePeerPackEligibility,
  usablePeerConstituents,
} from "./peerPack";
export type { PeerPack, PeerPackConstituent, PeerPackEligibility } from "./peerPack";

export {
  MACRO_STALENESS_DAYS,
  resolveMacroObservation,
  resolveMacroPack,
} from "./macroPack";
export type {
  MacroObservation,
  MacroObservationKey,
  MacroObservationStatus,
  MacroPack,
  MacroPackResolution,
} from "./macroPack";

// The one pack with real published observations in it. Kept separate from the
// container so the mechanism stays testable against synthetic packs.
export { INDIA_ERP_BASIS, INDIA_MACRO_PACK } from "./indiaMacroPack";
