import { buildValuationCommandCenter, formatPct } from "../../engine/valuationCommandCenter";
import { StatTile } from "./atoms";

export default function ChecklistMarketSection({
  commandCenter,
  fmt,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
  fmt: (n: number) => string;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thesis Checklist</div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 font-semibold text-slate-800">What Must Go Right</div>
            <ul className="space-y-2 text-sm text-slate-700">
              {commandCenter.checklist.whatMustGoRight.map((item) => (
                <li key={item} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 font-semibold text-slate-800">What Breaks The Thesis</div>
            <ul className="space-y-2 text-sm text-slate-700">
              {commandCenter.checklist.thesisBreakers.map((item) => (
                <li key={item} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Forecast discipline</div>
          <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800">
            {commandCenter.opportunity.persistenceNarrative}
          </div>
          <ul className="mt-3 space-y-2">
            {commandCenter.checklist.forecastDiscipline.map((item) => (
              <li key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-2">{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Market Context</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-slate-700">
          <StatTile label="Expected return spread vs risk-free" value={formatPct(commandCenter.marketContext.expectedReturnSpreadVsRf, 1)} />
          <StatTile label="Price / stress value" value={commandCenter.marketContext.priceToStressValueRatio != null ? `${commandCenter.marketContext.priceToStressValueRatio.toFixed(2)}x` : "—"} />
          <StatTile label="Implied market cap" value={commandCenter.marketContext.marketCapFromPrice != null ? `₹${fmt(commandCenter.marketContext.marketCapFromPrice)} Cr` : "—"} />
          <StatTile label="Implied enterprise value" value={commandCenter.marketContext.enterpriseValueFromPrice != null ? `₹${fmt(commandCenter.marketContext.enterpriseValueFromPrice)} Cr` : "—"} />
        </div>
      </div>
    </section>
  );
}
