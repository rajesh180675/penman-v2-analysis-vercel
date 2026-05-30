import { num, pct } from "./AcademicReport.formatters";
import type { NoaDiagnostics, NoaShiftSeries, V3Bundle } from "./AcademicReport.types";

export function NoaDenominatorSection(props: {
  noaDiagnostics: NoaDiagnostics;
  noaFlagCount: number;
}) {
  const { noaDiagnostics, noaFlagCount } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">3A) NOA denominator diagnostics (all periods)</h2>
        <p className="text-sm text-slate-700 mb-3">Flag rule: |NOA| &lt; 10% of Sales. Flagged periods: <b>{noaFlagCount}</b> / {noaDiagnostics.length}.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">NOA (₹ Cr)</th>
                <th className="px-2 py-1 text-right">Sales (₹ Cr)</th>
                <th className="px-2 py-1 text-right">|NOA|/Sales</th>
                <th className="px-2 py-1 text-left">Flag</th>
                <th className="px-2 py-1 text-left">Regime</th>
                <th className="px-2 py-1 text-left">Interpretation</th>
                <th className="px-2 py-1 text-left">Lease era</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {noaDiagnostics.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">{num(row.noa)}</td>
                  <td className="px-2 py-1 text-right">{num(row.sales)}</td>
                  <td className="px-2 py-1 text-right">{pct(row.noaToSales, 1)}</td>
                  <td className="px-2 py-1">{row.flagged ? "⚠️ small NOA" : "OK"}</td>
                  <td className="px-2 py-1">{row.indAs116Era ? "FY2020+" : "Pre-FY2020"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
  );
}

export function NoaStructuralBreakSection(props: {
  largestNoaShift: NoaShiftSeries[number];
  noaShiftSeries: NoaShiftSeries;
  v3Bundle: V3Bundle | null;
}) {
  const { largestNoaShift, noaShiftSeries, v3Bundle } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">3B) NOA structural-break diagnostics</h2>
        <p className="text-sm text-slate-700 mb-3">
          Largest year-on-year NOA shift occurred in <b>{largestNoaShift.period.slice(0, 10)}</b>: ΔNOA <b>₹{num(largestNoaShift.deltaNOA)} Cr</b>,
          decomposed into ΔOA <b>₹{num(largestNoaShift.deltaOA)} Cr</b>, ΔOL <b>₹{num(largestNoaShift.deltaOL)} Cr</b>,
          ΔFA <b>₹{num(largestNoaShift.deltaFA)} Cr</b>, ΔFO <b>₹{num(largestNoaShift.deltaFO)} Cr</b>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left">Period</th>
                <th className="px-2 py-1 text-right">ΔNOA</th>
                <th className="px-2 py-1 text-right">ΔOA</th>
                <th className="px-2 py-1 text-right">ΔOL</th>
                <th className="px-2 py-1 text-right">ΔFA</th>
                <th className="px-2 py-1 text-right">ΔFO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {noaShiftSeries.map((row) => (
                <tr key={row.period}>
                  <td className="px-2 py-1">{row.period.slice(0, 10)}</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaNOA)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaOA)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaOL)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaFA)} Cr</td>
                  <td className="px-2 py-1 text-right">₹{num(row.deltaFO)} Cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v3Bundle?.oaDecomposition?.length ? (
          <div className="mt-4 space-y-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">OA decomposition for selected structural periods</div>
            {v3Bundle.oaDecomposition.map((d) => (
              <div key={d.period_end} className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs font-semibold text-slate-700 mb-2">{d.period_end.slice(0, 10)}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-2 py-1 text-right">ΔPPE</th>
                        <th className="px-2 py-1 text-right">ΔROU</th>
                        <th className="px-2 py-1 text-right">ΔInventory</th>
                        <th className="px-2 py-1 text-right">ΔReceivables</th>
                        <th className="px-2 py-1 text-right">ΔGoodwill</th>
                        <th className="px-2 py-1 text-right">ΔIntangibles</th>
                        <th className="px-2 py-1 text-right">ΔCWIP</th>
                        <th className="px-2 py-1 text-right">ΔDTA</th>
                        <th className="px-2 py-1 text-right">ΔOther OA</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaPPE)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaROU)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaInventory)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaReceivables)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaGoodwill)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaIntangibles)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaCWIP)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaDTA)} Cr</td>
                        <td className="px-2 py-1 text-right">₹{num(d.components.deltaOtherOA)} Cr</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {d.interpretation && <p className="text-xs text-slate-500 mt-2">{d.interpretation}</p>}
              </div>
            ))}
          </div>
        ) : null}
      </section>
  );
}
