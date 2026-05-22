/**
 * Business Model Report — deep-dive analysis through Buffett lenses.
 *
 * Subtype-aware: industrials and financial institutions have FUNDAMENTALLY
 * different business models. Buffett values them through different frames.
 *
 * INDUSTRIALS (DuPont-style, operational):
 *   1. DuPont 5-step           — what drives ROE? (margin × turnover × leverage)
 *   2. Margin Cascade          — where does each rupee of revenue leak?
 *   3. Cash Conversion Cycle   — does the business consume or generate cash?
 *   4. Capital Allocation      — where does retained cash go?
 *   5. Compounder Test         — ROIC × reinvestment rate (Buffett's quality screen)
 *
 * FINANCIAL INSTITUTIONS (banks, NBFCs, insurers):
 *   1. Earning Power           — NIM × asset leverage = ROE (DuPont-for-banks)
 *   2. Asset Quality           — GNPA/NNPA trajectory + credit cost cycle
 *   3. Operating Efficiency    — cost-to-income evolution
 *   4. Capital Cushion         — CRAR vs regulatory floor, headroom for growth
 *   5. BV Compounder Quality   — book value CAGR + dividend consistency
 *
 * For insurers: capital cushion view shifts to float economics + solvency.
 *
 * No commercial fundamental tool ties these together. They show line
 * charts; we show the structural logic OF the business — separately
 * for the two distinct economic engines.
 */
import { useState } from "react";
import type { RecastPeriod } from "../../engine/types";
import type { PipelineResult } from "../../engine/pipeline";
import { SectionHeader } from "../shared/DesignSystem";

// Industrial sub-views
import DuPontDecomposition from "./industrial/DuPontDecomposition";
import MarginCascade from "./industrial/MarginCascade";
import CashConversionCycle from "./industrial/CashConversionCycle";
import CapitalAllocation from "./industrial/CapitalAllocation";
import CompounderTest from "./industrial/CompounderTest";

// Financial sub-views
import EarningPower from "./financial/EarningPower";
import AssetQuality from "./financial/AssetQuality";
import OperatingEfficiency from "./financial/OperatingEfficiency";
import CapitalCushion from "./financial/CapitalCushion";
import BVCompounder from "./financial/BVCompounder";

interface Props {
  pipelineResult: PipelineResult | null;
  recastData: RecastPeriod[] | null;
}

type IndustrialView = "dupont" | "cascade" | "ccc" | "capital" | "compounder";
type FinancialView = "earning" | "asset" | "efficiency" | "cushion" | "bvc";
type ViewId = IndustrialView | FinancialView;

interface ViewSpec {
  id: ViewId;
  label: string;
  icon: string;
  tagline: string;
}

const INDUSTRIAL_VIEWS: ViewSpec[] = [
  { id: "dupont",     label: "DuPont 5-Step",       icon: "⚙️", tagline: "Decompose ROE: tax × interest × margin × turnover × leverage" },
  { id: "cascade",    label: "Margin Cascade",      icon: "💧", tagline: "Revenue → Gross → EBITDA → EBIT → PBT → Net" },
  { id: "ccc",        label: "Cash Cycle",          icon: "🔄", tagline: "Days inventory + receivables − payables = working capital intensity" },
  { id: "capital",    label: "Capital Allocation",  icon: "🏗️", tagline: "Where retained cash goes: CapEx, dividends, buybacks, debt" },
  { id: "compounder", label: "Compounder Test",     icon: "📈", tagline: "ROIC × reinvestment rate — Buffett's quality screen" },
];

const FINANCIAL_VIEWS: ViewSpec[] = [
  { id: "earning",    label: "Earning Power",       icon: "⚡", tagline: "NIM × leverage = ROE (the DuPont for banks)" },
  { id: "asset",      label: "Asset Quality",       icon: "🛡️", tagline: "GNPA/NNPA trajectory + credit cost cycle" },
  { id: "efficiency", label: "Op Efficiency",       icon: "⚖️", tagline: "Cost-to-income evolution (under 40% = wonderful)" },
  { id: "cushion",    label: "Capital / Float",     icon: "🏦", tagline: "CRAR cushion + float economics" },
  { id: "bvc",        label: "BV Compounder",       icon: "📈", tagline: "Book value CAGR + dividend consistency" },
];

export default function BusinessModelReport({ pipelineResult, recastData }: Props) {
  const isFinancial = pipelineResult?.analysisFamily === "financial-institution";
  const subtype = pipelineResult?.bankResult?.subtype;
  const VIEWS = isFinancial ? FINANCIAL_VIEWS : INDUSTRIAL_VIEWS;
  const [view, setView] = useState<ViewId>(VIEWS[0].id);

  // Insufficient data guard
  if (isFinancial) {
    const metrics = pipelineResult?.bankResult?.bankMetrics ?? [];
    if (metrics.length === 0) {
      return <EmptyState message="Business Model needs bank/NBFC/insurance pipeline output. Load a financial-institution company first." />;
    }
  } else {
    if (!recastData || recastData.length === 0) {
      return <EmptyState message="Business Model needs Penman-Nissim recast data. Load an industrial company first." />;
    }
  }

  const headerSubtype = isFinancial
    ? subtype === "insurance"
      ? "Insurance"
      : subtype === "nbfc"
      ? "NBFC"
      : "Bank"
    : "Industrial";

  const headerTagline = isFinancial
    ? "Five Buffett lenses for financial institutions: earning power, asset quality, efficiency, capital cushion, BV compounding. Banks earn spreads on leveraged balance sheets — entirely different math from operating businesses."
    : "Five Buffett lenses every serious analyst applies. DuPont reveals the ROE engine, cascade exposes margin leakage, cash cycle measures working-capital intensity, capital allocation shows what management does with cash, compounder test grades quality.";

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className={`rounded-xl border p-5 ${
        isFinancial
          ? "border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 dark:border-blue-900/40 dark:from-blue-950/30 dark:to-indigo-950/30"
          : "border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 dark:border-amber-900/40 dark:from-amber-950/30 dark:to-orange-950/30"
      }`}>
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none">{isFinancial ? "🏦" : "🏛️"}</div>
          <div className="flex-1">
            <h2 className={`text-base font-semibold ${
              isFinancial ? "text-blue-900 dark:text-blue-200" : "text-amber-900 dark:text-amber-200"
            }`}>
              Business Model — How This Company Actually Makes Money
            </h2>
            <p className={`text-xs mt-1 max-w-3xl ${
              isFinancial ? "text-blue-800/80 dark:text-blue-300/80" : "text-amber-800/80 dark:text-amber-300/80"
            }`}>
              {headerTagline}
            </p>
          </div>
          <div className="text-right">
            <div className={`text-[10px] font-mono uppercase ${
              isFinancial ? "text-blue-700 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"
            }`}>Subtype</div>
            <div className={`text-xs font-semibold ${
              isFinancial ? "text-blue-900 dark:text-blue-200" : "text-amber-900 dark:text-amber-200"
            }`}>
              {headerSubtype}
            </div>
          </div>
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {VIEWS.map((v) => {
          const active = v.id === view;
          const activeCls = isFinancial
            ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/40"
            : "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40";
          const activeText = isFinancial ? "text-blue-900 dark:text-blue-200" : "text-amber-900 dark:text-amber-200";
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                active
                  ? activeCls
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:bg-slate-900/70"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{v.icon}</span>
                <span className={`text-sm font-semibold ${active ? activeText : "text-slate-700 dark:text-slate-200"}`}>
                  {v.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">
                {v.tagline}
              </p>
            </button>
          );
        })}
      </div>

      {/* Active view */}
      <div className="min-h-[400px]">
        {!isFinancial && recastData && (
          <>
            {view === "dupont"     && <DuPontDecomposition recastData={recastData} />}
            {view === "cascade"    && <MarginCascade recastData={recastData} />}
            {view === "ccc"        && <CashConversionCycle recastData={recastData} />}
            {view === "capital"    && <CapitalAllocation recastData={recastData} />}
            {view === "compounder" && <CompounderTest recastData={recastData} />}
          </>
        )}
        {isFinancial && pipelineResult?.bankResult && (
          <>
            {view === "earning"    && <EarningPower bankResult={pipelineResult.bankResult} />}
            {view === "asset"      && <AssetQuality bankResult={pipelineResult.bankResult} />}
            {view === "efficiency" && <OperatingEfficiency bankResult={pipelineResult.bankResult} />}
            {view === "cushion"    && <CapitalCushion bankResult={pipelineResult.bankResult} subtype={subtype} />}
            {view === "bvc"        && <BVCompounder bankResult={pipelineResult.bankResult} />}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900/60">
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
