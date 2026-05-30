import { EngineConfig } from "../../engine/types";
import { generateValuationNarrative } from "../../engine/narrativeEngine";
import {
  buildValuationCommandCenter,
  formatPct,
  formatPerShare,
} from "../../engine/valuationCommandCenter";
import { useLiveMarketData } from "../../hooks/useLiveMarketData";
import { InsightBlock, SectionHeader } from "../shared/DesignSystem";
import AssumptionsAudit from "../AssumptionsAudit";
import { HeroMetric, SignalPill } from "./atoms";

export default function ValuationCommandCenterHero({
  marketSymbol,
  commandCenter,
  liveMarketData,
  marketDataLoading,
  marketDataError,
  onRefresh,
  config,
}: {
  marketSymbol: string | null;
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
  liveMarketData: ReturnType<typeof useLiveMarketData>["snapshot"];
  marketDataLoading: boolean;
  marketDataError: string | null;
  onRefresh: () => Promise<void>;
  config: EngineConfig;
}) {
  const stress = commandCenter.scenarios.find((scenario) => scenario.key === "stress");
  const base = commandCenter.scenarios.find((scenario) => scenario.key === "base");

  return (
    <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.06),_transparent_35%),linear-gradient(135deg,_#ffffff,_#f8fafc)] p-6 shadow-sm">
      <SectionHeader
        title="Valuation"
        subtitle="What is this business worth?"
        icon="💰"
      />

      {/* Narrative insight — plain English valuation summary */}
      {(() => {
        const price = commandCenter.marketPrice;
        const floor = commandCenter.range.floorPerShare;
        const ceiling = commandCenter.range.ceilingPerShare;
        const mid = floor != null && ceiling != null ? (floor + ceiling) / 2 : null;
        const mos = price != null && mid != null && price > 0 ? (mid - price) / price : null;
        const narrative = generateValuationNarrative({
          ticker: config.ticker ?? config.quality_data_folder ?? "Company",
          price,
          intrinsicFloor: floor,
          intrinsicCeiling: ceiling,
          intrinsicMid: mid,
          frameworkCount: commandCenter.scenarios.length,
          convergenceSigma: null,
          marginOfSafety: mos,
        });
        return narrative ? <InsightBlock text={narrative} icon="📊" /> : null;
      })()}

      {/* Assumptions Audit — all valuation inputs visible and sanity-checked */}
      <AssumptionsAudit config={config} />

      <div className="flex flex-wrap items-start justify-between gap-4 mt-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Valuation Command Center
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Lead with the stressed case, not the optimistic one.</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            The command center keeps the live market layer separate from the audited accounting base, then asks whether the current setup is merely cheap or genuinely rare.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SignalPill state={commandCenter.signal.state} label={commandCenter.signal.label} />
          <button
            onClick={() => { void onRefresh(); }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            {marketDataLoading ? "Refreshing…" : "Refresh live data"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <HeroMetric label="Current price" value={commandCenter.marketPrice != null ? `₹${commandCenter.marketPrice.toFixed(2)}` : "—"} sublabel={`${commandCenter.marketContext.freshness}${marketSymbol ? ` · ${marketSymbol}` : ""}`} />
        <HeroMetric label="Stress value" value={formatPerShare(stress?.intrinsicPerShare)} sublabel={`Upside ${formatPct(stress?.upsidePct)}`} />
        <HeroMetric label="Base value" value={formatPerShare(base?.intrinsicPerShare)} sublabel={`Upside ${formatPct(base?.upsidePct)}`} />
        <HeroMetric label="Expected CAGR (stress)" value={formatPct(commandCenter.opportunity.expectedCagrStress, 1)} sublabel={commandCenter.opportunity.convictionBucket} />
        <HeroMetric label="Valuation range" value={`${formatPerShare(commandCenter.range.floorPerShare)} to ${formatPerShare(commandCenter.range.ceilingPerShare)}`} sublabel={`Anchor ${commandCenter.valuationReadiness.anchorPeriod?.slice(0, 10) ?? "—"} · As of ${commandCenter.asOf ? new Date(commandCenter.asOf).toLocaleString("en-IN") : "—"}`} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Audited accounting anchor</div>
          <div className="mt-2 text-sm text-slate-800">
            Latest reported period <strong>{commandCenter.marketContext.latestReportedPeriod?.slice(0, 10) ?? "—"}</strong>
          </div>
          <div className="mt-1 text-sm text-slate-800">
            Valuation anchor <strong>{commandCenter.marketContext.valuationAnchorPeriod?.slice(0, 10) ?? "—"}</strong>
          </div>
          <div className="mt-2 text-xs text-slate-500">{commandCenter.valuationReadiness.reasons[0] ?? "Latest reported period is usable as the valuation anchor."}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live market overlay</div>
          <div className="mt-2 text-sm text-slate-800">{commandCenter.marketContext.sourceSummary}</div>
          <div className="mt-2 text-xs text-slate-500">
            Price as-of {commandCenter.marketContext.livePriceAsOf ? new Date(commandCenter.marketContext.livePriceAsOf).toLocaleString("en-IN") : "—"}
            {" · "}
            Rate as-of {commandCenter.marketContext.liveRateAsOf ? new Date(commandCenter.marketContext.liveRateAsOf).toLocaleDateString("en-IN") : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trust posture</div>
          <div className="mt-2 text-sm text-slate-800">Confidence <strong>{commandCenter.signal.confidenceState}</strong></div>
          <div className="mt-1 text-sm text-slate-800">Warnings <strong>{commandCenter.marketContext.warningCount}</strong></div>
          <div className="mt-2 text-xs text-slate-500">Aggressive signals now require both a clean accounting anchor and sufficiently current market inputs.</div>
        </div>
      </div>

      {liveMarketData?.warnings?.length ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Provider warnings</div>
          <ul className="mt-2 space-y-1">
            {liveMarketData.warnings.map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </div>
      ) : null}

      {commandCenter.valuationReadiness.status !== "production-ready" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Guarded accounting anchor</div>
          <div className="mt-1">{commandCenter.valuationReadiness.reasons[0]}</div>
        </div>
      )}

      {marketDataError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Live market overlay warning</div>
          <div className="mt-1">{marketDataError}</div>
        </div>
      )}

      {(commandCenter.marketContext.freshness === "stale" || commandCenter.marketContext.freshness === "fallback" || commandCenter.marketContext.freshness === "missing") && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Freshness state <strong>{commandCenter.marketContext.freshness}</strong> is now part of signal discipline, so rare or aggressive labels may be capped until the market overlay improves.
        </div>
      )}

      {commandCenter.marketContext.warningCount > 0 && !liveMarketData?.warnings?.length && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The market overlay includes {commandCenter.marketContext.warningCount} provider warning{commandCenter.marketContext.warningCount === 1 ? "" : "s"}.
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision protocol</div>
        <div className="mt-1">Audited/recast accounting defines the anchor period. Live market data defines the overlay. The signal only escalates when both layers are trustworthy enough together.</div>
      </div>

    </section>
  );
}
