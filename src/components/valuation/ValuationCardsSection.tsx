import { computeValuation } from "../../engine/PenmanNissimEngine";
import { toPerShare } from "../../engine/shareCountTools";
import { ValCard } from "./atoms";
import { type CVMethod, fmt, fmtPerShare } from "./ValuationReport.formatters";

export default function ValuationCardsSection({
  val,
  V_RE,
  V_ReOI,
  cv,
  sharesOut,
}: {
  val: ReturnType<typeof computeValuation>;
  V_RE: number | null;
  V_ReOI: number;
  cv: CVMethod;
  sharesOut: number | null;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <ValCard color="indigo" title={`V (RE · ${cv})`} subtitle="Eq.(1a) · Clean surplus" value={V_RE}
        items={V_RE == null ? [] : [
          { l: "CSE₀ (base book value)", v: val.CSE0 },
          { l: "PV of RE series", v: val.pvRE },
          { l: `CV PV (${cv})`, v: V_RE - val.CSE0 - val.pvRE },
        ]} fmt={fmt}
        perShare={V_RE == null ? null : toPerShare(V_RE, sharesOut)}
        skipReason={val.equityModelsBlocked ? val.equityBlockedReason ?? "Equity-side model skipped (negative net worth)." : null}
      />
      <ValCard color="emerald" title={`V (ReOI · ${cv === "CV1" ? "CV01" : cv === "CV2" ? "CV02" : "CV03"})`}
        subtitle="Eq.(9) · Ops-only · EV−NFO" value={V_ReOI}
        items={[
          { l: "EV (NOA₀ + PV ReOI + CV)", v: val.EV_ReOI },
          { l: "Less: NFO (latest)", v: -val.NFO_latest },
          { l: "PV ReOI", v: val.pvReOI },
        ]} fmt={fmt}
        perShare={toPerShare(V_ReOI, sharesOut)}
      />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">All CV Methods — RE</div>
        {[
          { label: "CV1 (zero)", v: val.V_RE_CV1 },
          { label: "CV2 (perp.)", v: val.V_RE_CV2 },
          { label: "CV3 (growth)", v: val.V_RE_CV3 },
        ].map((row) => (
          <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-mono font-semibold text-indigo-700">
              {row.v == null
                ? <span className="text-amber-600">— (skipped)</span>
                : sharesOut
                  ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share`
                  : `₹${fmt(row.v)} Cr`}
            </span>
          </div>
        ))}
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-3">All CV Methods — ReOI</div>
        {[
          { label: "CV01 (zero)", v: val.V_ReOI_CV01 },
          { label: "CV02 (perp.)", v: val.V_ReOI_CV02 },
          { label: "CV03 (growth)", v: val.V_ReOI_CV03 },
        ].map((row) => (
          <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-mono font-semibold text-emerald-700">
              {sharesOut ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share` : `₹${fmt(row.v)} Cr`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
