import type { AnalysisTraceabilityEnvelope } from "../../engine/analysisTraceability";
import type { SanityAssessment } from "../../engine/ratioSanity";

interface Props {
  companyId: string;
  companyType: string;
  price: number | null;
  marketCap: number | null;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
  ratioSanity?: SanityAssessment | null | undefined;
  segmentCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  auto: "Auto",
  bank: "Bank",
  nbfc: "NBFC",
  insurance: "Insurance",
  industrial: "Industrial",
  "it-services": "IT Services",
  consumer: "Consumer / FMCG",
  utility: "Utility / PSU",
  telecom: "Telecom",
  cyclical: "Cyclical / Metals",
};

function ConfidenceDots({ status }: { status: string | null | undefined }) {
  const level = status === "production-ready" ? 4
    : status === "warning" ? 3
    : status === "guarded" ? 2
    : status === "blocked" ? 1
    : 0;
  const colors = ["bg-red-400", "bg-red-400", "bg-amber-400", "bg-emerald-400", "bg-emerald-500"];
  return (
    <div className="flex gap-1 items-center">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className={`w-2.5 h-2.5 rounded-full ${i <= level ? colors[level] : "bg-slate-200 dark:bg-slate-700"}`}
        />
      ))}
      <span className="ml-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 capitalize">
        {status ?? "unknown"}
      </span>
    </div>
  );
}

export default function CompanyHeaderCard({ companyId, companyType, price, marketCap, traceability, ratioSanity, segmentCount }: Props) {
  const confidenceStatus = traceability?.confidence?.status ?? null;
  const sanityStatus = ratioSanity?.status ?? "ok";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left: Company identity */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
            {companyId.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{companyId}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                {TYPE_LABELS[companyType] ?? companyType}
              </span>
              {segmentCount >= 2 && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {segmentCount} segments
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Price + Market Cap */}
        <div className="flex items-center gap-6">
          {price != null && (
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900 dark:text-white">₹{price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
              <div className="text-xs text-slate-500">Market Price</div>
            </div>
          )}
          {marketCap != null && (
            <div className="text-right">
              <div className="text-lg font-semibold text-slate-700 dark:text-slate-300">
                ₹{marketCap >= 100000 ? `${(marketCap / 100000).toFixed(1)}L Cr` : `${marketCap.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`}
              </div>
              <div className="text-xs text-slate-500">Market Cap</div>
            </div>
          )}
        </div>

        {/* Right: Confidence + Sanity */}
        <div className="flex flex-col gap-2 items-end">
          <ConfidenceDots status={confidenceStatus} />
          {sanityStatus !== "ok" && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              sanityStatus === "fail" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            }`}>
              Ratio Sanity: {sanityStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
