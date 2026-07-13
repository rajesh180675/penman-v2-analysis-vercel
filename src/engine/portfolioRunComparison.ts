export const PORTFOLIO_RUN_COMPARISON_SCHEMA_VERSION = "2026-07-portfolio-run-comparison-v1" as const;

export interface PortfolioRunCandidate {
  readonly issuerId: string;
  readonly label: string;
  readonly family: string;
  readonly runId: string;
  readonly reproducibilityHash: string;
  readonly runSchemaVersion: string;
  readonly policyBundleHash: string;
  readonly asOf: string;
  readonly status: "completed" | "blocked" | "failed" | "running";
  readonly confidence: "production-ready" | "guarded" | "blocked" | string;
  readonly rangeEligible: boolean;
  readonly lowPerShare: number | null;
  readonly midPerShare: number | null;
  readonly highPerShare: number | null;
  readonly opportunityScore: number | null;
  readonly qualityScore: number | null;
  readonly expectedCagrStress: number | null;
}

export interface PortfolioComparisonPolicy {
  readonly maximumAsOfSkewDays: number;
  readonly requireSameRunSchema: boolean;
  readonly requireSamePolicyBundle: boolean;
  readonly maximumIssuerWeight: number;
  readonly maximumFamilyWeight: number;
}

export interface PortfolioRunComparisonRow extends PortfolioRunCandidate {
  readonly comparable: boolean;
  readonly exclusionCodes: readonly string[];
  readonly uncertaintyWidthRatio: number | null;
  readonly score: number | null;
  readonly targetWeight: number;
}

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

function stableMode(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

export function buildPortfolioRunComparison(
  candidates: readonly PortfolioRunCandidate[],
  policy: PortfolioComparisonPolicy,
): { readonly schemaVersion: typeof PORTFOLIO_RUN_COMPARISON_SCHEMA_VERSION; readonly status: "comparable" | "guarded" | "blocked"; readonly rows: readonly PortfolioRunComparisonRow[]; readonly residualCashWeight: number; readonly summary: string } {
  const policyValid = Number.isInteger(policy.maximumAsOfSkewDays) && policy.maximumAsOfSkewDays >= 0
    && Number.isFinite(policy.maximumIssuerWeight) && policy.maximumIssuerWeight >= 0 && policy.maximumIssuerWeight <= 1
    && Number.isFinite(policy.maximumFamilyWeight) && policy.maximumFamilyWeight >= 0 && policy.maximumFamilyWeight <= 1;
  const completedDates = candidates.filter((candidate) => candidate.status === "completed").map((candidate) => Date.parse(candidate.asOf)).filter(Number.isFinite);
  const anchor = completedDates.length ? Math.max(...completedDates) : Number.NaN;
  const completed = candidates.filter((candidate) => candidate.status === "completed");
  const schema = stableMode(completed.map((candidate) => candidate.runSchemaVersion));
  const policyHash = stableMode(completed.map((candidate) => candidate.policyBundleHash));
  const issuerCounts = new Map<string, number>();
  for (const candidate of candidates) issuerCounts.set(candidate.issuerId, (issuerCounts.get(candidate.issuerId) ?? 0) + 1);
  const preliminary = candidates.map((candidate) => {
    const exclusionCodes: string[] = [];
    if (!policyValid) exclusionCodes.push("COMPARISON_POLICY_INVALID");
    if (candidate.status !== "completed") exclusionCodes.push("RUN_NOT_COMPLETED");
    if ((issuerCounts.get(candidate.issuerId) ?? 0) > 1) exclusionCodes.push("DUPLICATE_ISSUER_RUN");
    if (candidate.confidence !== "production-ready" && candidate.confidence !== "guarded") exclusionCodes.push("TRUST_NOT_ELIGIBLE");
    if (!candidate.rangeEligible) exclusionCodes.push("RANGE_NOT_ELIGIBLE");
    if (![candidate.lowPerShare, candidate.midPerShare, candidate.highPerShare].every(finite)) exclusionCodes.push("VALUATION_RANGE_INCOMPLETE");
    else if (!(candidate.lowPerShare! > 0 && candidate.lowPerShare! <= candidate.midPerShare! && candidate.midPerShare! <= candidate.highPerShare!)) exclusionCodes.push("VALUATION_RANGE_INVALID");
    if (![candidate.opportunityScore, candidate.qualityScore, candidate.expectedCagrStress].every(finite)) exclusionCodes.push("RANKING_EVIDENCE_INCOMPLETE");
    const asOfMs = Date.parse(candidate.asOf);
    if (!Number.isFinite(asOfMs) || (Number.isFinite(anchor) && (anchor - asOfMs) / 86_400_000 > policy.maximumAsOfSkewDays)) exclusionCodes.push("AS_OF_NOT_COMPARABLE");
    if (policy.requireSameRunSchema && candidate.runSchemaVersion !== schema) exclusionCodes.push("RUN_SCHEMA_MISMATCH");
    if (policy.requireSamePolicyBundle && candidate.policyBundleHash !== policyHash) exclusionCodes.push("POLICY_BUNDLE_MISMATCH");
    const uncertaintyWidthRatio = finite(candidate.lowPerShare) && finite(candidate.midPerShare) && finite(candidate.highPerShare)
      ? (candidate.highPerShare - candidate.lowPerShare) / Math.max(Math.abs(candidate.midPerShare), 1)
      : null;
    const comparable = exclusionCodes.length === 0;
    const score = comparable
      ? (candidate.opportunityScore ?? 0) * 0.45
        + (candidate.qualityScore ?? 0) * 0.25
        + (candidate.expectedCagrStress ?? 0) * 100 * 0.5
        - (uncertaintyWidthRatio ?? 1) * 30
        + (candidate.confidence === "production-ready" ? 10 : 0)
      : null;
    return { ...candidate, comparable, exclusionCodes, uncertaintyWidthRatio, score, targetWeight: 0 };
  });
  const eligible = preliminary.filter((row) => row.comparable && row.score != null && row.score > 0);
  const positiveTotal = eligible.reduce((sum, row) => sum + row.score!, 0);
  const familyUsed = new Map<string, number>();
  const allocated = preliminary
    .sort((left, right) => (right.score ?? -Infinity) - (left.score ?? -Infinity) || left.issuerId.localeCompare(right.issuerId))
    .map((row) => {
      if (!row.comparable || row.score == null || row.score <= 0 || positiveTotal <= 0) return row;
      const unconstrained = row.score / positiveTotal;
      const familyRemaining = Math.max(0, policy.maximumFamilyWeight - (familyUsed.get(row.family) ?? 0));
      const targetWeight = Math.min(unconstrained, policy.maximumIssuerWeight, familyRemaining);
      familyUsed.set(row.family, (familyUsed.get(row.family) ?? 0) + targetWeight);
      return { ...row, targetWeight };
    });
  const comparableCount = allocated.filter((row) => row.comparable).length;
  const status = comparableCount < 2 ? "blocked" : comparableCount < candidates.length ? "guarded" : "comparable";
  const rows = status === "blocked" ? allocated.map((row) => ({ ...row, targetWeight: 0 })) : allocated;
  const residualCashWeight = Math.max(0, 1 - rows.reduce((sum, row) => sum + row.targetWeight, 0));
  return Object.freeze({
    schemaVersion: PORTFOLIO_RUN_COMPARISON_SCHEMA_VERSION,
    status,
    rows: Object.freeze(rows),
    residualCashWeight,
    summary: `${comparableCount}/${candidates.length} immutable runs are comparable; allocations are capped by issuer and family, leaving ${Math.round(residualCashWeight * 10_000) / 100}% unallocated cash.`,
  });
}
