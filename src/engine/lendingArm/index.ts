import { valBS } from "../PenmanNissimEngine/picking";
import type { SuppliedMarketPacks } from "../marketPacks/activePacks";
import type { SegmentData } from "../segmentParser";
import type { EngineConfig, LendingArmPeriod, RawPeriodData, RecastPeriod } from "../types";
import { valueArmStake, type ArmStakeValuation } from "./armValuation";
import { carveOutLendingArm, type ArmInsuranceLines } from "./carveOut";
import { findLendingArmLink, type LendingArmLink } from "./links";

export { LENDING_ARM_LINKS, findLendingArmLink, type LendingArmLink, type ArmFiling } from "./links";
export { carveOutLendingArm, usableArmFilings, type LendingArmCarveOut, type ArmInsuranceLines } from "./carveOut";
export { valueArmStake, type ArmStakeValuation } from "./armValuation";

/** What a run did with its lending arm, for the envelope and the valuation surfaces. */
export type LendingArmReport =
  | {
    readonly status: "applied";
    readonly link: Pick<LendingArmLink, "parentTicker" | "segmentName" | "arm" | "stake">;
    readonly arm: readonly LendingArmPeriod[];
    readonly stake: readonly ArmStakeValuation[];
    readonly droppedPeriods: readonly string[];
    readonly notes: readonly string[];
  }
  | { readonly status: "not-applied"; readonly link: Pick<LendingArmLink, "parentTicker" | "segmentName" | "arm" | "stake">; readonly reason: string };

/** The segment set without one segment: what a SOTP sums once that segment is carved out. */
export function withoutSegment(segmentData: SegmentData, segmentName: string): SegmentData {
  const { [segmentName]: _carved, ...data } = segmentData.data;
  return { ...segmentData, segments: segmentData.segments.filter((name) => name !== segmentName), data };
}

/**
 * The parent's insurance lines per period end (see ArmInsuranceLines): the
 * life insurer's investments and the insurance liabilities, read from the
 * same labels the recast maps (mappingSpec: policyholderFunds,
 * otherNonCurrentLiabilities).
 */
export function readArmInsuranceLines(rawData: readonly RawPeriodData[]): Map<string, ArmInsuranceLines> {
  return new Map(rawData.map((raw) => [raw.period_end, {
    investments: valBS(raw, ["Investments of Life Insurance Business"]),
    liabilities: valBS(raw, ["Insurance Related Liabilities"]) + valBS(raw, ["Insurance Related Liabilities - Current"]),
  }]));
}

/**
 * Carve a linked lending arm out of an industrial run and carry the parent's
 * stake in it, at the arm's own valuation, on every carved balance sheet.
 * Null when the ticker has no linked arm; a report saying why when the arm's
 * data cannot carve the run, in which case the consolidated periods stand.
 */
export function applyLendingArmCarveOut(params: {
  readonly ticker: string | null | undefined;
  readonly periods: readonly RecastPeriod[];
  readonly rawData: readonly RawPeriodData[];
  readonly segmentData: SegmentData | null;
  readonly config: EngineConfig;
  readonly packs?: SuppliedMarketPacks | undefined;
  /** The run's as-of date: an arm filing published after it is not read. */
  readonly asOf?: string | null | undefined;
}): { readonly periods: RecastPeriod[]; readonly report: LendingArmReport } | null {
  const link = findLendingArmLink(params.ticker);
  if (!link) return null;
  const linkSummary = { parentTicker: link.parentTicker, segmentName: link.segmentName, arm: link.arm, stake: link.stake };
  const carve = carveOutLendingArm({
    periods: params.periods,
    segmentData: params.segmentData,
    link,
    insuranceLines: readArmInsuranceLines(params.rawData),
    config: params.config,
    asOf: params.asOf ?? null,
  });
  if (carve.status === "not-applied") {
    return { periods: [...params.periods], report: { status: "not-applied", link: linkSummary, reason: carve.reason } };
  }
  const stake = valueArmStake({ arm: carve.arm, link, packs: params.packs, asOf: params.asOf ?? null });
  const periods = carve.periods.map((period, i) => ({ ...period, bs: { ...period.bs, CarvedArmStakeValue: stake[i]!.stakeValue } }));
  return {
    periods,
    report: { status: "applied", link: linkSummary, arm: carve.arm, stake, droppedPeriods: carve.droppedPeriods, notes: carve.notes },
  };
}
