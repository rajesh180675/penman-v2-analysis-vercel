/* ================================================================
   ke derivation parity — the two paths, pinned.

   The engine derives a cost of equity twice. `ke_from_config`
   (types/config.ts) is what five UI surfaces call; the capital-cost
   resolver is what the run, the valuation command center, the bank
   models, the Excel exports and the baseline guardrails use.

   Today they agree, and the agreement is a coincidence of constants,
   not a shared implementation: both compute `rf + sectorBeta × erp`
   off the same config fields. Nothing enforced it, so either could
   have been edited alone and the app would have printed one discount
   rate while the run recorded another — an S-9.4C violation that no
   test would have caught.

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

/* ── The pack tripwire ────────────────────────────────────────────
   This is the reason #46 exists and why the pinned packs are wired
   but inert.
────────────────────────────────────────────────────────────────── */
describe("ke derivation: pinned pack", () => {
  it("moves the resolver away from ke_from_config, which cannot see a pack", () => {
    const config: EngineConfig = { ...DEFAULT_CONFIG, company_type: "it-services" };
    const withPack = resolveCostOfCapitalFromConfig({
      config,
      macroPack: INDIA_MACRO_PACK,
      analysisAsOf: "2026-07-27",
    });

    // `ke_from_config` takes only a config, so there is no argument by which
    // a pack could reach it. Supplying one to the resolver therefore splits
    // the two paths — here by ~74bp, and by 47–133bp across the sector table.
    // Any surface still calling `ke_from_config` would print the unpinned
    // rate while the run recorded the pinned one.
    //
    // So: before a production caller supplies a pack, the five surfaces
    // listed at the top of this file must read the resolved ke instead.
    // If a future change makes these agree, this expectation fails, and
    // that failure is the signal that activation is safe — read it as a
    // prompt to delete this test, not to loosen it.
    expect(Math.abs(withPack.ke - ke_from_config(config))).toBeGreaterThan(0.001);

    // The pack is what earns the sourced tiers; beta stays a prior because
    // no beta pack or peer set was supplied here.
    expect(withPack.assumptions?.riskFreeRate.tier).toBe("sourced");
    expect(withPack.assumptions?.equityRiskPremium.tier).toBe("sourced");
    expect(withPack.assumptions?.beta.tier).toBe("prior");
  });
});
