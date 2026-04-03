import { WorkspaceValuationSnapshot } from "../lib/researchWorkspace";

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

interface Props {
  valuation: WorkspaceValuationSnapshot | null;
}

export default function AssumptionManifestPanel({ valuation }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-slate-800">Assumption Manifest</h3>
      {valuation ? (
        <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <ManifestStat label="As of" value={valuation.asOf?.slice(0, 10) ?? "—"} />
          <ManifestStat label="Market price" value={valuation.marketPrice != null ? `₹${valuation.marketPrice.toFixed(2)}` : "—"} />
          <ManifestStat label="Signal" value={valuation.signalLabel} />
          <ManifestStat label="Confidence" value={valuation.confidenceState} />
          <ManifestStat label="Stress CAGR" value={pct(valuation.expectedCagrStress)} />
          <ManifestStat label="Base CAGR" value={pct(valuation.expectedCagrBase)} />
          <ManifestStat label="Stress upside" value={pct(valuation.stressUpsidePct)} />
          <ManifestStat label="Required MoS" value={pct(valuation.requiredMarginOfSafetyPct)} />
          <ManifestStat label="Opportunity score" value={valuation.opportunityScore != null ? `${valuation.opportunityScore.toFixed(0)}/100` : "—"} />
          <ManifestStat label="Quality score" value={valuation.qualityScore != null ? `${valuation.qualityScore.toFixed(0)}/100` : "—"} />
          <ManifestStat label="Sizing bucket" value={valuation.convictionBucket ?? "—"} />
          <ManifestStat label="Sector template" value={valuation.sectorTemplate ?? "—"} />
          <ManifestStat label="Market freshness" value={valuation.marketFreshness ?? "—"} />
          <ManifestStat label="Anchor period" value={valuation.valuationAnchorPeriod?.slice(0, 10) ?? "—"} />
          <ManifestStat label="Latest reported" value={valuation.latestReportedPeriod?.slice(0, 10) ?? "—"} />
          <ManifestStat label="Live price as-of" value={valuation.livePriceAsOf?.slice(0, 10) ?? "—"} />
          <ManifestStat label="Live rate as-of" value={valuation.liveRateAsOf?.slice(0, 10) ?? "—"} />
          <ManifestStat label="Market source" value={valuation.marketSourceSummary ?? "—"} />
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stored thesis</div>
            <div className="mt-1 text-slate-800">{valuation.thesis || "No persisted thesis commentary yet."}</div>
          </div>
          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reverse DCF note</div>
            <div className="mt-1 text-slate-800">{valuation.reverseDcfSummary || "No reverse-DCF narrative saved yet."}</div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Run the valuation tab first. This panel is where the investor sees the stored assumptions behind the recommendation.</p>
      )}
    </div>
  );
}

function ManifestStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}
