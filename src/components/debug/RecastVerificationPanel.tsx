/* ── Recast Verification — Identity Checks (paper Eq. 2–3) ─────────
   Extracted verbatim from DebugPanel.tsx. Period-selection state remains
   owned by DebugPanel and is passed as props. No logic changes. */

import type { RecastPeriod } from "../../engine/types";
import { PBTStr } from "./debugFormatters";
import { Card, IdentityRow } from "./debugUi";

export function RecastVerificationPanel({
  recastPeriods,
  verifyPeriod,
  selectedPeriodIdx,
  setSelectedPeriodIdx,
}: {
  recastPeriods: RecastPeriod[];
  verifyPeriod: RecastPeriod;
  selectedPeriodIdx: number;
  setSelectedPeriodIdx: (value: number) => void;
}) {
  return (
    <Card title="Recast Verification — Identity Checks (paper Eq. 2–3)">
      {/* Period selector */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {recastPeriods.map((d, i) => (
          <button
            key={i}
            onClick={() => setSelectedPeriodIdx(i)}
            className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
              i === selectedPeriodIdx
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
            }`}
          >
            {d.period_end.slice(0, 7)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-5">
        {/* BS snapshot */}
        <div>
          <h4 className="font-semibold text-slate-600 text-sm mb-3">Balance Sheet</h4>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(verifyPeriod.bs).map(([k, v]) => (
              <div key={k} className="p-2 bg-slate-50 rounded border border-slate-100">
                <div className="text-xs text-slate-400 font-mono">{k}</div>
                <div className="font-mono font-bold text-sm text-slate-800">
                  {(v as number).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* IS snapshot */}
        <div>
          <h4 className="font-semibold text-slate-600 text-sm mb-3">Income Statement</h4>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(verifyPeriod.is).map(([k, v]) => (
              <div key={k} className="p-2 bg-slate-50 rounded border border-slate-100">
                <div className="text-xs text-slate-400 font-mono">{k}</div>
                <div className="font-mono font-bold text-sm text-slate-800">
                  {(v as number).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Identity checks */}
      {(() => {
        const bs = verifyPeriod.bs;
        const is = verifyPeriod.is;
        const ta_check = Math.abs(bs.OA + bs.FA - bs.TA);
        const noa_check = Math.abs(bs.NOA - (bs.OA - bs.OL));
        const nfo_check = Math.abs(bs.NFO - (bs.FO - bs.FA));
        const equity_diff = Math.abs((bs.CSE + bs.MI) - (bs.NOA - bs.NFO));

        // OI identity: OI = CNI + NFE + MII
        // MII = TCI_NCI (shown implicitly as TCI_group - TCI_owners)
        // OI_computed = CNI + NFE (MII already included in CNI computation for standalone)
        const MII_est = is.TCI > 0
          ? Math.max(0, is.TCI - is.CNI - (is.FinanceCost > 0 ? 0 : 0)) // rough
          : 0;
        const oi_from_cni_nfe = is.CNI + is.NFE;
        const oi_from_cni_nfe_mii = oi_from_cni_nfe + MII_est;
        const oi_diff_no_mii = Math.abs(oi_from_cni_nfe - is.OI);
        const oi_diff_with_mii = Math.abs(oi_from_cni_nfe_mii - is.OI);
        const oi_ok = oi_diff_no_mii < 5 || oi_diff_with_mii < 5;

        // Compute MII as TCI - CNI - OI (approximate from stored values)
        const mii_approx = is.TCI !== 0
          ? is.TCI - (is.CNI + (is.PreferredDividend ?? 0)) - is.NFE - is.OI
          : 0;

        return (
          <div className="font-mono text-xs bg-slate-900 text-slate-100 p-4 rounded-lg space-y-2">
            <div className="text-slate-300 text-sm font-sans font-semibold mb-2 pb-2 border-b border-slate-700">
              Identity Checks — {verifyPeriod.period_end}
            </div>

            <IdentityRow
              label="TA = OA + FA"
              lhs={bs.TA.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              rhs={`${bs.OA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} + ${bs.FA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} = ${(bs.OA + bs.FA).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              ok={ta_check < 5}
              diff={ta_check}
            />
            <IdentityRow
              label="NOA = OA − OL"
              lhs={bs.NOA.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              rhs={`${bs.OA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} − ${bs.OL.toLocaleString("en-IN", { maximumFractionDigits: 2 })} = ${(bs.OA - bs.OL).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              ok={noa_check < 2}
              diff={noa_check}
            />
            <IdentityRow
              label="NFO = FO − FA"
              lhs={bs.NFO.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              rhs={`${bs.FO.toLocaleString("en-IN", { maximumFractionDigits: 2 })} − ${bs.FA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} = ${(bs.FO - bs.FA).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              ok={nfo_check < 2}
              diff={nfo_check}
            />
            <IdentityRow
              label="(CSE+MI) = NOA − NFO"
              lhs={(bs.CSE + bs.MI).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              rhs={`${bs.NOA.toLocaleString("en-IN", { maximumFractionDigits: 2 })} − (${bs.NFO.toLocaleString("en-IN", { maximumFractionDigits: 2 })}) = ${(bs.NOA - bs.NFO).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              ok={equity_diff < 5}
              diff={equity_diff}
            />
            <IdentityRow
              label="OI = CNI + NFE"
              lhs={is.OI.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              rhs={`${is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} + (${is.NFE.toLocaleString("en-IN", { maximumFractionDigits: 2 })}) = ${oi_from_cni_nfe.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              ok={oi_ok}
              diff={oi_diff_no_mii}
            />

            {oi_diff_no_mii > 5 && (
              <div className="text-amber-300 text-xs ml-4 border-l-2 border-amber-500 pl-3 py-1">
                ⚠ OI diff = {oi_diff_no_mii.toFixed(1)} ← This is the NCI income share (MII).
                <br />
                OI = CNI + NFE + MII: {is.CNI.toFixed(1)} + ({is.NFE.toFixed(1)}) + ~{(mii_approx).toFixed(1)} = {(is.CNI + is.NFE + mii_approx).toFixed(1)}
                <br />
                <span className="text-slate-400">
                  For consolidated companies, MII = NCI's comprehensive income share.
                  The diff equals the NCI P&L line in the Capitaline P&L export.
                  CNI is correctly computed as TCI_group − TCI_NCI.
                </span>
              </div>
            )}

            <div className="text-slate-400 pt-2 border-t border-slate-700 space-y-0.5">
              <div>Eff. Tax Rate ≈ {PBTStr(is)} | Finance Income (est.): {is.FinanceIncome.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | Finance Cost: {is.FinanceCost.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | NFE: {is.NFE.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
              <div>OI: {is.OI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | CNI: {is.CNI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | TCI group: {is.TCI.toLocaleString("en-IN", { maximumFractionDigits: 2 })} | OCI: {is.OCI.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        );
      })()}
    </Card>
  );
}
