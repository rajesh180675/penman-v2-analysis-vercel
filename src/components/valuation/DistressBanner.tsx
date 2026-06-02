import { detectDistress } from "../../engine/distressDetector";

export default function DistressBanner({ distress }: { distress: ReturnType<typeof detectDistress> }) {
  if (distress.severity === "none") return null;
  const tone =
    distress.severity === "critical"
      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
      : distress.severity === "severe"
        ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100";
  const icon =
    distress.severity === "critical" ? "🚨"
      : distress.severity === "severe" ? "⚠️"
        : "⚠";
  const title =
    distress.severity === "critical"
      ? "Critical financial distress — going-concern stress"
      : distress.severity === "severe"
        ? "Current negative net worth — equity-side valuation skipped"
        : "Historical accounting caveat — not current distress";
  return (
    <div className={`rounded-lg border-2 p-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl">{icon}</div>
        <div className="flex-1">
          <div className="font-semibold mb-1">{title}</div>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {distress.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {distress.equityModelsBlocked && (
            <div className="text-xs mt-3 opacity-80">
              Equity-side intrinsic values (V_RE, DDM, per-share EPV, implied P/B) are
              skipped on this dataset. Anchor on enterprise-side V_ReOI or FCFF, segment
              SOTP, or reverse-DCF instead.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
