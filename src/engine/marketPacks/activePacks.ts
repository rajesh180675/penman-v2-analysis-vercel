/* ================================================================
   The activation point for the pinned packs.

   Everything else in this directory is *supplied*, never inferred: a
   resolver called without a pack derives the same undated rate it
   always did. That contract is deliberate and stays. It is what lets
   the specs that build a config and ask for a cost of equity keep
   asserting prior tiers without knowing packs exist, and it is why
   activation cannot be done by defaulting the packs inside the
   resolver — that would silently re-point every one of those callers.

   So activation lives here instead: one module naming which packs
   production supplies, imported by every call site that resolves a
   capital cost a reviewer will read.

   The reason that matters is S-9.4C. A pack reaches the resolver only
   as an argument, so a surface that omits it derives the *unpinned*
   rate from the same config — and if the run receives the pack while a
   tab does not, the app prints one discount rate while the recorded
   run keeps another. `activePacks.spec.ts` therefore checks the call
   sites by reading the source, not just that this constant exists: a
   new surface resolving ke without spreading `ACTIVE_MARKET_PACKS` is
   the exact regression activation is supposed to close.
================================================================ */

import type { EquityBetaPack } from "./equityBetaPack";
import { INDIA_EQUITY_BETA_PACK } from "./indiaEquityBetaPack";
import { INDIA_MACRO_PACK } from "./indiaMacroPack";
import type { MacroPack } from "./macroPack";

/**
 * The packs production resolves against. Spread into the resolver or the
 * command center alongside an `analysisAsOf`:
 *
 * ```ts
 * resolveCostOfCapitalFromConfig({ config, ...ACTIVE_MARKET_PACKS, analysisAsOf: analysisAsOfToday() })
 * ```
 *
 * The beta pack is keyed by exchange ticker and looked up on
 * `config.ticker`, which AppShell sets from the ingested company id (the
 * registry ticker on the library path). A company outside the pack — a
 * manual upload with an arbitrary id — resolves no regressed beta and
 * falls back to the sector prior with a reason attached, which is the
 * pre-activation behaviour rather than an error.
 */
/**
 * What an engine module accepts so its caller can hand down the packs the run
 * is using, rather than resolving a second, unpinned rate of its own.
 *
 * Deliberately a *type* and not the packs: a sub-model must not import
 * `ACTIVE_MARKET_PACKS`. If it did, it would resolve production packs even when
 * a spec called it directly, and the supplied-never-inferred contract that makes
 * the resolver testable would be gone.
 */
export interface SuppliedMarketPacks {
  readonly macroPack?: MacroPack | null | undefined;
  readonly betaPack?: EquityBetaPack | null | undefined;
  readonly analysisAsOf?: string | null | undefined;
}

export const ACTIVE_MARKET_PACKS = {
  macroPack: INDIA_MACRO_PACK,
  betaPack: INDIA_EQUITY_BETA_PACK,
} as const;

/**
 * Today, as the date the pinned observations are measured against.
 *
 * Real wall-clock rather than a pinned constant, deliberately: an
 * observation past its staleness window has to resolve `unusable` and
 * fall back to a `prior`, which moves ke. That is the entire point of
 * dating the inputs, and pinning this would make the packs look
 * permanently fresh no matter how old they got.
 *
 * The cost is that a lapse changes app behaviour on a calendar date with
 * no commit behind it. `npm run lint:pack-freshness` fails in CI
 * `PACK_FRESHNESS_LEAD_DAYS` before that can happen, so the pack is
 * refreshed while it is still valid — see `packFreshness.ts`.
 *
 * Note what this is NOT, because `CoreBuildContext.analysisAsOf` argues the
 * other side and is right to: a *recorded* run must not date its inputs off
 * the clock, or the same run would report a different provenance tier
 * depending on when you replayed it. The executor accordingly passes
 * `metadata.asOf`, frozen when the run was created, and this function is not
 * used there. It is for live surfaces, which have no recorded as-of of their
 * own and are showing what the issuer is worth now.
 *
 * The residual: a surface always agrees with a *fresh* run, but a run stored
 * before an observation crossed its window will have kept the `sourced` tier
 * the surface no longer resolves. Closing that means threading the run's own
 * as-of (or its resolved ke) into the surfaces, which is a prop change across
 * TabRouter, not a change to this function.
 */
export function analysisAsOfToday(): string {
  return new Date().toISOString().slice(0, 10);
}
