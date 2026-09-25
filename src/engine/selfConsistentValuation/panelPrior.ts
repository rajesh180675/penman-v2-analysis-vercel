import { PANEL_PERSISTENCE_PRIORS, PERSISTENCE_PRIORS_AS_OF } from "./persistencePriors.generated";
import type { PanelPriorInput } from "./types";

/**
 * The panel persistence estimate for a company type, falling back to the
 * pooled "all" estimate for types without their own (fewer than 3 companies
 * or 20 year-pairs in the panel).
 */
export function panelPersistencePriorFor(companyType: string | null | undefined): PanelPriorInput | null {
  const own = companyType ? PANEL_PERSISTENCE_PRIORS[companyType] : undefined;
  const group = own ? companyType! : "all";
  const prior = own ?? PANEL_PERSISTENCE_PRIORS.all;
  return prior ? { group, phi: prior.phi, companies: prior.companies, asOf: PERSISTENCE_PRIORS_AS_OF } : null;
}
