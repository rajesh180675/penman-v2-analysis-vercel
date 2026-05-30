import { RecastPeriod } from "../../engine/types";
import { num } from "./AcademicReport.formatters";
import { MiniBox } from "./AcademicUi";

export function BalanceSheetSection({ latest }: { latest: RecastPeriod }) {
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">4) Balance-Sheet Structure and Financing Posture</h2>
        <p className="text-sm text-slate-700 mb-3">
          Latest period decomposition indicates OA = <b>{num(latest.bs.OA)}</b>, FA = <b>{num(latest.bs.FA)}</b>,
          FO = <b>{num(latest.bs.FO)}</b>, and NFO = <b>{num(latest.bs.NFO)}</b>. A negative NFO indicates net financial assets,
          which typically dampens financing risk and shifts valuation reliance toward operating persistence.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <MiniBox label="Operating Liabilities (OL)" value={`₹${num(latest.bs.OL)} Cr`} />
          <MiniBox label="OL ex DTL base" value={`₹${num(latest.bs.OL_ex_DTL)} Cr`} />
          <MiniBox label="Imputed OL interest (io)" value={`₹${num(latest.ratios?.io)} Cr`} />
        </div>
      </section>
  );
}
