import { WorkspaceCompanyRecord } from "../lib/researchWorkspace";

export interface PortfolioRankRow {
  companyId: string;
  label: string;
  signalLabel: string;
  signalState: string;
  confidence: string;
  opportunityScore: number | null;
  expectedCagrStress: number | null;
  qualityScore: number | null;
  targetWeightPct: number | null;
  score: number;
}

function confidenceScore(confidence: string | null | undefined) {
  if (confidence === "production-ready") return 15;
  if (confidence === "guarded") return 6;
  if (confidence === "blocked") return -30;
  return 0;
}

function signalScore(state: string | null | undefined) {
  if (state === "screaming-buy") return 35;
  if (state === "high-conviction") return 24;
  if (state === "interesting") return 14;
  if (state === "watchlist") return 6;
  if (state === "guarded") return -12;
  if (state === "blocked") return -30;
  return 0;
}

export function rankWorkspaceCompanies(companies: WorkspaceCompanyRecord[]): PortfolioRankRow[] {
  return companies
    .map((company) => {
      const latestValuation = company.valuations[0] ?? null;
      const latestSignal = company.signalHistory[0] ?? null;
      const signalState = latestSignal?.state ?? latestValuation?.signalState ?? "unknown";
      const confidence = latestSignal?.confidenceState ?? latestValuation?.confidenceState ?? company.analysisHistory[0]?.analysisStatus ?? "unknown";
      const opportunityScore = latestValuation?.opportunityScore ?? latestSignal?.opportunityScore ?? null;
      const expectedCagrStress = latestValuation?.expectedCagrStress ?? latestSignal?.expectedCagrStress ?? null;
      const qualityScore = latestValuation?.qualityScore ?? null;
      const portfolioWeight = company.portfolio.targetWeightPct ?? null;
      const score =
        signalScore(signalState)
        + confidenceScore(confidence)
        + (opportunityScore ?? 0) * 0.35
        + (expectedCagrStress ?? 0) * 100 * 0.7
        + (qualityScore ?? 0) * 0.15;

      return {
        companyId: company.companyId,
        label: company.label,
        signalLabel: latestValuation?.signalLabel ?? latestSignal?.label ?? "No valuation memory",
        signalState,
        confidence,
        opportunityScore,
        expectedCagrStress,
        qualityScore,
        targetWeightPct: portfolioWeight,
        score,
      } satisfies PortfolioRankRow;
    })
    .sort((left, right) => right.score - left.score);
}
