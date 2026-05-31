import type { SanityAssessment } from "../../engine/ratioSanity";

export default function RatioSanityPanel({ ratioSanity }: { ratioSanity: SanityAssessment }) {
  return (
    <div className={`rounded-lg border p-5 space-y-3 ${ratioSanity.status === "fail"
        ? "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/30"
        : ratioSanity.status === "warning"
          ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
          : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40"
      }`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{ratioSanity.status === "fail" ? "🚨" : "⚠️"}</span>
        <h3 className="font-semibold text-slate-800 dark:text-slate-200">Ratio Sanity Check</h3>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${ratioSanity.status === "fail" ? "bg-red-100 text-red-800" :
            ratioSanity.status === "warning" ? "bg-amber-100 text-amber-800" :
              "bg-slate-100 text-slate-700"
          }`}>{ratioSanity.status.toUpperCase()}</span>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-400">
        {ratioSanity.summary} <span className="text-slate-400">· company type: {ratioSanity.companyType}</span>
      </div>
      <table className="w-full text-xs">
        <thead className="text-slate-500 dark:text-slate-400">
          <tr>
            <th className="text-left py-1">Check</th>
            <th className="text-right py-1">Value</th>
            <th className="text-center py-1">Status</th>
            <th className="text-left py-1 pl-3">Detail</th>
          </tr>
        </thead>
        <tbody>
          {ratioSanity.checks.filter(c => c.status === "warning" || c.status === "fail").map((check) => (
            <tr key={check.key} className="border-t border-slate-200 dark:border-slate-700">
              <td className="py-1 font-medium">{check.label}</td>
              <td className="py-1 text-right tabular-nums">{check.value != null ? `${(check.value * 100).toFixed(1)}%` : "—"}</td>
              <td className="py-1 text-center">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${check.status === "fail" ? "bg-red-200 text-red-900" :
                    check.status === "warning" ? "bg-amber-200 text-amber-900" :
                      "bg-slate-200 text-slate-700"
                  }`}>{check.status}</span>
              </td>
              <td className="py-1 pl-3 text-slate-600 dark:text-slate-400">{check.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-slate-500 dark:text-slate-500 italic">
        Bands are heuristic, sector-typical ranges for Indian listed companies. Fail status indicates economically implausible outputs and blocks production-ready valuation.
      </div>
    </div>
  );
}
