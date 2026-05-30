import { buildValuationCommandCenter, formatPct, formatPerShare } from "../../engine/valuationCommandCenter";
import { StatTile } from "./atoms";

export default function DcfLensSection({
  commandCenter,
  fmt,
}: {
  commandCenter: ReturnType<typeof buildValuationCommandCenter>;
  fmt: (n: number) => string;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">DCF Cash-Flow Lens</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-slate-700">
          <StatTile label="Owner earnings / share" value={formatPerShare(commandCenter.diagnostics.ownerEarningsPerShare)} />
          <StatTile label="NOPAT" value={commandCenter.diagnostics.nopat != null ? `₹${fmt(commandCenter.diagnostics.nopat)} Cr` : "—"} />
          <StatTile label="Maintenance capex" value={`₹${fmt(commandCenter.diagnostics.maintenanceCapex)} Cr`} />
          <StatTile label="Growth capex" value={`₹${fmt(commandCenter.diagnostics.growthCapex)} Cr`} />
          <StatTile label="Working-capital investment" value={`₹${fmt(commandCenter.diagnostics.workingCapitalInvestment)} Cr`} />
          <StatTile label="Reinvestment rate" value={formatPct(commandCenter.diagnostics.reinvestmentRate, 1)} />
          <StatTile label="Incremental ROIC" value={formatPct(commandCenter.diagnostics.incrementalRoic, 1)} />
          <StatTile label="Maintenance share of capex" value={formatPct(commandCenter.diagnostics.maintenanceCapexShareOfCapex, 1)} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Professional Decision Rules</div>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            `Truck-load zone` only appears when the stress case clears the required margin of safety, the current price is historically washed out, and the analysis is still production-ready.
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            Quality adjusts the hurdle: weaker accounting quality and more cyclical templates widen the required margin of safety before the buy signal is allowed to escalate.
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            Reverse DCF keeps the valuation honest by checking whether the market is already pricing an aggressive owner-earnings path.
          </div>
        </div>
      </div>
    </section>
  );
}
