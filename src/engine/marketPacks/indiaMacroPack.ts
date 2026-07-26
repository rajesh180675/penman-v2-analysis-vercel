/**
 * The pinned India macro pack — actual published observations, dated and
 * attributed.
 *
 * `macroPack.ts` defines the container and its staleness rules. This file is
 * the first pack with real data in it, which is what turns the provenance tier
 * from a mechanism into a claim.
 *
 * SOURCING RULES FOR WHOEVER REFRESHES THIS
 * 1. Every value is a decimal fraction. 6.82% is `0.0682`, never `6.82`.
 *    `PLAUSIBLE_RANGE` in macroPack.ts rejects the second form, but do not rely
 *    on that to catch a typo.
 * 2. `asOf` is the date the number was *observed or published*, not the date
 *    you edited this file. Backdating or forward-dating an observation defeats
 *    both the staleness window and the look-ahead guard.
 * 3. `source` must name where the number actually came from, at the precision
 *    a reviewer could re-fetch it. "RBI G-Sec close" when the figure came from
 *    an aggregator is a false attribution, and a false attribution is worse
 *    than a `prior` — a prior is at least honest about being a default.
 * 4. If you cannot source a field, leave it `null`. It will resolve as `prior`
 *    with a stated reason, which is the designed behaviour, not a failure.
 *
 * WHY LONG-RUN NOMINAL GROWTH IS NULL
 * The other two are published observations someone else computed and stands
 * behind. A "long-run nominal growth" ceiling is a structural judgment, not an
 * observation — IMF and RBI publish medium-term projections, but picking one
 * and calling it the perpetual ceiling would be my view wearing a citation.
 * Left null deliberately: the terminal-growth ceiling continues to resolve as
 * `prior` against `g_terminal_cap`, and says so.
 */

import type { MacroPack } from "./macroPack";

/**
 * Which ERP estimate this pack uses, and why.
 *
 * Damodaran publishes two India figures in the same table: a ratings-based
 * total ERP of 7.08% (4.23% mature-market + 2.85% country premium, off a
 * Moody's Baa3 rating and a 1.87% adjusted default spread), and a CDS-based
 * alternative of 5.23% (0.66% sovereign CDS). That is a 185bp spread on the
 * single most leveraged input in the system.
 *
 * This pack takes the ratings-based figure because it is the one Damodaran
 * presents as the headline country-premium estimate and the one most valuation
 * practice cites. The CDS variant is not wrong — it is arguably more
 * market-current — and a reviewer who prefers it should override the pack
 * rather than edit this constant, so the choice stays visible in the run.
 */
export const INDIA_ERP_BASIS = "ratings-based" as const;

/**
 * Currency-consistency note, because this is the classic way to get CAPM wrong.
 *
 * The risk-free rate below is a rupee nominal yield. The ERP is built from a
 * mature-market premium plus an India country premium, which is the
 * construction Damodaran intends to be paired with a local-currency risk-free
 * rate. So `rf(INR) + beta x (mature ERP + CRP)` is coherent as written. What
 * would NOT be coherent is pairing this ERP with a USD risk-free rate, or
 * adding a separate inflation-differential adjustment on top — that
 * double-counts the country risk already inside the 2.85%.
 */
export const INDIA_MACRO_PACK: MacroPack = {
  asOf: "2026-07-26",
  riskFreeRate: {
    // India 10-year benchmark G-Sec. Cross-checked against two other reports
    // of the same series in the same window (6.76% at 2026-06-30, 6.72% at
    // 2026-07-10), so this is the series level, not a stray print.
    value: 0.0682,
    asOf: "2026-07-24",
    source: "India 10Y benchmark G-Sec yield, per Trading Economics (tradingeconomics.com/india/government-bond-yield)",
  },
  equityRiskPremium: {
    // 4.23% mature-market ERP + 2.85% India country risk premium.
    value: 0.0708,
    asOf: "2026-01-05",
    source: "Damodaran country risk premiums, January 2026 update: 4.23% mature-market ERP + 2.85% India CRP (Moody's Baa3), ratings-based basis (pages.stern.nyu.edu/~adamodar)",
  },
  longRunNominalGrowth: null,
};
