import { ReactNode } from "react";

export interface TraceabilitySurfaceSummary {
  headline: string;
  detail: string;
  confidenceLine: string;
  parserLine: string;
  reconciliationLine: string;
  nextGateLine: string;
  blockers: string[];
}

interface Props {
  title: string;
  summary: TraceabilitySurfaceSummary;
  confidenceStatus?: string | null | undefined;
  rigorLabel?: string | null | undefined;
  parserStatus?: string | null | undefined;
  reconciliationStatus?: string | null | undefined;
  cautionHeading: string;
  aside?: ReactNode | undefined;
}

export default function TraceabilityTrustPanel({
  title,
  summary,
  confidenceStatus,
  rigorLabel,
  parserStatus,
  reconciliationStatus,
  cautionHeading,
  aside = null,
}: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{summary.headline}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{summary.detail}</p>
        </div>
        {aside}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <TrustMetric label="Confidence" value={confidenceStatus ?? "—"} sublabel={summary.confidenceLine} />
        <TrustMetric label="Rigor level" value={rigorLabel ?? "—"} sublabel={summary.nextGateLine} />
        <TrustMetric label="Parser fidelity" value={parserStatus ?? "—"} sublabel={summary.parserLine} />
        <TrustMetric label="Reconciliation" value={reconciliationStatus ?? "—"} sublabel={summary.reconciliationLine} />
      </div>
      {summary.blockers.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">{cautionHeading}</div>
          <ul className="mt-2 space-y-1">
            {summary.blockers.map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function TrustMetric({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sublabel}</div>
    </div>
  );
}
