/**
 * Tiered capital-cost assumptions.
 *
 * The cost-of-capital resolver already has real policy structure — modes,
 * guards, evidence rows, confirmed/guarded/blocked status. Then it sources its
 * two most sensitive inputs from constants: `SECTOR_BETAS` (bank 1.10, nbfc
 * 1.30, insurance 1.05) and `equity_risk_premium: 0.06`, stamped
 * `erpSource: "Engine configuration"`. Every downstream lens inherits that, and
 * the rigor ladder does not flag it, because the value resolved without error.
 *
 * This module does not claim to make those numbers true. It makes the *strength
 * of their provenance* an explicit, machine-readable property, so a gate can
 * demote a run that is guessing:
 *
 *   - `estimated` — computed from data we hold (bottom-up beta from peer betas).
 *   - `sourced`   — a dated third-party value with an attributable origin.
 *   - `prior`     — a sector default. Still computes; now labelled.
 *
 * `estimated` and `sourced` are both defensible. `prior` is the one that should
 * cost a run its headline number.
 */

import { SECTOR_BETAS } from "../types/config";
import type { CompanyType, EngineConfig } from "../types";
import {
  resolveEquityBeta,
  resolveMacroPack,
  type EquityBetaPack,
  type EquityBetaStatus,
  type MacroPack,
  type MacroPackResolution,
} from "../marketPacks";

export type AssumptionTier = "estimated" | "sourced" | "prior";

export type CapitalCostAssumptionKey =
  | "risk-free-rate"
  | "equity-risk-premium"
  | "beta"
  | "terminal-growth-ceiling";

export interface TieredAssumption {
  readonly key: CapitalCostAssumptionKey;
  readonly value: number;
  readonly tier: AssumptionTier;
  /** Attributable origin. For `prior`, names the default that was applied. */
  readonly source: string;
  /** Observation date. Null for a `prior`, which is dateless by nature. */
  readonly asOf: string | null;
  /** How the value was arrived at, for the evidence row. */
  readonly method: string;
  /** Why a weaker tier was used. Absent when the tier is not `prior`. */
  readonly fallbackReason?: string | undefined;
}

/**
 * A peer's observed levered beta plus the leverage and tax rate it was observed
 * at. All three are needed: unlevering with the target's leverage instead of the
 * peer's own is a common and silent error.
 */
export interface PeerLeveredBeta {
  readonly companyId: string;
  readonly leveredBeta: number;
  readonly debtToEquity: number;
  readonly taxRate: number;
}

/**
 * Minimum peers for a bottom-up beta. Asset betas are noisy enough that a
 * two-name median is not an industry beta. Deliberately the same floor as the
 * peer-multiple lens: both are medians over a sector, and neither is meaningful
 * on three names.
 *
 * With 33 loaded companies this will usually not be met, so beta will report
 * `prior` with a reason. That is the honest answer, not a shortfall of this
 * module.
 */
export const MIN_BOTTOM_UP_PEERS = 5;

/** Hamada: βasset = βequity / (1 + (1 − t)·D/E). */
export function unleverBeta(leveredBeta: number, debtToEquity: number, taxRate: number): number | null {
  if (!Number.isFinite(leveredBeta) || !Number.isFinite(debtToEquity) || !Number.isFinite(taxRate)) return null;
  if (debtToEquity < 0 || taxRate < 0 || taxRate >= 1) return null;
  const factor = 1 + (1 - taxRate) * debtToEquity;
  if (factor <= 0) return null;
  return leveredBeta / factor;
}

/** Hamada, inverted: βequity = βasset · (1 + (1 − t)·D/E). */
export function releverBeta(assetBeta: number, debtToEquity: number, taxRate: number): number | null {
  if (!Number.isFinite(assetBeta) || !Number.isFinite(debtToEquity) || !Number.isFinite(taxRate)) return null;
  if (debtToEquity < 0 || taxRate < 0 || taxRate >= 1) return null;
  return assetBeta * (1 + (1 - taxRate) * debtToEquity);
}

function median(values: readonly number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  const sorted = [...clean].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function sectorBetaPrior(companyType: CompanyType | undefined, reason: string): TieredAssumption {
  const key = companyType ?? "auto";
  return {
    key: "beta",
    value: SECTOR_BETAS[key] ?? 1,
    tier: "prior",
    source: `Sector beta prior (${key})`,
    asOf: null,
    method: "Engine sector-default table",
    fallbackReason: reason,
  };
}

/**
 * Resolve beta: bottom-up from peers, then the company's own regressed beta,
 * then an explicit scalar, then a sector prior.
 *
 * Order is deliberate, and the first two are both `estimated` for the same
 * reason — each is reproducible from data we hold — so the tie is broken on
 * precision rather than kind. A bottom-up beta is a median across peers, which
 * averages away a good part of the estimation error that any single regression
 * carries; a five-year weekly regression on one name typically has a standard
 * error around 0.09, and the median of five such names is tighter than that.
 * That is the standard argument for preferring industry betas, and it is why a
 * qualifying peer set still wins here.
 *
 * Both outrank an explicit beta whose derivation we cannot see. That ordering
 * predates the regressed branch (a bottom-up beta already outranked
 * `config.beta`), and extending it is deliberate rather than incidental: a
 * dated regression with its error bars published is more defensible than an
 * undated scalar, even a deliberate one. A reviewer who needs the scalar to win
 * should withhold the pack for that run, which keeps the override visible in
 * the inputs instead of hiding it behind a silent precedence rule.
 */
export function resolveBeta(input: {
  readonly companyType?: CompanyType | undefined;
  /** Target leverage to relever at, from structural weights where available. */
  readonly targetDebtToEquity?: number | null | undefined;
  readonly taxRate?: number | null | undefined;
  readonly peerBetas?: readonly PeerLeveredBeta[] | undefined;
  /**
   * The company's own regressed beta, already validated against the pack's
   * precision and staleness rules. `unusable` carries the reason, which becomes
   * the prior's `fallbackReason` so a reviewer sees why the regression was not
   * used rather than only that a default was.
   */
  readonly regressedBeta?: EquityBetaStatus | null | undefined;
  /** Explicit beta from config, when a reviewer set one. */
  readonly explicitBeta?: number | null | undefined;
  readonly explicitBetaSource?: string | undefined;
  readonly minimumPeers?: number | undefined;
}): TieredAssumption {
  const minimum = input.minimumPeers ?? MIN_BOTTOM_UP_PEERS;
  const peers = input.peerBetas ?? [];
  const taxRate = input.taxRate;
  const targetDe = input.targetDebtToEquity;

  const assetBetas = peers
    .map((peer) => unleverBeta(peer.leveredBeta, peer.debtToEquity, peer.taxRate))
    .filter((value): value is number => value != null && value > 0);

  const canBottomUp = assetBetas.length >= minimum
    && targetDe != null && Number.isFinite(targetDe) && targetDe >= 0
    && taxRate != null && Number.isFinite(taxRate) && taxRate >= 0 && taxRate < 1;

  if (canBottomUp) {
    const medianAsset = median(assetBetas)!;
    const relevered = releverBeta(medianAsset, targetDe, taxRate);
    if (relevered != null && relevered > 0) {
      return {
        key: "beta",
        value: relevered,
        tier: "estimated",
        source: `Bottom-up from ${assetBetas.length} peer betas`,
        asOf: null,
        method: `Median unlevered beta ${medianAsset.toFixed(3)} relevered at D/E ${targetDe.toFixed(3)}, tax ${taxRate.toFixed(3)}`,
      };
    }
  }

  const regressed = input.regressedBeta ?? null;
  if (regressed?.status === "usable") {
    return {
      key: "beta",
      value: regressed.beta,
      // `estimated`, not `sourced`. The distinction is who did the arithmetic:
      // a sourced value is one a third party computed and stands behind, while
      // this slope was computed here from price history, which is exactly what
      // `estimated` means in this module. Calling it `sourced` would also imply
      // a vendor stands behind the number, which nobody does.
      tier: "estimated",
      source: regressed.source,
      asOf: regressed.asOf,
      method: regressed.method,
    };
  }

  if (input.explicitBeta != null && Number.isFinite(input.explicitBeta) && input.explicitBeta > 0) {
    return {
      key: "beta",
      value: input.explicitBeta,
      // `prior`, not `sourced`. This module defines `sourced` as a dated
      // third-party value with an attributable origin, and a number typed into
      // `config.beta` is neither dated nor third-party — `asOf` is null right
      // below, which is the tell. Labelling it `sourced` also switched the
      // provenance gate off, so typing any beta bought production-ready for a
      // run whose beta nobody observed: a weaker claim than the sector prior it
      // outranks, yet it cleared a gate the prior blocks.
      //
      // It stays ahead of the sector prior on VALUE — a reviewer who names a
      // beta for this company means it — and it is the same treatment
      // `config.equity_risk_premium` and `config.risk_free_rate` already get:
      // config constants are used, and reported as priors.
      tier: "prior",
      source: input.explicitBetaSource ?? "Explicit beta",
      asOf: null,
      method: "Reviewer-supplied levered beta",
      fallbackReason: "Beta was supplied directly in the engine configuration, so it carries no observation date or third-party attribution. Supply a beta pack or a peer set to earn a measured beta.",
    };
  }

  // The regression's own reason is the more specific one when there was a pack
  // to consult at all: "beta se 0.250 is above the 0.15 limit" tells a reviewer
  // something actionable, where the peer-count reason only restates that 33
  // companies are not a sector.
  const reason = regressed?.status === "unusable"
    ? regressed.reason
    : assetBetas.length < minimum
      ? `Only ${assetBetas.length} usable peer beta(s); a bottom-up estimate needs ${minimum}.`
      : "Target leverage or tax rate unavailable, so peer betas could not be relevered.";
  return sectorBetaPrior(input.companyType, reason);
}

/** Resolve the ERP, preferring a dated pack observation over the config constant. */
export function resolveEquityRiskPremium(
  resolution: MacroPackResolution,
  config: EngineConfig,
): TieredAssumption {
  const observation = resolution.equityRiskPremium;
  if (observation.status === "usable") {
    return {
      key: "equity-risk-premium",
      value: observation.value,
      tier: "sourced",
      source: observation.source,
      asOf: observation.asOf,
      method: "Pinned macro pack",
    };
  }
  return {
    key: "equity-risk-premium",
    value: config.equity_risk_premium,
    tier: "prior",
    source: "Engine configuration",
    asOf: null,
    method: "Engine default equity risk premium",
    fallbackReason: observation.reason,
  };
}

/**
 * A risk-free rate taken from the app's live market snapshot.
 *
 * This is not a macro-pack observation: the snapshot is fetched at run time and
 * is not pinned, so it is modelled separately and takes value precedence, which
 * is the behaviour the engine already had before tiers existed.
 */
export interface LiveRiskFreeObservation {
  readonly value: number;
  readonly asOf: string | null;
  readonly source: string;
}

/**
 * Resolve the risk-free rate: a *dated* live snapshot, then a dated pack
 * observation, then an undated live snapshot, then the config constant.
 *
 * Precedence is by strength of provenance, not by source. A dated live rate
 * outranks the pack because it is the same kind of claim, only fresher. An
 * undated live rate does not: a number of unknown vintage cannot be reproduced
 * by a reviewer, so it loses to a pack observation that can be, and it is the
 * one case where the pack changes a *value* rather than only a label.
 *
 * That ordering matters more than it looks. Ranking any live rate above the pack
 * meant a run could report a sourced ERP bolted to a `prior` risk-free rate
 * while a dated rate sat unused in the pack — the exact opposite of what
 * supplying a pack is asking for. With no pack supplied, resolution.riskFreeRate
 * is unusable and this falls through to the undated live rate exactly as before,
 * so no existing caller moves.
 */
export function resolveRiskFreeRate(
  resolution: MacroPackResolution,
  config: EngineConfig,
  live?: LiveRiskFreeObservation | null | undefined,
): TieredAssumption {
  const liveUsable = live != null && Number.isFinite(live.value) && live.value > 0;
  if (liveUsable && live!.asOf) {
    return {
      key: "risk-free-rate",
      value: live!.value,
      tier: "sourced",
      source: live!.source,
      asOf: live!.asOf,
      method: "Live market snapshot",
    };
  }

  const observation = resolution.riskFreeRate;
  if (observation.status === "usable") {
    return {
      key: "risk-free-rate",
      value: observation.value,
      tier: "sourced",
      source: observation.source,
      asOf: observation.asOf,
      method: "Pinned macro pack",
    };
  }

  if (liveUsable) {
    return {
      key: "risk-free-rate",
      value: live!.value,
      tier: "prior",
      source: live!.source,
      asOf: null,
      method: "Live market snapshot",
      fallbackReason: "Live risk-free rate carries no as-of date, so it cannot be reproduced.",
    };
  }

  return {
    key: "risk-free-rate",
    value: config.risk_free_rate,
    tier: "prior",
    source: "Engine configuration",
    asOf: null,
    method: "Engine default risk-free rate",
    fallbackReason: observation.reason,
  };
}

/**
 * Resolve the ceiling on terminal growth.
 *
 * A firm growing faster than the economy in perpetuity eventually becomes the
 * economy, so long-run nominal GDP growth is the defensible ceiling. The engine
 * currently caps at a hardcoded `g_terminal_cap: 0.06`, which is *below* long-run
 * Indian nominal growth — so every terminal value is systematically conservative
 * for an undocumented reason. Sourcing the ceiling makes that a stated policy
 * rather than a buried constant.
 */
export function resolveTerminalGrowthCeiling(
  resolution: MacroPackResolution,
  config: EngineConfig,
): TieredAssumption {
  const observation = resolution.longRunNominalGrowth;
  if (observation.status === "usable") {
    return {
      key: "terminal-growth-ceiling",
      value: observation.value,
      tier: "sourced",
      source: observation.source,
      asOf: observation.asOf,
      method: "Long-run nominal growth from pinned macro pack",
    };
  }
  return {
    key: "terminal-growth-ceiling",
    value: config.g_terminal_cap ?? 0.06,
    tier: "prior",
    source: "Engine configuration",
    asOf: null,
    method: "Engine default terminal growth cap",
    fallbackReason: observation.reason,
  };
}

export interface CapitalCostAssumptionSet {
  readonly riskFreeRate: TieredAssumption;
  readonly equityRiskPremium: TieredAssumption;
  readonly beta: TieredAssumption;
  readonly terminalGrowthCeiling: TieredAssumption;
  /** Assumptions resting on a sector default; empty when every input is defensible. */
  readonly priorTierKeys: readonly CapitalCostAssumptionKey[];
  /** True when nothing in the set is `prior` — the precondition for a headline range. */
  readonly fullyDefensible: boolean;
}

/**
 * Resolve every capital-cost assumption together, so a caller cannot pick up a
 * sourced ERP while silently inheriting a prior beta.
 */
export function resolveCapitalCostAssumptions(input: {
  readonly config: EngineConfig;
  readonly macroPack?: MacroPack | null | undefined;
  /**
   * Pinned regressed betas. Absent by default for the same reason `macroPack`
   * is: with no pack, beta resolves exactly as it did before this pack existed,
   * so no existing caller moves until one asks for it and says as of when.
   */
  readonly betaPack?: EquityBetaPack | null | undefined;
  readonly analysisAsOf?: string | null | undefined;
  readonly liveRiskFreeRate?: LiveRiskFreeObservation | null | undefined;
  readonly peerBetas?: readonly PeerLeveredBeta[] | undefined;
  readonly targetDebtToEquity?: number | null | undefined;
  readonly taxRate?: number | null | undefined;
}): CapitalCostAssumptionSet {
  const resolution = resolveMacroPack(input.macroPack, input.analysisAsOf ?? null);
  const riskFreeRate = resolveRiskFreeRate(resolution, input.config, input.liveRiskFreeRate);
  const equityRiskPremium = resolveEquityRiskPremium(resolution, input.config);
  const terminalGrowthCeiling = resolveTerminalGrowthCeiling(resolution, input.config);
  // Only consulted when a pack was supplied, so a run without one reports the
  // peer-count reason it always did rather than "no pack supplied", which would
  // read as a regression to anyone who never opted in.
  // Keyed on `ticker`, deliberately not `market_data_symbol`. The pack is
  // generated from registry tickers, and `ticker` is what the registry sets
  // (AppShell passes the company id straight into it). `market_data_symbol` is a
  // user-editable field for a price feed and may carry an exchange suffix or a
  // provider-specific instrument format, so keying on it would miss the pack for
  // a company that is in it.
  const regressedBeta = input.betaPack
    ? resolveEquityBeta(input.betaPack, input.config.ticker ?? null, {
        analysisAsOf: input.analysisAsOf ?? null,
      })
    : null;
  const beta = resolveBeta({
    // config.company_type admits null; the prior lookup keys off "auto" instead.
    companyType: input.config.company_type ?? undefined,
    targetDebtToEquity: input.targetDebtToEquity,
    taxRate: input.taxRate,
    peerBetas: input.peerBetas,
    regressedBeta,
    explicitBeta: input.config.beta,
    explicitBetaSource: "Explicit beta from engine configuration",
  });

  const all = [riskFreeRate, equityRiskPremium, beta, terminalGrowthCeiling];
  const priorTierKeys = all.filter((item) => item.tier === "prior").map((item) => item.key);

  return {
    riskFreeRate,
    equityRiskPremium,
    beta,
    terminalGrowthCeiling,
    priorTierKeys,
    fullyDefensible: priorTierKeys.length === 0,
  };
}
