import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { EngineConfig, NP_BENCHMARKS, RecastPeriod } from "../engine/types";
import { computeValuation } from "../engine/PenmanNissimEngine";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
}

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: d });

function cagr(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

function avg(vals: Array<number | null | undefined>): number | null {
  const f = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!f.length) return null;
  return f.reduce((s, v) => s + v, 0) / f.length;
}

export default function AcademicReport({ data, config }: Props) {
  const reportRef = useRef<HTMLDivElement | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const exportPdf = async () => {
    if (!reportRef.current || exportingPdf) return;
    setExportingPdf(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#f8fafc",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 8;
      const printWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * printWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = margin;

      pdf.addImage(imgData, "PNG", margin, position, printWidth, imgHeight, undefined, "FAST");
      heightLeft -= pageHeight - margin * 2;

      while (heightLeft > 0) {
        position = margin - (imgHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, "PNG", margin, position, printWidth, imgHeight, undefined, "FAST");
        heightLeft -= pageHeight - margin * 2;
      }

      const latestPeriod = data[data.length - 1]?.period_end?.slice(0, 10) ?? "latest";
      pdf.save(`academic_report_${latestPeriod}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  };

  if (!data || data.length < 2) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
        <p className="font-semibold text-amber-800 text-lg">Need at least 2 periods to generate report</p>
        <p className="text-amber-700 text-sm mt-1">Upload full history to produce a rigorous academic narrative.</p>
      </div>
    );
  }

  const latest = data[data.length - 1];
  const first = data[0];
  const years = Math.max(data.length - 1, 1);
  const trailing = data.slice(Math.max(0, data.length - 5));

  const salesCagr = cagr(first.is.Sales, latest.is.Sales, years);
  const cniCagr = cagr(first.is.CNI, latest.is.CNI, years);
  const cseCagr = cagr(first.bs.CSE, latest.bs.CSE, years);

  const roce5 = avg(trailing.map((d) => d.ratios?.ROCE));
  const rnoa5 = avg(trailing.map((d) => d.ratios?.RNOA));
  const spread5 = avg(trailing.map((d) => d.ratios?.SPREAD));
  const pm5 = avg(trailing.map((d) => d.ratios?.PM));
  const ato5 = avg(trailing.map((d) => d.ratios?.ATO));
  const accrual5 = avg(trailing.map((d) => d.ratios?.accrual_ratio_bs));
  const ccr5 = avg(trailing.map((d) => d.ratios?.cash_conversion_ratio));

  const ke = config.risk_free_rate + config.equity_risk_premium;
  const kw = config.risk_free_rate;
  const g = Math.min(0.05, Math.max(0.02, (salesCagr ?? 0.04) * 0.5));
  const valuation = computeValuation(data, ke, kw, g, config);

  const fScore = latest.quality?.piotroski_total ?? null;
  const mScore = latest.quality?.beneish_mscore ?? null;
  const zScore = latest.quality?.altman_zprime ?? null;

  const zZone = zScore == null ? "N/A" : zScore > 2.9 ? "Safe" : zScore > 1.23 ? "Grey" : "Distress";
  const mFlag = mScore != null && mScore > -1.78;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={exportPdf}
          disabled={exportingPdf}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${
            exportingPdf
              ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          {exportingPdf ? "Generating PDF..." : "Export Report as PDF"}
        </button>
      </div>

      <div ref={reportRef} className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800">Investor Research Memorandum (Academic Format)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Framework: Nissim &amp; Penman (2001), residual-income valuation with operating/financing recast under Ind AS.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5">
          <Kpi label="Latest ROCE" value={pct(latest.ratios?.ROCE)} />
          <Kpi label="Latest RNOA" value={pct(latest.ratios?.RNOA)} />
          <Kpi label="V(RE, CV3)" value={`₹${num(valuation.V_RE_CV3)} Cr`} />
          <Kpi label="Separation Confidence" value={`${latest.bs.separationScore}/100`} />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">1) Executive Findings</h2>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5">
          <li>
            Over the sample ({first.period_end.slice(0, 4)} to {latest.period_end.slice(0, 4)}), Sales CAGR = <b>{pct(salesCagr)}</b>,
            CNI CAGR = <b>{pct(cniCagr)}</b>, and book equity CAGR = <b>{pct(cseCagr)}</b>.
          </li>
          <li>
            Five-period average profitability: ROCE <b>{pct(roce5)}</b>, RNOA <b>{pct(rnoa5)}</b>, Spread <b>{pct(spread5)}</b>.
          </li>
          <li>
            Operations profile: PM <b>{pct(pm5)}</b> and ATO <b>{num(ato5, 2)}x</b>, benchmarked versus N&amp;P medians
            ({(NP_BENCHMARKS.PM.median * 100).toFixed(1)}% and {NP_BENCHMARKS.ATO.median.toFixed(2)}x).
          </li>
          <li>
            Earnings quality: accrual ratio (BS) average = <b>{pct(accrual5)}</b>, cash conversion ratio average = <b>{num(ccr5, 2)}x</b>.
          </li>
          <li>
            Quality diagnostics: Piotroski F-score <b>{fScore ?? "—"}/9</b>, Beneish M-score <b>{mScore?.toFixed(2) ?? "—"}</b>
            {mFlag ? " (watchlist)" : " (clean threshold)"}, Altman Z' <b>{zScore?.toFixed(2) ?? "—"}</b> ({zZone}).
          </li>
        </ul>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">2) Methodological Notes (Paper Mapping)</h2>
        <div className="text-sm text-slate-700 space-y-2">
          <p>
            <b>Recast identities</b>: CSE + MI = NOA - NFO and CNI = OI - NFE (with MII handling for consolidated entities).
            Statements are partitioned into operating versus financing buckets before ratio analysis.
          </p>
          <p>
            <b>Profitability bridge</b>: ROCE = RNOA + FLEV x SPREAD, with DuPont layer PM x ATO and supplementary
            diagnostics for OLLEV/OLSPREAD and Eq.(16)-style core-vs-unusual disaggregation.
          </p>
          <p>
            <b>Valuation</b>: RE model (Eq.1/1a) and operations-only ReOI model (Eq.9), each with zero, no-growth,
            and Gordon-growth continuing values.
          </p>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">3) Profitability and Growth Diagnostics</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">Latest</th>
                <th className="px-3 py-2 text-right">5Y Avg</th>
                <th className="px-3 py-2 text-right">N&amp;P Median</th>
                <th className="px-3 py-2 text-left">Interpretation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <Row metric="ROCE" latest={pct(latest.ratios?.ROCE)} avg5={pct(roce5)} bm={`${(NP_BENCHMARKS.ROCE.median * 100).toFixed(1)}%`} note="Shareholder return on common equity." />
              <Row metric="RNOA" latest={pct(latest.ratios?.RNOA)} avg5={pct(rnoa5)} bm={`${(NP_BENCHMARKS.RNOA.median * 100).toFixed(1)}%`} note="Core operating profitability net of operating liabilities." />
              <Row metric="Spread" latest={pct(latest.ratios?.SPREAD)} avg5={pct(spread5)} bm={`${(NP_BENCHMARKS.SPREAD.median * 100).toFixed(1)}%`} note="Value creation wedge between operating return and financing cost." />
              <Row metric="PM" latest={pct(latest.ratios?.PM)} avg5={pct(pm5)} bm={`${(NP_BENCHMARKS.PM.median * 100).toFixed(1)}%`} note="Operating margin after comprehensive classification." />
              <Row metric="ATO" latest={`${num(latest.ratios?.ATO, 2)}x`} avg5={`${num(ato5, 2)}x`} bm={`${NP_BENCHMARKS.ATO.median.toFixed(2)}x`} note="Operating asset productivity / turnover." />
              <Row metric="Sales CAGR" latest={pct(salesCagr)} avg5="—" bm="—" note="Top-line growth trajectory over full sample." />
              <Row metric="CNI CAGR" latest={pct(cniCagr)} avg5="—" bm="—" note="Growth in comprehensive earnings available to common." />
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
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

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">5) Cash-Flow Quality and Clean-Surplus Diagnostics</h2>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5">
          <li>
            Latest accounting FCF (Eq.14) = <b>₹{num(latest.cf.FCF_accounting)} Cr</b>; cash FCF proxy (CFO-Capex) =
            <b> ₹{num(latest.cf.FCF_cash)} Cr</b>.
          </li>
          <li>
            Dividend reconciliation (Eq.15): reported d_t = <b>₹{num(latest.cf.d_t)} Cr</b> vs formula d_t =
            <b> ₹{num(latest.cf.d_t_formula)} Cr</b>; discrepancy = <b>₹{num(latest.cf.d_t_discrepancy)} Cr</b>.
          </li>
          <li>
            Accrual discipline: average BS accrual ratio <b>{pct(accrual5)}</b>; sustained levels above 10% should be treated as
            a persistence-risk signal.
          </li>
        </ul>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold text-lg text-slate-800 mb-3">6) Valuation Synthesis (Residual Income Framework)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
          <MiniBox label="ke assumption" value={pct(ke, 2)} />
          <MiniBox label="kw assumption" value={pct(kw, 2)} />
          <MiniBox label="Terminal growth g" value={pct(g, 2)} />
          <MiniBox label="Separation confidence" value={`${valuation.separationScore}/100`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-right">Zero CV</th>
                <th className="px-3 py-2 text-right">No-growth CV</th>
                <th className="px-3 py-2 text-right">Growth CV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-3 py-2">Equity RE (Eq.1/1a)</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_RE_CV1)} Cr</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_RE_CV2)} Cr</td>
                <td className="px-3 py-2 text-right font-semibold text-indigo-700">₹{num(valuation.V_RE_CV3)} Cr</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Operations-only ReOI (Eq.9)</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_ReOI_CV01)} Cr</td>
                <td className="px-3 py-2 text-right">₹{num(valuation.V_ReOI_CV02)} Cr</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700">₹{num(valuation.V_ReOI_CV03)} Cr</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Interpretation: when separation confidence is low, the RE line should be treated as primary and ReOI as corroborative only.
        </p>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
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
            <b>Process recommendation</b>: update this report each filing cycle; monitor Eq.(4)/(7)/(15) residuals and mapping quality
            diagnostics to ensure model integrity remains audit-grade.
          </p>
        </div>
      </section>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-lg font-bold text-slate-800 mt-1">{value}</div>
    </div>
  );
}

function MiniBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-slate-50">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="font-semibold text-slate-800 mt-1">{value}</div>
    </div>
  );
}

function Row({ metric, latest, avg5, bm, note }: { metric: string; latest: string; avg5: string; bm: string; note: string }) {
  return (
    <tr>
      <td className="px-3 py-2 font-medium text-slate-700">{metric}</td>
      <td className="px-3 py-2 text-right font-mono">{latest}</td>
      <td className="px-3 py-2 text-right font-mono">{avg5}</td>
      <td className="px-3 py-2 text-right font-mono text-slate-500">{bm}</td>
      <td className="px-3 py-2 text-slate-600 text-xs">{note}</td>
    </tr>
  );
}
