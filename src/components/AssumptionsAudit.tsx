import type { EngineConfig } from "../engine/types";
import type { CostOfCapitalResult } from "../engine/costOfCapital";
import type { AssumptionTier } from "../engine/assumptions/capitalCostAssumptions";

interface Props {
  config: EngineConfig;
  /**
   * The capital cost the run resolved, from `commandCenter.costOfCapital`.
   *
   * Required, not optional. This panel used to read `config.ke` directly, which
   * is a different number: the app never sets `cost_of_equity_mode`, so it stays
   * `"capm"` and a reviewer-typed `config.ke` is ignored by every derivation —
   * the panel was reporting a cost of equity the valuation had not used. Taking
   * the resolved result is what makes it agree (S-9.4C), and it retires this
   * file as a third ke derivation path.
   */
  costOfCapital: CostOfCapitalResult;
  /**
   * The terminal growth the run actually applied, from the command center's
   * base scenario (`scenarios.find(s => s.key === "base")?.assumptions.g`).
   *
   * Required and nullable rather than optional-with-a-default, for the same
   * reason `costOfCapital` is. This row read `config.terminal_growth_rate ?? 0.05`,
   * and that field has no writer anywhere in the app: it is absent from
   * `DEFAULT_CONFIG`, no UI control sets it, and no company data file carries it.
   * So it was always `undefined`, the row always printed 5.0% and always badged
   * itself "Default", while the run discounted at the scenario's own g. An
   * optional prop would let a caller silently reintroduce that.
   */
  terminalGrowth: number | null;
}

/**
 * Where a displayed number came from. `sourced`/`estimated`/`prior` are the
 * engine's own provenance tiers, reused rather than re-invented so the badge
 * cannot drift from what the resolver recorded.
 */
type RowSource = AssumptionTier | "user" | "default" | "computed";

interface AssumptionRow {
  label: string;
  value: string;
  source: RowSource;
  flag: "ok" | "warning" | "error" | null;
  note?: string | undefined;
}

/**
 * The weakest of several tiers. A derived number inherits the provenance of its
 * softest input: ke built from a sourced risk-free rate, a sourced ERP and a
 * sector-prior beta is a prior, because the beta is doing real work in it.
 */
function weakestTier(tiers: readonly AssumptionTier[]): AssumptionTier {
  if (tiers.includes("prior")) return "prior";
  if (tiers.includes("estimated")) return "estimated";
  return "sourced";
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

/**
 * Exported so a spec can assert the badges are actually distinguishable. Two of
 * these shipped sharing a colour with a stronger tier, which is a silent failure
 * in a panel whose only job is telling provenance apart.
 */
export function sourceBadge(source: RowSource): { text: string; cls: string } {
  switch (source) {
    case "user": return { text: "User", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
    // Indigo, not the emerald "Sourced" wears. This badge means arithmetic over
    // the rows above it, or a tier the resolver did not report — a weaker claim
    // than a dated third-party observation. Sharing a colour with "Sourced"
    // would blur the one distinction this panel exists to draw.
    case "computed": return { text: "Computed", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" };
    // The provenance tiers, coloured by how much weight a reviewer should put
    // on the number: a dated third-party observation, something derived here,
    // or an engine default that no source stands behind.
    case "sourced": return { text: "Sourced", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
    // Violet: "Estimated" shipped in the same blue as "User", which is the same
    // collision CodeRabbit caught between Computed and Sourced. A number this
    // engine derived and a number a reviewer typed are not the same claim.
    case "estimated": return { text: "Estimated", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" };
    case "prior": return { text: "Prior", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" };
    default: return { text: "Default", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };
  }
}

/**
 * Assumptions Audit Panel — makes every valuation input visible and flags risks.
 * Key academic principle: "A valuation is only as good as its assumptions."
 */
export default function AssumptionsAudit({ config, costOfCapital, terminalGrowth }: Props) {
  const ke = costOfCapital.ke;
  const tiers = costOfCapital.assumptions;
  // ke is a product of three inputs, so it is only as defensible as the weakest
  // of them. Manual ke reports no tiers at all — the reviewer supplied the rate
  // directly, so "User" is the accurate label and a tier would be an invention.
  const keSource: RowSource = costOfCapital.equityMode === "manual"
    ? "user"
    : tiers
      ? weakestTier([tiers.riskFreeRate.tier, tiers.equityRiskPremium.tier, tiers.beta.tier])
      : "computed";
  // The run's own terminal growth, threaded in. `config.terminal_growth_rate`
  // used to supply this and is never written anywhere in the app, so the row
  // printed a 5% fallback while the valuation discounted at the scenario's g.
  const g = terminalGrowth;
  const spread = g == null ? null : ke - g;
  const rfr = costOfCapital.riskFreeRate;
  const erp = costOfCapital.equityRiskPremium;
  const price = config.market_price;

  const assumptions: AssumptionRow[] = [
    {
      label: "Cost of Equity (ke)",
      value: `${(ke * 100).toFixed(1)}%`,
      source: keSource,
      flag: ke < 0.08 ? "warning" : ke > 0.20 ? "warning" : "ok",
      note: ke < 0.08 ? "Unusually low — check if risk-free rate and ERP are realistic" :
            ke > 0.20 ? "Very high — may overly penalize growth companies" : undefined,
    },
    {
      label: "Terminal Growth (g)",
      value: g == null ? "Not resolved" : `${(g * 100).toFixed(1)}%`,
      // "Computed", not "User", even when a reviewer set `g_terminal_override`:
      // the builder clamps that override to the sector template's floor and cap
      // before any model sees it, so the number on this row can differ from the
      // one that was typed. Badging it as the reviewer's choice would repeat the
      // mistake this row is being fixed for.
      source: g == null ? "default" : "computed",
      flag: g == null ? "warning" : g >= ke ? "error" : g > 0.07 ? "warning" : g < 0 ? "warning" : "ok",
      note: g == null ? "No scenario resolved a terminal growth — the value range below cannot be reproduced from this panel" :
            g >= ke ? "g ≥ ke breaks the Gordon Growth model — valuation will be infinite/negative" :
            g > 0.07 ? "Above nominal GDP growth — hard to sustain forever" :
            g < 0 ? "Negative terminal growth implies permanent decline" : undefined,
    },
    {
      label: "Risk-Free Rate",
      // Was `config.risk_free_rate != null ? "user" : "default"`, which is
      // always "user": the field is required on EngineConfig, so the engine's
      // own 7% default was badged as a reviewer's choice. Same for the ERP and
      // ke rows below. The resolver's tier is the answer to that question.
      value: `${(rfr * 100).toFixed(1)}%`,
      source: tiers?.riskFreeRate.tier ?? "computed",
      flag: rfr < 0.04 ? "warning" : rfr > 0.10 ? "warning" : "ok",
      note: rfr < 0.04 ? "Below India 10Y Gsec historical range" :
            rfr > 0.10 ? "High — check if using current market yield" : undefined,
    },
    {
      label: "Equity Risk Premium",
      // Null in manual-ke mode, where no ERP entered the discount rate. Saying
      // so beats printing the config constant the run never multiplied.
      value: erp == null ? "Not used (manual ke)" : `${(erp * 100).toFixed(1)}%`,
      source: erp == null ? "user" : tiers?.equityRiskPremium.tier ?? "computed",
      flag: erp == null ? null : erp < 0.03 ? "warning" : erp > 0.08 ? "warning" : "ok",
      note: erp == null ? undefined :
            erp < 0.03 ? "Low for Indian equities — typical range 4-6%" :
            erp > 0.08 ? "High — may undervalue stable companies" : undefined,
    },
    {
      label: "Beta (β)",
      // New row. Beta is the input most likely to be a sector prior, and the
      // one whose provenance the reviewer could not previously see at all.
      value: costOfCapital.beta == null ? "Not used (manual ke)" : `${costOfCapital.beta.toFixed(2)}×`,
      source: costOfCapital.beta == null ? "user" : tiers?.beta.tier ?? "computed",
      flag: tiers?.beta.tier === "prior" ? "warning" : "ok",
      note: tiers?.beta.tier === "prior" ? tiers.beta.fallbackReason : undefined,
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
      // Both legs now come from the same scenario: `keBase` is
      // `costOfCapital.ke` (`valuationCommandCenter/core.ts:182`) and the base
      // card's `assumptions.g` is the growth that build applied, so this is the
      // base case's actual Gordon denominator rather than a mixed pair.
      value: spread == null ? "Not resolved" : `${(spread * 100).toFixed(1)}%`,
      source: "computed",
      flag: spread == null ? "warning" : spread < 0.03 ? "warning" : "ok",
      note: spread == null ? "Terminal growth unresolved, so the Gordon denominator cannot be shown" :
            spread < 0.03 ? "Narrow spread makes terminal value very sensitive to small changes" : undefined,
    },
    {
      label: "Company Type",
      value: config.company_type ?? "auto",
      // DEFAULT_CONFIG ships `company_type: "auto"`, so the old `!= null` test
      // badged the unset default as a reviewer's choice. "auto" *is* the unset
      // state — the flag below already treated it that way.
      source: config.company_type != null && config.company_type !== "auto" ? "user" : "default",
      flag: config.company_type == null || config.company_type === "auto" ? "warning" : "ok",
      note: config.company_type == null || config.company_type === "auto"
        ? "Auto-detection may misclassify — prefer explicit selection"
        : undefined,
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
