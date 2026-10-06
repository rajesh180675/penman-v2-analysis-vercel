/**
 * A lending arm carved out of its parent (src/engine/lendingArm) leaves the
 * parent's stake in it, at the arm's own value, on the anchor balance sheet.
 * Every equity value adds it exactly once; nothing that prices the industrial
 * business — its operating value, its kw — sees it.
 */
import { describe, expect, it } from "vitest";
import { computeValuation } from "../PenmanNissimEngine";
import { computeConsistentValuation } from "../valueConsistentKw";
import type { LegacyValuationPeriodInput } from "../forecastState/legacyAdapter";
import { DEFAULT_CONFIG } from "../types";

const KE = 0.13;
const KD = 0.06;
const G = 0.04;
const STAKE = 900;
const config = { ...DEFAULT_CONFIG, shares_outstanding: 100 };

function forecast(stake: number | undefined): LegacyValuationPeriodInput[] {
  const periods: LegacyValuationPeriodInput[] = [{
    period_end: "2025-03-31",
    bs: { CSE: 800, NOA: 1_200, NFO: 300, MI: 100, separationScore: 90, ...(stake != null ? { CarvedArmStakeValue: stake } : {}) },
    is: { CNI: 140, OI: 180, MII: 12 },
    cf: { DividendPaid: 40, d_t: 40 },
  }];
  let { NOA: noa, CSE: cse, MI: mi } = periods[0]!.bs;
  const nfo = 300;
  for (let t = 1; t <= 5; t += 1) {
    const oi = 0.16 * noa;
    const mii = 0.08 * oi;
    const cni = oi - KD * nfo - mii;
    const nextNoa = noa * 1.06;
    const nextMi = mi * 1.06;
    const nextCse = nextNoa - nfo - nextMi;
    periods.push({
      period_end: `${2025 + t}-03-31`,
      bs: { CSE: nextCse, NOA: nextNoa, NFO: nfo, MI: nextMi, separationScore: 90 },
      is: { CNI: cni, OI: oi, MII: mii },
      cf: { DividendPaid: Math.max(0, cni - (nextCse - cse)), d_t: cni - (nextCse - cse) },
    });
    noa = nextNoa;
    cse = nextCse;
    mi = nextMi;
  }
  return periods;
}

describe("the carved lending-arm stake in computeValuation", () => {
  const without = computeValuation(forecast(undefined), KE, 0.11, G, config);
  const withStake = computeValuation(forecast(STAKE), KE, 0.11, G, config);

  it("adds the stake once to every equity value", () => {
    expect(withStake.carvedArmStake).toBe(STAKE);
    expect(without.carvedArmStake).toBe(0);
    for (const key of ["V_RE_CV1", "V_RE_CV2", "V_RE_CV3", "V_ReOI_CV01", "V_ReOI_CV02", "V_ReOI_CV03", "V_no_growth"] as const) {
      expect(withStake[key]! - without[key]!).toBeCloseTo(STAKE, 9);
    }
    expect(withStake.fcf.V_FCFF_equity! - without.fcf.V_FCFF_equity!).toBeCloseTo(STAKE, 9);
    expect(withStake.fcf.V_FCFE! - without.fcf.V_FCFE!).toBeCloseTo(STAKE, 9);
    expect(withStake.ddm.V_DDM! - without.ddm.V_DDM!).toBeCloseTo(STAKE, 9);
    expect(withStake.aeg.V_AEG - without.aeg.V_AEG).toBeCloseTo(STAKE, 9);
    for (const key of ["intrinsic_re_per_share", "intrinsic_reoi_per_share", "intrinsic_fcff_per_share", "intrinsic_fcfe_per_share", "intrinsic_ddm_per_share", "intrinsic_aeg_per_share"] as const) {
      expect(withStake.perShare![key]! - without.perShare![key]!).toBeCloseTo(STAKE / 100, 9);
    }
  });

  it("leaves the industrial business's own measures alone", () => {
    expect(withStake.EV_ReOI).toBeCloseTo(without.EV_ReOI!, 9);
    expect(withStake.growthValue).toBeCloseTo(without.growthValue!, 9);
    // Implied multiples are the industrial claim's, on its own book and earnings.
    expect(withStake.perShare!.implied_pb_re).toBeCloseTo(without.perShare!.implied_pb_re!, 9);
    expect(withStake.perShare!.implied_pe_re).toBeCloseTo(without.perShare!.implied_pe_re!, 9);
  });

  it("does not move the value-consistent kw: the stake is no claim on NOA", () => {
    const a = computeConsistentValuation(forecast(undefined), KE, 0.11, G, config, KD);
    const b = computeConsistentValuation(forecast(STAKE), KE, 0.11, G, config, KD);
    expect(a.kwConsistency.method).toBe("value-consistent");
    expect(b.kwConsistency.kw).toBeCloseTo(a.kwConsistency.kw, 12);
    expect(b.valuation.V_ReOI_CV03! - a.valuation.V_ReOI_CV03!).toBeCloseTo(STAKE, 6);
  });
});
