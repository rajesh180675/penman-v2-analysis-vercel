import { AuditSubmissionMeta } from "../../lib/audit";
import { EngineConfig, RawPeriodData, RecastPeriod } from "../../engine/types";

interface CompanyOption {
  companyId: string;
  label: string;
}

interface Props {
  effectiveCompanyId: string;
  auditMeta?: AuditSubmissionMeta | null | undefined;
  rawData: RawPeriodData[] | null;
  recastData: RecastPeriod[] | null;
  config: EngineConfig;
  companyOptions: CompanyOption[];
  setCompanyId: (companyId: string) => void;
}

export default function WorkspaceHero({
  effectiveCompanyId,
  auditMeta,
  rawData,
  recastData,
  config,
  companyOptions,
  setCompanyId,
}: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Company Workspace
          </div>
          <h2 className="mt-3 text-2xl font-bold text-slate-900">{effectiveCompanyId}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            This is the investor operating system for the current codebase: filings, research notes, signal history, valuation memory, and portfolio actions in one place.
          </p>
          {(auditMeta || rawData?.length || recastData?.length) && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              {auditMeta && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">source {auditMeta.sourceMode}</span>}
              {config.market_data_symbol && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">symbol {config.market_data_symbol}</span>}
              {config.sector_template && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">template {config.sector_template}</span>}
              {recastData?.length ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{recastData.length} recast periods</span> : null}
            </div>
          )}
        </div>
        <div className="min-w-[240px]">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Selected company</label>
          <select
            value={effectiveCompanyId}
            onChange={(event) => setCompanyId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {companyOptions.map((option) => (
              <option key={option.companyId} value={option.companyId}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
