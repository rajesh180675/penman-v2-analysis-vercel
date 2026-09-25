import { DEFAULT_CONFIG, type EngineConfig } from "../engine/types";
import { resolveFolderFromSymbol, resolveNseSymbol } from "../engine/nseSymbolRegistry";

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

/**
 * The config after a dataset for `companyId` is submitted — the whole
 * transition handleDataSubmit applies, kept pure so it is testable.
 *
 * Issuer-scoped values belong to the company being replaced, so they reset
 * when a DIFFERENT loaded issuer is replaced. The NSE symbol and quality-data
 * folder are re-resolved for a new ticker so manual uploads (which skip the
 * library grid) still get sidecar and live-price wiring.
 */
export function configForSubmittedCompany(
  current: EngineConfig,
  params: { companyId: string | null; loadedCompanyId: string | null },
): EngineConfig {
  const prev = replacesLoadedCompany(params.loadedCompanyId, params.companyId)
    ? withCompanyScopedFieldsReset(current)
    : current;
  const companyId = params.companyId || prev.ticker;
  const isDifferentCompany = companyId !== prev.ticker;
  const resolvedSymbol = (isDifferentCompany ? null : prev.market_data_symbol) ?? resolveNseSymbol(companyId) ?? null;
  const resolvedFolder = (isDifferentCompany ? null : prev.quality_data_folder) ?? resolveFolderFromSymbol(companyId) ?? companyId;
  return {
    ...prev,
    ticker: companyId,
    market_data_symbol: resolvedSymbol ?? undefined,
    quality_data_folder: resolvedFolder,
  };
}
