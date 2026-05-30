import { buildValuationCommandCenter, formatPct } from "../../engine/valuationCommandCenter";
import { StatTile } from "./atoms";

export default function BusinessModelSection({
  commandCenter,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Business-model realism</div>
            <div className="mt-2 text-xl font-bold text-slate-900">Persistence evidence from recast history</div>
            <div className="mt-2 text-sm text-slate-600">
              Scenario starting points now blend the latest period with multi-year business evidence instead of treating a single strong year as durable by default.
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Persistence</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{commandCenter.businessModel.persistenceScore.toFixed(0)}</div>
            <div className="text-xs text-slate-500">/100</div>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3 text-sm text-slate-700">
          <StatTile label="Demand stability" value={`${commandCenter.businessModel.demandStabilityScore.toFixed(0)}/100`} />
          <StatTile label="Margin durability" value={`${commandCenter.businessModel.marginDurabilityScore.toFixed(0)}/100`} />
          <StatTile label="Capital intensity" value={`${commandCenter.businessModel.capitalIntensityScore.toFixed(0)}/100`} />
          <StatTile label="Working-capital discipline" value={`${commandCenter.businessModel.workingCapitalDisciplineScore.toFixed(0)}/100`} />
          <StatTile label="Reinvestment quality" value={`${commandCenter.businessModel.reinvestmentQualityScore.toFixed(0)}/100`} />
          <StatTile label="Historical cash conversion" value={formatPct(commandCenter.businessModel.historicalAnchors.cashConversion, 1)} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm text-slate-700">
          <StatTile label="Historical sales growth" value={formatPct(commandCenter.businessModel.historicalAnchors.salesGrowth, 1)} />
          <StatTile label="Historical core PM" value={formatPct(commandCenter.businessModel.historicalAnchors.corePm, 1)} />
          <StatTile label="Historical ATO" value={commandCenter.businessModel.historicalAnchors.ato != null ? `${commandCenter.businessModel.historicalAnchors.ato.toFixed(2)}x` : "—"} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Persistence evidence</div>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {commandCenter.businessModel.evidence.map((item) => (
            <li key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
