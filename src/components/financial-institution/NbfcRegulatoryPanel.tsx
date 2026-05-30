import type { NbfcSidecarData } from "../../engine/nbfcSidecarLoader";
import { fmtNum } from "./financialInstitutionFormatters";

/**
 * Phase D4 — LGD Stage Migration + RBI NHB Regulatory Metrics Panel.
 *
 * Shows the ECL stage migration matrix (from LGD sidecar files) and
 * key regulatory metrics from the RBI NHB disclosure.
 */
export function NbfcRegulatoryPanel({ sidecar }: { sidecar: NbfcSidecarData }) {
  const { lgd, rbiNhb } = sidecar;
  if (lgd.length === 0 && rbiNhb.length === 0) return null;

  // Latest LGD matrix
  const latestLgd = lgd.length > 0 ? lgd[lgd.length - 1] : null;

  // RBI NHB: filter to periods with actual data
  const nhbWithData = rbiNhb.filter(p =>
    (p.gnpa_cr != null && p.gnpa_cr > 0) ||
    (p.crar_pct != null && p.crar_pct > 0)
  );

  return (
    <section className="space-y-6">
      <div>
        <h3 className="font-semibold mb-1">Regulatory Disclosures (LGD + RBI NHB)</h3>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Stage migration matrices from Capitaline &ldquo;Loss Given Default&rdquo; export
          ({lgd.length} periods) and RBI/NHB regulatory metrics ({nhbWithData.length} periods with data).
        </div>
      </div>

      {/* LGD Stage Migration — latest year */}
      {latestLgd && latestLgd.gross_carrying.closing && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            ECL Stage Migration — {latestLgd.fiscal_label} (Gross Carrying Amount, \u20b9 Cr)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left py-1.5 px-2">Movement</th>
                  <th className="text-right py-1.5 px-2">Stage 1</th>
                  <th className="text-right py-1.5 px-2">Stage 2</th>
                  <th className="text-right py-1.5 px-2">Stage 3</th>
                  <th className="text-right py-1.5 px-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["Opening Balance", latestLgd.gross_carrying.opening],
                  ["New Business (net)", latestLgd.gross_carrying.new_business],
                  ["Credit Worthiness Transfer", latestLgd.gross_carrying.credit_worthiness_transfer],
                  ["Write-offs", latestLgd.gross_carrying.writeoff],
                  ["Transfer to Stage 1", latestLgd.gross_carrying.transfer_to_s1],
                  ["Transfer to Stage 2", latestLgd.gross_carrying.transfer_to_s2],
                  ["Transfer to Stage 3", latestLgd.gross_carrying.transfer_to_s3],
                  ["Closing Balance", latestLgd.gross_carrying.closing],
                ] as [string, { stage1: number | null; stage2: number | null; stage3: number | null; total: number | null } | null][]).filter(([, v]) => v != null).map(([label, vals]) => {
                  const isClosing = label === "Closing Balance" || label === "Opening Balance";
                  return (
                    <tr key={label} className={`border-b border-slate-100 dark:border-slate-800 ${isClosing ? "font-semibold bg-slate-50/50 dark:bg-slate-800/30" : ""}`}>
                      <td className="py-1 px-2">{label}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.stage1)}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.stage2)}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.stage3)}</td>
                      <td className="text-right py-1 px-2 font-mono">{fmtNum(vals!.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* LGD trend: Stage 3 closing over time */}
          {lgd.length > 1 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Stage 3 Gross Carrying &amp; Write-offs Trend
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left py-1 px-2">FY</th>
                      <th className="text-right py-1 px-2">S3 Opening</th>
                      <th className="text-right py-1 px-2">New to S3</th>
                      <th className="text-right py-1 px-2">Write-offs</th>
                      <th className="text-right py-1 px-2">S3 Closing</th>
                      <th className="text-right py-1 px-2">Total Book</th>
                      <th className="text-right py-1 px-2">S3 %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lgd.map(m => {
                      const s3Close = m.gross_carrying.closing?.stage3 ?? null;
                      const totalClose = m.gross_carrying.closing?.total ?? null;
                      const s3Pct = s3Close != null && totalClose != null && totalClose > 0
                        ? (s3Close / totalClose * 100).toFixed(2) + "%"
                        : "—";
                      return (
                        <tr key={m.fiscal_label} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-1 px-2 font-mono">{m.fiscal_label}</td>
                          <td className="text-right py-1 px-2 font-mono">{fmtNum(m.gross_carrying.opening?.stage3 ?? null)}</td>
                          <td className="text-right py-1 px-2 font-mono">{fmtNum(m.gross_carrying.transfer_to_s3?.stage3 ?? null)}</td>
                          <td className="text-right py-1 px-2 font-mono text-rose-600 dark:text-rose-400">{fmtNum(m.gross_carrying.writeoff?.stage3 ?? null)}</td>
                          <td className="text-right py-1 px-2 font-mono font-semibold">{fmtNum(s3Close)}</td>
                          <td className="text-right py-1 px-2 font-mono">{fmtNum(totalClose)}</td>
                          <td className="text-right py-1 px-2 font-mono">{s3Pct}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RBI NHB — NPA Movement + Capital Adequacy */}
      {nhbWithData.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            RBI/NHB Regulatory Metrics ({nhbWithData.length} periods)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left py-1.5 px-2">Period</th>
                  <th className="text-right py-1.5 px-2">GNPA (Cr)</th>
                  <th className="text-right py-1.5 px-2">NNPA (Cr)</th>
                  <th className="text-right py-1.5 px-2">NNPA %</th>
                  <th className="text-right py-1.5 px-2">CRAR %</th>
                  <th className="text-right py-1.5 px-2">Tier-1 %</th>
                  <th className="text-right py-1.5 px-2">Provisions (Cr)</th>
                  <th className="text-right py-1.5 px-2">Additions (Cr)</th>
                </tr>
              </thead>
              <tbody>
                {nhbWithData.slice(0, 12).map(p => (
                  <tr key={p.period_code} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1 px-2 font-mono">{p.fiscal_label}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.gnpa_cr)}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.nnpa_cr)}</td>
                    <td className="text-right py-1 px-2 font-mono">{p.nnpa_pct != null ? p.nnpa_pct.toFixed(2) + "%" : "—"}</td>
                    <td className="text-right py-1 px-2 font-mono">{p.crar_pct != null && p.crar_pct > 0 ? p.crar_pct.toFixed(2) + "%" : "—"}</td>
                    <td className="text-right py-1 px-2 font-mono">{p.tier1_pct != null && p.tier1_pct > 0 ? p.tier1_pct.toFixed(2) + "%" : "—"}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.provisions_closing_cr)}</td>
                    <td className="text-right py-1 px-2 font-mono">{fmtNum(p.gnpa_additions_cr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
