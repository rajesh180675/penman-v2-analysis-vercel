import type { EngineConfig } from "../engine/types";

interface Props {
  config: EngineConfig;
}

interface AssumptionRow {
  label: string;
  value: string;
  source: "user" | "default" | "computed";
  flag: "ok" | "warning" | "error" | null;
  note?: string | undefined;
}

function flagColor(flag: AssumptionRow["flag"]): string {
  if (flag === "error") return "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800";
  if (flag === "warning") return "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800";
  return "bg-white border-slate-200 dark:bg-slate-900/60 dark:border-slate-700";
}

function flagBadge(flag: AssumptionRow["flag"]): string | null {
  if (flag === "error") return "🛑";
  if (flag === "warning") return "⚠️";
  return null;
}

function sourceBadge(source: AssumptionRow["source"]): { text: string; cls: string } {
  switch (source) {
    case "user": return { text: "User", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
    case "computed": return { text: "Computed", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
    default: return { text: "Default", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };
  }
}

/**
 * Assumptions Audit Panel — makes every valuation input visible and flags risks.
 * Key academic principle: "A valuation is only as good as its assumptions."
 */
export default function AssumptionsAudit({ config }: Props) {
  const ke = config.ke ?? (config.risk_free_rate != null && config.equity_risk_premium != null
    ? config.risk_free_rate + config.equity_risk_premium
    : 0.12);
  const g = config.terminal_growth_rate ?? 0.05;
  const rfr = config.risk_free_rate ?? 0.07;
  const erp = config.equity_risk_premium ?? 0.05;
  const price = config.market_price;

  const assumptions: AssumptionRow[] = [
    {
      label: "Cost of Equity (ke)",
      value: `${(ke * 100).toFixed(1)}%`,
      source: config.ke != null ? "user" : "computed",
      flag: ke < 0.08 ? "warning" : ke > 0.20 ? "warning" : "ok",
      note: ke < 0.08 ? "Unusually low — check if risk-free rate and ERP are realistic" :
            ke > 0.20 ? "Very high — may overly penalize growth companies" : undefined,
    },
    {
      label: "Terminal Growth (g)",
      value: `${(g * 100).toFixed(1)}%`,
      source: config.terminal_growth_rate != null ? "user" : "default",
      flag: g >= ke ? "error" : g > 0.07 ? "warning" : g < 0 ? "warning" : "ok",
      note: g >= ke ? "g ≥ ke breaks the Gordon Growth model — valuation will be infinite/negative" :
            g > 0.07 ? "Above nominal GDP growth — hard to sustain forever" :
            g < 0 ? "Negative terminal growth implies permanent decline" : undefined,
    },
    {
      label: "Risk-Free Rate",
      value: `${(rfr * 100).toFixed(1)}%`,
      source: config.risk_free_rate != null ? "user" : "default",
      flag: rfr < 0.04 ? "warning" : rfr > 0.10 ? "warning" : "ok",
      note: rfr < 0.04 ? "Below India 10Y Gsec historical range" :
            rfr > 0.10 ? "High — check if using current market yield" : undefined,
    },
    {
      label: "Equity Risk Premium",
      value: `${(erp * 100).toFixed(1)}%`,
      source: config.equity_risk_premium != null ? "user" : "default",
      flag: erp < 0.03 ? "warning" : erp > 0.08 ? "warning" : "ok",
      note: erp < 0.03 ? "Low for Indian equities — typical range 4-6%" :
            erp > 0.08 ? "High — may undervalue stable companies" : undefined,
    },
    {
      label: "Market Price",
      value: price != null ? `₹${price.toFixed(0)}` : "Not set",
      source: price != null ? "user" : "default",
      flag: price == null ? "warning" : "ok",
      note: price == null ? "No market price — margin of safety cannot be computed" : undefined,
    },
    {
      label: "ke − g Spread",
      value: `${((ke - g) * 100).toFixed(1)}%`,
      source: "computed",
      flag: (ke - g) < 0.03 ? "warning" : "ok",
      note: (ke - g) < 0.03 ? "Narrow spread makes terminal value very sensitive to small changes" : undefined,
    },
    {
      label: "Company Type",
      value: config.company_type ?? "auto",
      source: config.company_type != null ? "user" : "default",
      flag: config.company_type == null || config.company_type === "auto" ? "warning" : "ok",
      note: config.company_type == null ? "Auto-detection may misclassify — prefer explicit selection" : undefined,
    },
  ];

  const errorCount = assumptions.filter(a => a.flag === "error").length;
  const warningCount = assumptions.filter(a => a.flag === "warning").length;

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔎</span>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Assumptions Audit</h3>
            <p className="text-[10px] text-slate-400">Every valuation input — visible, sourced, and sanity-checked</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-medium">
              {errorCount} error{errorCount > 1 ? "s" : ""}
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
              {warningCount} warning{warningCount > 1 ? "s" : ""}
            </span>
          )}
          {errorCount === 0 && warningCount === 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
              All clear ✓
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {assumptions.map((a) => {
          const badge = flagBadge(a.flag);
          const src = sourceBadge(a.source);
          return (
            <div key={a.label} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${flagColor(a.flag)}`}>
              <div className="flex items-center gap-2 min-w-0">
                {badge && <span className="text-sm">{badge}</span>}
                <span className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate">{a.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100">{a.value}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${src.cls}`}>{src.text}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Notes for flagged assumptions */}
      {assumptions.filter(a => a.note).length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1">
          {assumptions.filter(a => a.note).map(a => (
            <p key={a.label} className="text-[10px] text-slate-500 dark:text-slate-400">
              <span className="font-medium">{a.label}:</span> {a.note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
