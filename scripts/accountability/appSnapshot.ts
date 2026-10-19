import type { LibraryCompany } from "../../src/components/data-entry/companyRegistry";
import { buildForecastSnapshot, type ForecastSnapshot } from "../../src/engine/accountability";
import type { ValuationCommandCenterOutput } from "../../src/engine/valuationCommandCenter";
import { revalueBase } from "../../src/engine/valuationCommandCenter/breakEven";
import { buildScenario } from "../../src/engine/forecastingEngine";
import type { CompanyRunState } from "../../src/next/companyRun";

export type AppForecastSnapshot =
  | (ForecastSnapshot & { readonly latestReportedPeriod: string })
  | { readonly skipped: string };

/**
 * Today's forecast, frozen from the app's own run of the company (dated at the
 * freeze, runLibraryCompany): the forecast the Case's Forecast section draws
 * and the value its base card shows, on the run's accounts, window and
 * valuation basis (a lending arm carved out, a transition year at a
 * twelve-month rate). The runner used to rebuild the command center itself,
 * on the whole consolidated history with nothing carved and no quality gate,
 * so it froze values the app never showed (2026-10: Grasim ₹720 against the
 * app's ₹370) and values for runs the app stops before their valuation
 * (Airtel, Paytm, Idea). A run with no base case freezes nothing, and says why.
 * The other cases are frozen as their cards forecast them, at each card's own kw.
 */
export function snapshotFromAppRun(
  state: Exclude<CompanyRunState, { status: "loading" }>,
  company: Pick<LibraryCompany, "ticker" | "type">,
  madeAt: string,
): AppForecastSnapshot {
  if (state.status !== "ready") return { skipped: `the run failed: ${state.message}` };
  const execution = state.result;
  const cc = execution.materialization.commandCenter as unknown as ValuationCommandCenterOutput | null;
  const card = cc?.scenarios.find((s) => s.key === "base");
  const base = cc ? revalueBase(cc) : null;
  if (!cc || !card || !base?.forecast) {
    const reason = execution.status === "blocked" ? execution.reasonCode : execution.status === "failed" ? execution.errorCode : "no base case";
    const headline = execution.run?.trustEnvelope.confidence.headline;
    return { skipped: `the app's run has no base forecast (${reason})${headline ? `: ${headline}` : ""}` };
  }
  // Every command center carries all four cards (buildScenarioCards).
  const path = (key: "stress" | "bull" | "historical-panic") => buildScenario(cc.scenarios.find((s) => s.key === key)!.scenario, cc.anchorPeriod);
  const filed = execution.materialization.pipelineResult?.periods ?? [];
  return {
    ...buildForecastSnapshot({
      ticker: company.ticker,
      companyType: company.type,
      madeAt,
      cutoff: cc.anchorPeriod,
      basis: {
        accounts: state.basis ?? "consolidated",
        lendingArm: cc.lendingArm?.status === "applied" ? cc.lendingArm.link.arm.name : null,
      },
      forecast: base.forecast,
      scenarios: { stress: path("stress"), bull: path("bull"), historicalPanic: path("historical-panic") },
      assumptions: { ke: card.assumptions.ke, kw: card.assumptions.kw, g: card.assumptions.g },
      intrinsicPerShare: card.intrinsicPerShare ?? null,
    }),
    latestReportedPeriod: filed.at(-1)?.period_end ?? cc.anchorPeriod.period_end,
  };
}
