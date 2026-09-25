import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type EngineConfig, type RecastPeriod } from "../../engine/types";
import { CroreShares, INRAbsolute, PercentFraction } from "../../engine/types/units";
import { resolveShareBasis } from "../../engine/shareCountTools";
import {
  COMPANY_SCOPED_CONFIG_KEYS,
  replacesLoadedCompany,
  withCompanyScopedFieldsReset,
} from "../companyScopedConfig";

const COMPANY_A_CONFIG: EngineConfig = {
  ...DEFAULT_CONFIG,
  ticker: "TCS",
  risk_free_rate: 0.0685,
  shares_outstanding: CroreShares(361.8),
  market_price: INRAbsolute(3450),
  excluded_periods: ["2019-03-31"],
  ke: PercentFraction(0.115),
  cost_of_equity_mode: "manual",
  ke_manual_rationale: "TCS-specific beta study",
};

describe("withCompanyScopedFieldsReset", () => {
  it("drops the previous issuer's share count, price, exclusions and ke override", () => {
    const next = withCompanyScopedFieldsReset(COMPANY_A_CONFIG);
    expect(next.shares_outstanding).toBe(DEFAULT_CONFIG.shares_outstanding);
    expect(next.market_price).toBe(DEFAULT_CONFIG.market_price);
    expect(next.excluded_periods).toEqual(DEFAULT_CONFIG.excluded_periods);
    expect(next.ke).toBe(DEFAULT_CONFIG.ke);
    expect(next.cost_of_equity_mode).toBe(DEFAULT_CONFIG.cost_of_equity_mode);
    expect(next.ke_manual_rationale).toBe(DEFAULT_CONFIG.ke_manual_rationale);
  });

  it("keeps workspace-wide preferences", () => {
    const next = withCompanyScopedFieldsReset(COMPANY_A_CONFIG);
    expect(next.risk_free_rate).toBe(0.0685);
    expect(next.ticker).toBe("TCS");
  });

  it("is what stops a stale share count reaching the next company's per-share basis", () => {
    // resolveShareBasis treats any config share count as authoritative; the
    // reset is the only thing between company A's count and company B's value.
    // Company B's own filing reports 414.8 Cr shares.
    const companyB = [{ period_end: "2025-03-31", shareCountInput: { endPeriodShares: 414.8 } }] as unknown as RecastPeriod[];
    const stale = resolveShareBasis(companyB, COMPANY_A_CONFIG);
    expect(stale.sharesForPerShare).toBe(361.8);
    const reset = resolveShareBasis(companyB, withCompanyScopedFieldsReset(COMPANY_A_CONFIG));
    expect(reset.source).not.toBe("Config: shares_outstanding");
    expect(reset.sharesForPerShare).not.toBe(361.8);
  });

  it("lists each key once (the `satisfies` clause pins them to EngineConfig)", () => {
    expect(new Set(COMPANY_SCOPED_CONFIG_KEYS).size).toBe(COMPANY_SCOPED_CONFIG_KEYS.length);
  });
});

describe("replacesLoadedCompany", () => {
  it("is true only when a different issuer was already loaded", () => {
    expect(replacesLoadedCompany("TCS", "INFY")).toBe(true);
    expect(replacesLoadedCompany("TCS", "TCS")).toBe(false);
    // First load: whatever is in the scoped fields was typed for this company.
    expect(replacesLoadedCompany(null, "TCS")).toBe(false);
    expect(replacesLoadedCompany("TCS", null)).toBe(false);
  });
});
