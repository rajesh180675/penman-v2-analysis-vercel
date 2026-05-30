import { RecastPeriod } from "../../engine/types";
import { num, pct } from "./AcademicReport.formatters";
import type { V3Bundle } from "./AcademicReport.types";

export function QualityScoreSection(props: {
  latest: RecastPeriod;
  dilutionRecent: number;
}) {
  const { latest, dilutionRecent } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6C) Quality Score Decomposition</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h3 className="font-semibold text-slate-700 mb-2">Piotroski components</h3>
            <ul className="space-y-1 text-slate-700">
              <li>ROA positive: <b>{latest.quality?.piotroski_roa ?? "—"}</b></li>
              <li>ΔROA positive: <b>{latest.quality?.piotroski_delta_roa ?? "—"}</b></li>
              <li>CFO positive: <b>{latest.quality?.piotroski_cfo ?? "—"}</b></li>
              <li>CFO &gt; NI: <b>{latest.quality?.piotroski_accrual ?? "—"}</b></li>
              <li>Leverage down: <b>{latest.quality?.piotroski_leverage ?? "—"}</b></li>
              <li>Liquidity up: <b>{latest.quality?.piotroski_liquidity ?? "—"}</b></li>
              <li>No dilution: <b>{latest.quality?.piotroski_dilution ?? "—"}</b> (recent 5Y equity issuance: ₹{num(dilutionRecent)} Cr)</li>
              <li>Margin up: <b>{latest.quality?.piotroski_margin ?? "—"}</b></li>
              <li>Turnover up: <b>{latest.quality?.piotroski_turnover ?? "—"}</b></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-slate-700 mb-2">Altman Z' components</h3>
            <ul className="space-y-1 text-slate-700">
              <li>WC / TA: <b>{num(latest.quality?.altman_wc_ta, 3)}</b></li>
              <li>RE / TA: <b>{num(latest.quality?.altman_re_ta, 3)}</b></li>
              <li>EBIT / TA: <b>{num(latest.quality?.altman_ebit_ta, 3)}</b></li>
              <li>BVE / TL: <b>{num(latest.quality?.altman_bve_tl, 3)}</b></li>
              <li>Sales / TA: <b>{num(latest.quality?.altman_s_ta, 3)}</b></li>
            </ul>
            <p className="text-xs text-slate-500 mt-2">Altman Z' can understate safety for cash-rich firms because large financial assets raise total assets but do not proportionally raise EBIT.</p>
          </div>
        </div>
      </section>
  );
}

export function InvestmentInterpretationSection(props: {
  companyId: string;
  latest: RecastPeriod;
  v3Bundle: V3Bundle | null;
  dividendCashGap: number;
  faRunwayYears: number | null;
  latestRe: number | null;
}) {
  const { companyId, latest, v3Bundle, dividendCashGap, faRunwayYears, latestRe } = props;
  return (
      <section className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">7) Investment Interpretation and Monitoring Triggers</h2>
        <div className="text-sm text-slate-700 space-y-2">
          <p>
            <b>Base thesis support</b>: Persistent positive spread and stable/expanding PM with non-collapsing ATO indicate
            economic profitability above financing cost.
          </p>
          <p>
            <b>Primary downside triggers</b>: (i) spread compression via declining PM or rising NBC, (ii) accrual ratio drift above
            10%, (iii) Beneish flag migration above -1.78, (iv) Altman Z' migration toward distress band.
          </p>
          <p>
            <b>{companyId}-specific trigger — PM path</b>: PM is currently <b>{pct(latest.ratios?.PM)}</b>. Calibration base: <b>{pct(v3Bundle?.triggerCalibration.pm_base)}</b> ({v3Bundle?.triggerCalibration.pm_base_source ?? "latest"}). If PM falls below <b>{pct(v3Bundle?.triggerCalibration.pm_warning, 0)}</b>,
            re-underwrite with ke stress and steeper fade; below <b>{pct(v3Bundle?.triggerCalibration.pm_critical, 0)}</b>, valuation approaches lower sensitivity bounds.
          </p>
          <p>
            <b>{companyId}-specific trigger — dividend sustainability</b>: Dividend vs cash FCF gap is <b>₹{num(dividendCashGap)} Cr</b>
            ({dividendCashGap > 0 ? `FA runway ~${num(faRunwayYears, 1)} years at current gap.` : "covered by cash FCF."}).
          </p>
          <p>
            <b>{companyId}-specific trigger — capacity return realization</b>: Monitor whether RNOA remains above <b>{pct(v3Bundle?.triggerCalibration.rnoa_threshold, 0)}</b> and RE above
            <b> ₹{num(v3Bundle?.triggerCalibration.re_threshold)} Cr</b> (latest RE: <b>₹{num(latestRe)} Cr</b>).
          </p>
          <p>
            <b>Process recommendation</b>: update this report each filing cycle; monitor Eq.(4)/(7)/(15) residuals and mapping quality
            diagnostics to ensure model integrity remains audit-grade.
          </p>
        </div>
      </section>
  );
}
