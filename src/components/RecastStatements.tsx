import { RecastPeriod } from "../engine/types";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

interface Props { data: RecastPeriod[] }

const f  = (n: number | undefined | null) => n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fp = (n: number | undefined | null) => n == null ? "—" : (n * 100).toFixed(1) + "%";

export default function RecastStatements({ data }: Props) {
  if (!data || data.length === 0) return <div className="text-center py-20 text-slate-400"><div className="text-5xl mb-3">📊</div><p>No data</p></div>;

  const years = data.map((d) => d.period_end.slice(0, 7));
  const cd = data.map((d, i) => ({
    period: years[i], OA: d.bs.OA, OL: d.bs.OL, NOA: d.bs.NOA,
    FA: d.bs.FA, CSE: d.bs.CSE, Sales: d.is.Sales,
    OI: d.is.OI, CNI: d.is.CNI, CoreOI: d.cu.CoreOI, UOI: d.cu.UOI,
  }));

  return (
    <div className="space-y-8">

      {/* Balance Sheet */}
      <Section title="Recast Balance Sheet" subtitle="§3.2 Operating vs Financing partition · OA+FA=TA · OL=TotalLiab−FO">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Metric</Th>{years.map((y) => <Th key={y}>{y}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="Total Assets (TA)"          vals={data.map((d) => f(d.bs.TA))} />
              <TR label="Financial Assets (FA)"      vals={data.map((d) => f(d.bs.FA))} accent="blue" />
              <TR label="Operating Assets (OA=TA−FA)" vals={data.map((d) => f(d.bs.OA))} />
              <TR label="Financial Obligations (FO)" vals={data.map((d) => f(d.bs.FO))} accent="blue" />
              <TR label="Operating Liabilities (OL)" vals={data.map((d) => f(d.bs.OL))} />
              <TR label="  ↳ Trade Payables" vals={data.map((d) => f(d.bs.OL_TradePayables))} />
              <TR label="  ↳ Other Current Liabilities" vals={data.map((d) => f(d.bs.OL_OtherCurrentLiabilities))} />
              <TR label="  ↳ Provisions (Current)" vals={data.map((d) => f(d.bs.OL_ProvisionsCurrent))} />
              <TR label="  ↳ Provisions (Long-term)" vals={data.map((d) => f(d.bs.OL_ProvisionsLongTerm))} />
              <TR label="  ↳ Current Tax Liabilities" vals={data.map((d) => f(d.bs.OL_CurrentTaxLiabilities))} />
              <TR label="  ↳ Non-Current Tax Liabilities" vals={data.map((d) => f(d.bs.OL_NonCurrentTaxLiabilities))} />
              <TR label="  ↳ Deferred Tax Liabilities (Net)" vals={data.map((d) => f(d.bs.OL_DeferredTaxLiabilitiesNet))} />
              <TR label="  ↳ Other Non-Current Liabilities" vals={data.map((d) => f(d.bs.OL_OtherNonCurrentLiabilities))} />
              <TR label="Net Operating Assets (NOA)" vals={data.map((d) => f(d.bs.NOA))} bold />
              <TR label="Net Financial Obl. (NFO)"   vals={data.map((d) => f(d.bs.NFO))} bold accent="blue" />
              <TR label="Common Equity (CSE)"        vals={data.map((d) => f(d.bs.CSE))} bold accent="green" />
              <TR label="Minority Interest (MI)"     vals={data.map((d) => f(d.bs.MI))} />
              <TR label="CSE + MI"                   vals={data.map((d) => f(d.bs.CSE + d.bs.MI))} bold accent="green" />
              <TR label="Separation Score"           vals={data.map((d) => d.bs.separationScore.toFixed(0) + "/100")} />
            </tbody>
          </table>
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <ChartBox title="NOA / FA / CSE (₹ Cr)">
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="NOA" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="FA"  stroke="#0ea5e9" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="CSE" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
          <ChartBox title="OA vs OL (₹ Cr)">
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="OA" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="OL" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>
      </Section>

      {/* Income Statement */}
      <Section title="Recast Income Statement" subtitle="§3.3 CNI / NFE / OI · §4 Core vs Unusual · paper Eq.(2)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Metric</Th>{years.map((y) => <Th key={y}>{y}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="Sales (Revenue)"               vals={data.map((d) => f(d.is.Sales))} />
              <TR label="Profit After Tax (PAT)"        vals={data.map((d) => f(d.is.PAT))} />
              <TR label="OCI (after-tax)"               vals={data.map((d) => f(d.is.OCI))} />
              <TR label="TCI (group)"                   vals={data.map((d) => f(d.is.TCI))} />
              <TR label="NCI Income Share (MII)"        vals={data.map((d) => f(d.is.MII))} />
              <TR label="CNI (to common)"               vals={data.map((d) => f(d.is.CNI))} bold accent="green" />
              <TR label="Finance Cost (PL)"             vals={data.map((d) => f(d.is.FinanceCost))} />
              <TR label="Finance Income (rung)"         vals={data.map((d) => `${f(d.is.FinanceIncome)} [R${d.is.FinanceIncomeRung}]`)} />
              <TR label="Net Fin. Expense NFE"          vals={data.map((d) => f(d.is.NFE))} accent="blue" />
              <TR label="Operating Income OI"           vals={data.map((d) => f(d.is.OI))} bold />
              <TR label="OI_from_sales"                 vals={data.map((d) => f(d.is.OI_from_sales))} />
              <TR label="OtherItems (assoc./JV)"        vals={data.map((d) => f(d.is.OtherItems))} />
              <TR label="Core OI (persistent)"         vals={data.map((d) => f(d.cu.CoreOI))} bold accent="green" />
              <TR label="Unusual OI (UOI)"              vals={data.map((d) => f(d.cu.UOI))} accent="amber" />
              <TR label="  ↳ Exceptional (after-tax)"  vals={data.map((d) => f(d.cu.ExceptionalItemsAfterTax))} />
              <TR label="  ↳ OCI (treated unusual)"    vals={data.map((d) => f(d.cu.OCITotal))} />
              <TR label="Core NFE"                      vals={data.map((d) => f(d.cu.CoreNFE))} />
              <TR label="UFE (unusual fin. expense)"    vals={data.map((d) => f(d.cu.UFE))} accent="amber" />
              <TR label="Effective Tax Rate"            vals={data.map((d) => fp(d.is.taxRate))} />
            </tbody>
          </table>
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <ChartBox title="Sales / OI / CNI (₹ Cr)">
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Sales" stroke="#94a3b8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="OI"    stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="CNI"   stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
          <ChartBox title="Core OI vs Unusual OI (₹ Cr)">
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={cd}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="CoreOI" stroke="#10b981" strokeWidth={2} dot={false} name="Core OI" />
                <Line type="monotone" dataKey="UOI"    stroke="#f59e0b" strokeWidth={2} dot={false} name="UOI" />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
        </div>
      </Section>

      {/* FCF §7 */}
      <Section title="Free Cash Flow &amp; Dividends" subtitle="§7 Accounting FCF = OI − ΔNOA | Cash FCF = CFO − Capex | Eq.(14)–(15)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              <Th left>Metric</Th>{years.map((y) => <Th key={y}>{y}</Th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              <TR label="CFO"                    vals={data.map((d) => f(d.cf.CFO))} />
              <TR label="Capex"                  vals={data.map((d) => f(d.cf.Capex))} />
              <TR label="FCF (cash: CFO−Capex)"  vals={data.map((d) => f(d.cf.FCF_cash))} bold />
              <TR label="OI"                     vals={data.map((d) => f(d.is.OI))} />
              <TR label="ΔNOA"                   vals={data.map((d) => f(d.cf.FCF_accounting !== 0 ? d.is.OI - d.cf.FCF_accounting : null))} />
              <TR label="FCF (acctg: OI−ΔNOA)"  vals={data.map((d) => f(d.cf.FCF_accounting || null))} bold accent="green" />
              <TR label="Dividend Paid"          vals={data.map((d) => f(d.cf.DividendPaid))} />
              <TR label="Equity Issued"          vals={data.map((d) => f(d.cf.EquityIssued))} />
              <TR label="Debt Proceeds (CF)"     vals={data.map((d) => f(d.cf.DebtProceeds ?? null))} />
              <TR label="Debt Repayment (CF)"    vals={data.map((d) => f(d.cf.DebtRepayment ?? null))} />
              <TR label="Sale of Fixed Assets"   vals={data.map((d) => f(d.cf.SaleFixedAssets ?? null))} />
              <TR label="Purchase of Investments" vals={data.map((d) => f(d.cf.PurchaseInvestments ?? null))} />
              <TR label="Sale of Investments"    vals={data.map((d) => f(d.cf.SaleInvestments ?? null))} />
              <TR label="Net Dividends d_t"      vals={data.map((d) => f(d.cf.d_t))} />
              <TR label="d_t (formula Eq.15)"    vals={data.map((d) => f(d.cf.d_t_formula || null))} />
              <TR label="Discrepancy"            vals={data.map((d) => f(d.cf.d_t_discrepancy || null))} accent="amber" />
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <div className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function Th({ children, left }: { children?: React.ReactNode; left?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${left ? "text-left" : "text-right"}`}>
      {children}
    </th>
  );
}

const ACC: Record<string, string> = { green: "text-emerald-700 font-semibold", blue: "text-blue-700", amber: "text-amber-700" };

function TR({ label, vals, bold, accent }: { label: string; vals: string[]; bold?: boolean; accent?: string }) {
  return (
    <tr className={`hover:bg-slate-50 ${bold ? "bg-indigo-50/30" : ""}`}>
      <td className={`px-4 py-2 text-slate-700 whitespace-nowrap text-sm ${bold ? "font-semibold" : ""}`}>{label}</td>
      {vals.map((v, i) => (
        <td key={i} className={`px-4 py-2 text-right font-mono text-sm whitespace-nowrap ${bold ? "font-semibold" : ""} ${accent ? ACC[accent] : ""}`}>{v}</td>
      ))}
    </tr>
  );
}
