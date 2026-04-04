import { AnalysisStatusSummary } from "../engine/analysisStatus";
import { WorkspaceSignalHistoryEntry, WorkspaceValuationSnapshot } from "../lib/researchWorkspace";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function nextAction(args: {
  status?: AnalysisStatusSummary["status"] | "unknown";
  signal?: WorkspaceSignalHistoryEntry | null;
}) {
  const { status, signal } = args;
  if (status === "blocked" || signal?.state === "blocked") {
    return {
      title: "Stop at diagnosis",
      body: "Do not make an investment decision from this case. Fix scope, mapping, or accounting-confidence issues first.",
    };
  }
  if (status === "guarded" || signal?.state === "guarded") {
    return {
      title: "Use as guarded research",
      body: "The valuation can shape your questions, but it should not drive position sizing until the confidence state improves.",
    };
  }
  if (signal?.state === "screaming-buy") {
    return {
      title: "Run rare-dislocation protocol",
      body: "Re-check business quality, balance-sheet safety, and thesis breakers. Only then consider an aggressive allocation.",
    };
  }
  if (signal?.state === "high-conviction") {
    return {
      title: "Ready for portfolio decision",
      body: "This is where the investor should validate catalysts, downside risks, and position size rather than keep re-litigating the base model.",
    };
  }
  if (signal?.state === "interesting") {
    return {
      title: "Research deeper or wait",
      body: "The gap is promising but not rare. Refine the thesis and wait for either better price or stronger evidence.",
    };
  }
  return {
    title: "Understand before acting",
    body: "Start with the business summary, accounting confidence, and stress-case economics. The app should help you know why you own it, not just what it is worth.",
  };
}

interface Props {
  analysisStatus?: AnalysisStatusSummary | null;
  latestSignal: WorkspaceSignalHistoryEntry | null;
  latestValuation: WorkspaceValuationSnapshot | null;
}

export default function ValuationWorkbench({ analysisStatus, latestSignal, latestValuation }: Props) {
  const action = nextAction({
    status: analysisStatus?.status ?? latestValuation?.confidenceState ?? "unknown",
    signal: latestSignal,
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Valuation Workbench</h3>
          <p className="mt-1 text-sm text-slate-500">
            This is the investor-translation layer: what the current signal means, what to do next, and which parts of the conclusion deserve trust.
          </p>
        </div>
        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {latestValuation?.signalLabel ?? latestSignal?.label ?? "No live valuation memory"}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next action</div>
        <div className="mt-2 text-lg font-bold text-slate-900">{action.title}</div>
        <div className="mt-2 text-sm text-slate-700">{action.body}</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <WorkbenchStat label="Confidence" value={analysisStatus?.label ?? latestValuation?.confidenceState ?? "—"} />
        <WorkbenchStat label="Stress CAGR" value={pct(latestValuation?.expectedCagrStress ?? latestSignal?.expectedCagrStress)} />
        <WorkbenchStat label="Stress upside" value={pct(latestValuation?.stressUpsidePct)} />
        <WorkbenchStat label="Opportunity score" value={latestValuation?.opportunityScore != null ? `${latestValuation.opportunityScore.toFixed(0)}/100` : "—"} />
        <WorkbenchStat label="Market freshness" value={latestValuation?.marketFreshness ?? latestSignal?.marketFreshness ?? "—"} />
        <WorkbenchStat label="Anchor period" value={latestValuation?.valuationAnchorPeriod?.slice(0, 10) ?? latestSignal?.valuationAnchorPeriod?.slice(0, 10) ?? "—"} />
        <WorkbenchStat label="Live price as-of" value={latestValuation?.livePriceAsOf ? new Date(latestValuation.livePriceAsOf).toLocaleDateString("en-IN") : "—"} />
        <WorkbenchStat label="Reported period" value={latestValuation?.latestReportedPeriod?.slice(0, 10) ?? "—"} />
        <WorkbenchStat label="Persistence" value={latestValuation?.persistenceScore != null ? `${latestValuation.persistenceScore.toFixed(0)}/100` : "—"} />
        <WorkbenchStat label="Margin durability" value={latestValuation?.marginDurabilityScore != null ? `${latestValuation.marginDurabilityScore.toFixed(0)}/100` : "—"} />
        <WorkbenchStat label="WC discipline" value={latestValuation?.workingCapitalDisciplineScore != null ? `${latestValuation.workingCapitalDisciplineScore.toFixed(0)}/100` : "—"} />
      </div>
      {latestValuation?.businessModelEvidence?.length ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business-model evidence</div>
          <ul className="mt-2 space-y-1">
            {latestValuation.businessModelEvidence.slice(0, 3).map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </div>
      ) : null}
      {latestValuation?.persistenceNarrative ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Persistence narrative</div>
          <div className="mt-2">{latestValuation.persistenceNarrative}</div>
          {latestValuation.forecastDiscipline?.length ? (
            <ul className="mt-2 space-y-1">
              {latestValuation.forecastDiscipline.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {latestValuation?.marketSourceSummary && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Market overlay provenance</div>
          <div className="mt-1">{latestValuation.marketSourceSummary}</div>
        </div>
      )}
    </div>
  );
}

function WorkbenchStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}
