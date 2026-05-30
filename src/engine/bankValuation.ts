/**
 * Bank Valuation Models — Phase B4 + Phase D2 (NBFC lenses)
 *
 * Banks cannot use Penman-Nissim's OA/FA reformulation (advances ARE the
 * operating asset; deposits ARE the operating liability). They need
 * equity-side models that price book value × profitability spread.
 *
 * Three core models implemented:
 *
 * 1. Justified P/B (Gordon Growth, on equity)
 *    fair_PB = (ROE_sustainable − g) / (ke − g)
 *    fair_value = fair_PB × latest_book_value
 *    Best for: stable mature banks (HDFC, Kotak)
 *    Breaks when: ROE < ke (value-destroying bank), ke ≤ g
 *
 * 2. Equity Residual Income
 *    V = BV_0 + Σ_t [(ROE_t − ke) × BV_{t-1}] / (1+ke)^t  +  TV / (1+ke)^N
 *    Where TV uses fade to long-run ROE.
 *    Best for: banks with documented ROE evolution
 *    Breaks when: <3 years of positive ROE history
 *
 * 3. Sustainable DDM
 *    V = expected_dividend / (ke − g)  with sustainability check:
 *    payout_ratio ≤ 1 − g/ROE   (otherwise growth is not self-funded)
 *    Best for: dividend-paying banks (PSU banks, mature private banks)
 *    Breaks when: payout_ratio unavailable or ROE ≤ g
 *
 * Phase D2 — NBFC-specific lenses (only fire when subtype is "nbfc"):
 *
 * 4. P/AUM (peer-anchored)
 *    fair_value = AUM × peer_implied_multiple
 *    Where multiple is derived from sustainable ROA: roa_to_paum = roa × 12-15
 *    Best for: NBFCs where AUM is the primary scale metric (Bajaj, Cholamandalam)
 *    Breaks when: aum_cr is missing from quality sidecar
 *
 * 5. ROA × Leverage three-stage RI
 *    Decomposes ROE into ROA × leverage and fades each separately.
 *    NBFCs revert ROA toward long-run-NBFC-ROA faster than they
 *    de-lever, so coupling them produces unrealistic valuations.
 *    Best for: NBFCs where leverage is a structural choice (Bajaj 4-5x)
 *
 * 6. CRAR governor (modifier, not standalone model)
 *    When CRAR headroom over RBI norm (15% for NBFC-UL) drops below
 *    300bps, growth must throttle because new advances need fresh capital.
 *    Adjusts effective g downward; affects all three core models.
 *
 * 7. Through-cycle credit-cost band
 *    Diagnostic: compares latest creditCost to trailing-7y median.
 *    Flags under-provisioning (post-Covid release) and stress peaks
 *    (FY18 IL&FS, FY20 Covid). Doesn't change valuation but is surfaced
 *    for the analyst.
 *
 * All lenses are skip-with-reason when prerequisites fail rather than
 * producing misleading numbers.
 */

export type {
  BankScenarioCard,
  ScenarioBundle,
  BankValuationStatus,
  BankValuationModelResult,
  CreditCostCycleCheck,
  SpreadCompressionCheck,
  CrarGovernorResult,
  EclStressGovernorResult,
  BankValuationBundle,
} from "./bankValuation/types";

export { computeBankValuation } from "./bankValuation/computeBankValuation";
export { buildBankScenarioBundle } from "./bankValuation/scenarios";
export { buildBankSOTP } from "./bankValuation/sotp";
