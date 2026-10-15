import type { LibraryCompany } from "../../src/components/data-entry/companyRegistry";
import { ACTIVE_MARKET_PACKS } from "../../src/engine/marketPacks";
import type { PipelineResult } from "../../src/engine/pipeline";
import type { SegmentData } from "../../src/engine/segmentParser";
import type { EngineConfig, RawPeriodData, RecastPeriod } from "../../src/engine/types";
import type { ValuationCommandCenterOutput } from "../../src/engine/valuationCommandCenter";
import { buildValuationBasis, windowValuationBasis } from "../../src/engine/valuationBasis";
import type { CompanyRunState } from "../../src/next/companyRun";
import { runLibraryCompany } from "./libraryCompanyRun";

/**
 * The periods the forecast-accountability walk-forward replays for one library
 * company, from the app's own run dated `madeAt`: its accounts (standalone
 * where the consolidated history is short), its recast, and the business its
 * valuation forecasts. One loader for every backtest (company-run.ts,
 * scenario-bands.ts), so each scores the same business.
 */
export async function loadWalkForwardBasis(
  root: string,
  company: LibraryCompany,
  madeAt: string,
): Promise<
  | {
      readonly status: "ready";
      readonly state: Extract<CompanyRunState, { status: "ready" }>;
      readonly config: EngineConfig;
      readonly periods: RecastPeriod[];
      readonly carvedLendingArm: string | null;
    }
  | { readonly status: "skipped"; readonly reason: string }
> {
  const state = await runLibraryCompany(root, company, { now: new Date(`${madeAt}T00:00:00.000Z`) });
  if (state.status !== "ready") throw new Error(state.message);
  const run = state.result.materialization as unknown as {
    config: EngineConfig;
    rawData: RawPeriodData[];
    segmentData: SegmentData | null;
    pipelineResult: PipelineResult | null;
    analysisWindow: { includedPeriods: string[] } | null;
    commandCenter: ValuationCommandCenterOutput | null;
  };
  if (!run.pipelineResult) throw new Error("The app's run produced no recast");
  const config = run.config;

  if (run.pipelineResult.analysisFamily !== "industrial") {
    return { status: "skipped", reason: `analysis family ${run.pipelineResult.analysisFamily}: the base forecast engine is industrial-only` };
  }

  // The business the app's valuation forecasts, over the whole history
  // (valuationBasis): every year at a twelve-month rate, and a lending arm
  // carved out where the valuation carves one. Its forecasts are scored against
  // that business's actuals. Scored on the consolidated statements instead, the
  // record measured a forecast the app does not make: Grasim's margin forecast
  // beat a random walk 9 times in 10 with its lender inside, and 0 in 3 on the
  // business the app values. The carve needs the arm's own figures, so a carved
  // history starts where they do.
  const filed: RecastPeriod[] = [...run.pipelineResult.periods].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const basis = buildValuationBasis({
    ticker: config.ticker,
    periods: filed,
    rawData: run.rawData,
    segmentData: run.segmentData,
    config,
    packs: { ...ACTIVE_MARKET_PACKS, analysisAsOf: madeAt },
    asOf: madeAt,
  });
  // The run built the same basis; windowed, it is what its command center valued.
  // A runner that builds it differently would score another business again.
  if (run.commandCenter && run.analysisWindow) {
    const key = (periods: readonly RecastPeriod[]) => periods.map((p) => `${p.period_end}:${p.is.Sales}:${p.bs.NOA}`).join("|");
    if (key(windowValuationBasis(basis, run.analysisWindow.includedPeriods).periods) !== key(run.commandCenter.basisPeriods)) {
      throw new Error("The walk-forward's valuation basis differs from the one the app's run valued");
    }
  }
  const periods = basis.periods;
  if (periods.length < 2) return { status: "skipped", reason: "fewer than two periods on the valuation basis" };
  const carvedLendingArm = basis.lendingArm?.status === "applied" ? basis.lendingArm.link.arm.name : null;
  return { status: "ready", state, config, periods, carvedLendingArm };
}
