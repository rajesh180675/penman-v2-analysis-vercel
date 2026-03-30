import { EngineConfig, RawPeriodData } from "../engine/types";
import { buildFinancialInstitutionValuation } from "../engine/financialInstitutionFramework";

interface Props {
  rawData: RawPeriodData[];
  config: EngineConfig;
}

function pct(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function fmtMetric(value: number | null | undefined, format: "pct" | "multiple" | "currency" | "number") {
  if (value == null || !Number.isFinite(value)) return "—";
  if (format === "pct") return pct(value, 2);
  if (format === "multiple") return `${value.toFixed(2)}x`;
  if (format === "currency") return `₹${value.toFixed(2)}`;
  return value.toFixed(2);
}

export default function FinancialInstitutionReport({ rawData, config }: Props) {
  const output = buildFinancialInstitutionValuation(rawData, config);

  if (!output) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h3 className="text-lg font-semibold">Financial-company framework could not be derived</h3>
        <p className="mt-2 text-sm">The dataset is classified as financial, but the minimum book-value and earnings anchors were not available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-blue-900">
        <h3 className="text-lg font-semibold">Financial Institution Framework</h3>
        <p className="mt-2 text-sm">{output.summary}</p>
        <div className="mt-3 inline-flex rounded-full border border-blue-300 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          {output.institutionKind} · {output.priceTargetMethod}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Book value / share" value={output.bookValuePerShare != null ? `₹${output.bookValuePerShare.toFixed(2)}` : "—"} />
        <Metric label="Earnings / share" value={output.earningsPerShare != null ? `₹${output.earningsPerShare.toFixed(2)}` : "—"} />
        <Metric label="ROE" value={pct(output.roe)} />
        <Metric label="Justified P/B" value={output.justifiedPb != null ? `${output.justifiedPb.toFixed(2)}x` : "—"} />
        <Metric label="Justified value / share" value={output.justifiedValuePerShare != null ? `₹${output.justifiedValuePerShare.toFixed(2)}` : "—"} />
        <Metric label="Confidence" value={output.confidence} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {output.keyMetrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={fmtMetric(metric.value, metric.format)} />
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-700">
        <div className="font-semibold text-slate-900">How to use this</div>
        <ul className="mt-3 space-y-2">
          <li>Use this path for banks, NBFCs, and insurers instead of the industrial NOA/NFO valuation stack.</li>
          <li>The framework first classifies the institution type, then changes the anchor metrics so the investor is not applying industrial logic to financial balance sheets.</li>
          <li>Book value and normalized ROE remain central, but the decisive cross-checks now depend on the institution family: NIM and credit cost for banks, lending yield and leverage for NBFCs, and float/claims discipline for insurers.</li>
        </ul>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
