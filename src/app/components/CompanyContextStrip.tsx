import { RecastPeriod, EngineConfig } from "../../engine/types";
import { DataFreshness, SourceBadge, Sparkline } from "../../components/shared/DesignSystem";
import { AuditSubmissionMeta } from "../../lib/audit";

interface CompanyContextStripProps {
  config: EngineConfig;
  recastData: RecastPeriod[] | null;
  auditMeta: AuditSubmissionMeta | null;
  qualityGate: { tier: string } | null;
}

export function CompanyContextStrip({ config, recastData, auditMeta, qualityGate }: CompanyContextStripProps) {
  return (
    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800 sticky top-14 z-20">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">
            {config.ticker ?? config.quality_data_folder ?? auditMeta?.companyId ?? "—"}
          </span>
          <span className="badge-neutral">{config.company_type ?? "auto"}</span>
          {recastData && recastData.length > 0 && (
            <>
              <span className="text-xs text-slate-500">{recastData.length} periods</span>
              <DataFreshness latestPeriod={recastData[recastData.length - 1]!.period_end} />
              <SourceBadge source="capitaline" />
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {config.market_price != null && (
            <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">₹{config.market_price.toFixed(0)}</span>
          )}
          {recastData && recastData.length >= 3 && (
            <Sparkline
              data={recastData.map(d => d.ratios?.ROCE ?? null)}
              width={48}
              height={16}
              color={recastData[recastData.length - 1]?.ratios?.ROCE != null &&
                     recastData[recastData.length - 2]?.ratios?.ROCE != null &&
                     (recastData[recastData.length - 1]!.ratios!.ROCE! >= recastData[recastData.length - 2]!.ratios!.ROCE!)
                     ? "#10b981" : "#ef4444"}
            />
          )}
          {qualityGate && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              qualityGate.tier === "Tier 1" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
              qualityGate.tier === "Tier 2" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
              "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
            }`}>{qualityGate.tier}</span>
          )}
        </div>
      </div>
    </div>
  );
}
