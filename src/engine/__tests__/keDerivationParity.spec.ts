/* ================================================================
   ke derivation parity — the two paths, pinned.

   The engine derives a cost of equity twice. The capital-cost resolver
   is what the run, the valuation command center, the bank models, the
   Excel exports, the baseline guardrails and — since the call-site
   unification below — all five report surfaces use. `ke_from_config`
   (types/config.ts) is now internal to that module. Its remaining callers are
   `validateEngineConfig`, which DataEntry renders as config warnings,
   and `deriveKwFromConfig`, which has no production caller left at all
   (noted, not removed — deleting a live export is not this change).

   They agree, and the agreement is a coincidence of constants, not a
   shared implementation: both compute `rf + sectorBeta × erp` off the
   same config fields. Nothing enforced it, so either could have been
   edited alone and the app would have printed one discount rate while
   the run recorded another — an S-9.4C violation that no test would
   have caught. The blast radius is smaller now that the report
   surfaces are off this path, but a divergence would still make the
   config-warning panel disagree with every number the run produces.

   This spec is that enforcement. It is deliberately arithmetic-free:
   it asserts the two functions return the same number, never what
   that number should be, so a legitimate change to the CAPM formula
   passes as long as it is made in both places (or, better, in one).
================================================================ */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  ke_from_config,
  SECTOR_BETAS,
  type CompanyType,
  type EngineConfig,
} from "../types";
import { PercentFraction } from "../types/units";
import { resolveCostOfCapitalFromConfig } from "../costOfCapital";
import { INDIA_MACRO_PACK } from "../marketPacks/indiaMacroPack";

const COMPANY_TYPES = Object.keys(SECTOR_BETAS) as CompanyType[];

function resolved(config: EngineConfig): number {
  return resolveCostOfCapitalFromConfig({ config }).ke;
}

describe("ke derivation parity", () => {
  it("covers every company type in the sector table", () => {
    // Guards the loop below: a new CompanyType must not silently skip parity.
    expect(COMPANY_TYPES.length).toBe(12);
  });

  it.each(COMPANY_TYPES)("agrees for company_type=%s", (companyType) => {
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: companyType };
    expect(resolved(config)).toBeCloseTo(ke_from_config(config), 12);
  });

  it("agrees on non-default rf and erp", () => {
    // Default rf 7% + erp 6% × beta 1.00 happens to equal the default scalar
    // ke of 13%, so parity at defaults proves less than it looks. Move both
    // inputs off their defaults and pick a type whose beta is not 1.00.
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      risk_free_rate: 0.055,
      equity_risk_premium: 0.085,
      company_type: "it-services",
    };
    expect(resolved(config)).toBeCloseTo(ke_from_config(config), 12);
  });

  it("agrees on a reviewer-supplied explicit beta", () => {
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "it-services", beta: 1.23 };
    expect(resolved(config)).toBeCloseTo(ke_from_config(config), 12);
  });

  it("agrees in manual mode with a usable ke", () => {
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      cost_of_equity_mode: "manual",
      ke: PercentFraction(0.155),
    };
    expect(resolved(config)).toBeCloseTo(ke_from_config(config), 12);
  });

  it("agrees when a stray scalar ke sits in a capm-mode config", () => {
    // Both paths must ignore it. This is the case a reviewer can actually
    // reach: ConfigSection writes `config.ke`, and the app never sets
    // `cost_of_equity_mode`, so it stays "capm" and the typed value is not
    // the discount rate. See AssumptionsAudit, which now says so.
    const config: EngineConfig = { ...DEFAULT_CONFIG, ke: PercentFraction(0.18) };
    expect(resolved(config)).toBeCloseTo(ke_from_config(config), 12);
    expect(resolved(config)).not.toBeCloseTo(0.18, 6);
  });
});

/* ── Known divergences ────────────────────────────────────────────
   These are recorded, not endorsed. Each is unreachable from the
   running app today; pinning them means a future change that makes
   one reachable shows up here as a failing expectation rather than
   as two surfaces quietly disagreeing.
────────────────────────────────────────────────────────────────── */
describe("ke derivation: known divergences", () => {
  it("splits on a legacy config with no cost_of_equity_mode", () => {
    // `ke_from_config` honours a positive scalar ke when the mode field is
    // absent (pre-mode configs); the resolver treats anything that is not
    // explicitly "manual" as capm. DEFAULT_CONFIG pins the mode, and no
    // persistence path strips it, so this shape is not constructible in the
    // app — only in a test or a hand-edited fixture.
    const { cost_of_equity_mode: _mode, ...noMode } = DEFAULT_CONFIG;
    const legacy = { ...noMode, ke: PercentFraction(0.16) } as EngineConfig;

    expect(ke_from_config(legacy)).toBeCloseTo(0.16, 12);
    expect(resolved(legacy)).toBeCloseTo(0.13, 12);
  });

  it("splits on manual mode with a non-positive ke, and the resolver fails closed", () => {
    // `ke_from_config` silently substitutes CAPM. The resolver returns the
    // reviewer's number and blocks on it, which is the behaviour the
    // fail-closed principle asks for: a zero discount rate is not quietly
    // replaced with a plausible one.
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      cost_of_equity_mode: "manual",
      ke: PercentFraction(0),
    };
    const result = resolveCostOfCapitalFromConfig({ config });

    expect(ke_from_config(config)).toBeCloseTo(0.13, 12);
    expect(result.ke).toBe(0);
    expect(result.status).toBe("blocked");
    expect(result.guards.find((g) => g.guardId === "ke-plausibility")?.status).toBe("failed");
  });
});

/* ── The pack gap, now closed ─────────────────────────────────────
   The packs are no longer inert. `ACTIVE_MARKET_PACKS` is supplied at
   every call site whose rate a reviewer reads, so the run and the
   surfaces resolve the same pinned ke.

   What this block still pins is the mechanism that made the gap
   possible, because it has not changed and cannot be tested from the
   activation side: a pack reaches the resolver only as an argument, so
   a caller that omits it silently derives the unpinned rate. That is
   why forgetting a pack is invisible rather than loud, and it is why
   the census in `marketPacks/__tests__/activePacks.spec.ts` checks the
   call sites by name — behaviour alone cannot see a missing argument.

   These assertions therefore read as "omitting the pack still changes
   the number", which is the premise the census depends on. If they ever
   stop holding, the census is asserting nothing.
────────────────────────────────────────────────────────────────── */
describe("ke derivation: pinned pack", () => {
  it("moves the resolver away from a pack-less derivation of the same config", () => {
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "it-services" };
    const withPack = resolveCostOfCapitalFromConfig({
      config,
      macroPack: INDIA_MACRO_PACK,
      analysisAsOf: "2026-07-27",
    });

    // A pack reaches the resolver only as an argument, so any caller that
    // omits it derives a different number from the same config — here by
    // ~74bp, and by 47-133bp across the sector table. `ke_from_config` stands
    // in for that pack-less derivation because it is exactly what a
    // `{ config }`-only call reduces to (proven by the parity block above),
    // and it cannot take a pack at all.
    //
    // Production now supplies the packs, so this is no longer a gap waiting to
    // be closed — it is the reason the gap was invisible while it existed, and
    // the reason the census exists. Do not "fix" this by making the two agree:
    // if omitting a pack stopped changing the number, a call site that forgot
    // one would be indistinguishable from one that did not.
    expect(Math.abs(withPack.ke - ke_from_config(config))).toBeGreaterThan(0.001);
    expect(Math.abs(withPack.ke - resolveCostOfCapitalFromConfig({ config }).ke)).toBeGreaterThan(0.001);

    // The pack is what earns the sourced tiers; beta stays a prior because
    // no beta pack or peer set was supplied here.
    expect(withPack.assumptions?.riskFreeRate.tier).toBe("sourced");
    expect(withPack.assumptions?.equityRiskPremium.tier).toBe("sourced");
    expect(withPack.assumptions?.beta.tier).toBe("prior");
  });
});
