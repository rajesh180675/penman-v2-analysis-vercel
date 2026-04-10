import { CompanyRegistry } from "../../engine/types";
import { buildValuationTraceabilitySurfaceSummary } from "../../engine/valuationTraceabilitySummary";

function compareTrustRank(a: string | null | undefined, b: string | null | undefined) {
  const rank = (value: string | null | undefined) =>
    value === "blocked" ? 0
      : value === "guarded" ? 1
      : value === "warning" ? 2
      : value === "production-ready" ? 3
      : -1;
  return rank(a) - rank(b);
}

export interface ComparisonPublicationSnapshot {
  weakestCompanyId: string | null;
  weakestCompanyLabel: string | null;
  missingTraceabilityCount: number;
  blockedCount: number;
  guardedCount: number;
  productionReadyCount: number;
  weakestSummary: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null;
  comparisonSummary: ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null;
  companySummaries: Record<string, ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null>;
}

export function buildComparisonPublicationSnapshot(registry: CompanyRegistry): ComparisonPublicationSnapshot {
  const companies = Object.values(registry.companies).filter((c) => c.recastData.length > 0);
  const companiesWithTraceability = companies.filter((company) => company.traceability);
  const weakestCompany = companiesWithTraceability
    .slice()
    .sort((left, right) => compareTrustRank(left.traceability?.confidence.status ?? null, right.traceability?.confidence.status ?? null))[0] ?? null;

  const companySummaries = Object.fromEntries(
    companies.map((company) => [company.id, buildValuationTraceabilitySurfaceSummary(company.traceability ?? null)])
  ) as Record<string, ReturnType<typeof buildValuationTraceabilitySurfaceSummary> | null>;
  const weakestSummary = buildValuationTraceabilitySurfaceSummary(weakestCompany?.traceability ?? null);
  const missingTraceabilityCount = companies.length - companiesWithTraceability.length;
  const blockedCount = companies.filter((company) => company.traceability?.confidence.status === "blocked").length;
  const guardedCount = companies.filter((company) => company.traceability?.confidence.status === "guarded").length;
  const productionReadyCount = companies.length - blockedCount - guardedCount;

  const comparisonSummary = weakestSummary
    ? {
        ...weakestSummary,
        headline: `Peer comparison inherits the weakest company trust state: ${weakestCompany?.label || weakestCompany?.id}`,
        detail: missingTraceabilityCount > 0
          ? `${missingTraceabilityCount} loaded peer(s) do not have persisted traceability yet, so comparison output should be treated as incomplete until each company has been processed in the current rigor-aware flow.`
          : `${blockedCount} blocked / ${guardedCount} guarded / ${productionReadyCount} production-ready peers are currently loaded. Review the per-company trust table before using cross-sectional rankings or upside ordering.`,
        blockers: Array.from(
          new Set(
            [
              missingTraceabilityCount > 0
                ? `${missingTraceabilityCount} peer(s) are missing persisted traceability and therefore do not disclose parser or reconciliation confidence yet.`
                : null,
              ...weakestSummary.blockers,
            ].filter((item): item is string => Boolean(item))
          )
        ).slice(0, 3),
      }
    : null;

  return {
    weakestCompanyId: weakestCompany?.id ?? null,
    weakestCompanyLabel: weakestCompany?.label ?? weakestCompany?.id ?? null,
    missingTraceabilityCount,
    blockedCount,
    guardedCount,
    productionReadyCount,
    weakestSummary,
    comparisonSummary,
    companySummaries,
  };
}
