/* ── Event Flags §13 ──────────────────────────────────────────── */
import { RecastPeriod } from "../../engine/types";
import { PeriodEventFlags } from "../../engine/v3Analytics";
import { pct } from "./v3Formatters";

export function EventFlagsSection({ flags, periods }: { flags: PeriodEventFlags[]; periods: RecastPeriod[] }) {
  const flagged = flags.filter((f) => f.flags.length > 0);
  const FLAG_COLORS: Record<string, string> = {
    STRUCTURAL_EVENT_CRITICAL: "bg-red-100 text-red-800",
    STRUCTURAL_EVENT: "bg-orange-100 text-orange-800",
    CAPITAL_TRANSACTION_LIKELY: "bg-purple-100 text-purple-800",
    PM_OUTLIER_CRITICAL: "bg-red-100 text-red-800",
    PM_OUTLIER_WARNING: "bg-amber-100 text-amber-800",
    LARGE_COMPONENT_DECLINE: "bg-amber-100 text-amber-800",
    PAYOUT_EXCEEDS_EARNINGS: "bg-orange-100 text-orange-800",
    IND_AS_116_TRANSITION: "bg-blue-100 text-blue-800",
    SMALL_NOA_DENOMINATOR: "bg-slate-100 text-slate-700",
    ROCE_OUTLIER_CRITICAL: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-slate-800 mb-1">§13 Period Event Flags</h3>
        <p className="text-xs text-slate-500">
          {flagged.length > 0
            ? `${flagged.length} of ${flags.length} periods have event flags. Terminal period flags affect anchor selection (§11.5).`
            : "No event flags detected across all periods."}
        </p>
      </div>

      {flagged.length === 0 && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm">
          ✓ All periods are clean. Terminal anchor uses as-reported RE.
        </div>
      )}

      {flagged.map((pf) => {
        const period = periods.find((p) => p.period_end === pf.period_end);
        return (
          <div key={pf.period_end} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-sm font-semibold text-slate-700">{pf.period_end.slice(0, 7)}</span>
              {period?.ratios?.PM != null && (
                <span className="text-xs text-slate-500">PM: {pct(period.ratios.PM)} | ROCE: {pct(period.ratios.ROCE)}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {pf.flags.map((flag) => (
                <span key={flag} className={`text-xs px-2 py-0.5 rounded-full font-medium ${FLAG_COLORS[flag] ?? "bg-slate-100 text-slate-700"}`}>
                  {flag}
                </span>
              ))}
            </div>
            {pf.pm_zscore != null && (
              <p className="text-xs text-slate-400 mt-1">PM z-score: {pf.pm_zscore.toFixed(2)} | ΔNOA%: {pf.noa_change_pct != null ? pct(pf.noa_change_pct) : "—"}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
