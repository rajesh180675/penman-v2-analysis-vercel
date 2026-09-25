import { DEFAULT_CONFIG, type EngineConfig } from "../engine/types";

/**
 * Config fields whose values describe ONE issuer.
 *
 * EngineConfig is a single workspace-wide object, so every one of these used to
 * survive a company switch: the library loader and handleDataSubmit spread
 * `...config` and replaced only ticker/symbol/folder. The share-count auto-fill
 * then skipped (a value was already set), and resolveShareBasis reported the
 * previous company's count as "Config: shares_outstanding, HIGH confidence" —
 * dividing the new company's equity by someone else's shares. A carried
 * `excluded_periods` silently dropped the new company's periods that happened
 * to share those dates, and a manual ke/beta/kd with its rationale kept
 * pricing the new issuer at the old one's cost of capital.
 *
 * Workspace-wide preferences (risk-free rate, ERP, tax mode, thresholds,
 * provider choice) are deliberately absent: they are not issuer facts.
 */
export const COMPANY_SCOPED_CONFIG_KEYS = [
  "shares_outstanding",
  "market_price",
  "market_data_instrument_key",
  "excluded_periods",
  "ke",
  "cost_of_equity_mode",
  "ke_manual_rationale",
  "ke_evidence_refs",
  "beta",
  "equity_weight",
  "kd_pretax",
  "cost_of_debt_mode",
  "kd_manual_rationale",
  "kd_evidence_refs",
  "credit_spread",
  "credit_spread_as_of",
  "g_terminal_override",
  "mixed_conglomerate_route_to",
  "insurance_vnb_multiple",
  "insurance_ev_multiple",
  "sotp_preset",
  "ev_ebitda_peers",
] as const satisfies readonly (keyof EngineConfig)[];

function resetKey<K extends keyof EngineConfig>(config: EngineConfig, key: K): void {
  config[key] = DEFAULT_CONFIG[key];
}

/** Restore every issuer-scoped field to its default, keeping workspace preferences. */
export function withCompanyScopedFieldsReset(config: EngineConfig): EngineConfig {
  const next: EngineConfig = { ...config };
  for (const key of COMPANY_SCOPED_CONFIG_KEYS) resetKey(next, key);
  return next;
}

/**
 * Whether loading `nextCompanyId` replaces a DIFFERENT, already-loaded issuer.
 *
 * Only then are the scoped fields stale. On a first load there is no previous
 * issuer, and anything in those fields was typed for the company being
 * uploaded — resetting would erase it.
 */
export function replacesLoadedCompany(
  loadedCompanyId: string | null | undefined,
  nextCompanyId: string | null | undefined,
): boolean {
  return Boolean(loadedCompanyId) && Boolean(nextCompanyId) && loadedCompanyId !== nextCompanyId;
}
