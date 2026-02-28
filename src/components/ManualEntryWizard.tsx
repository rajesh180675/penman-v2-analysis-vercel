/**
 * ManualEntryWizard — 5-Step Wizard (E-01)
 * Multi-period data entry using canonical N&P structure.
 * Each period gets its own independently editable data.
 * Spec: Module E, Feature E-01 — Structured Manual Entry Form
 */
import { useMemo, useReducer, useState } from "react";
import { RawPeriodData } from "../engine/types";

type Currency = "INR_CR" | "INR_LAKH" | "USD_MN";

interface PeriodData {
  bs: { TA: string; FA: string; FO: string; OL: string; CSE: string; MI: string; PPE: string; Inventory: string; TradeRec: string; TradePay: string };
  is: { Sales: string; PAT: string; Tax: string; PBT: string; FinanceCost: string; FinanceIncome: string; TCI: string; NCI: string; COGS: string; DA: string };
  cf: { CFO: string; Capex: string; DividendPaid: string; EquityIssued: string; InterestReceived: string; DividendReceived: string };
}

type WizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  companyId: string;
  ticker: string;
  latestPeriodEnd: string;
  numPeriods: number;
  currency: Currency;
  activePeriodIdx: number;
  periods: PeriodData[];
};

const blankPeriod = (): PeriodData => ({
  bs: { TA: "", FA: "", FO: "", OL: "", CSE: "", MI: "0", PPE: "", Inventory: "", TradeRec: "", TradePay: "" },
  is: { Sales: "", PAT: "", Tax: "", PBT: "", FinanceCost: "", FinanceIncome: "", TCI: "", NCI: "0", COGS: "", DA: "" },
  cf: { CFO: "", Capex: "", DividendPaid: "", EquityIssued: "", InterestReceived: "", DividendReceived: "" },
});

type Action =
  | { type: "step"; step: WizardState["step"] }
  | { type: "meta"; key: "companyId" | "ticker" | "latestPeriodEnd" | "currency"; value: string }
  | { type: "setNumPeriods"; value: number }
  | { type: "activePeriod"; idx: number }
  | { type: "bs"; periodIdx: number; key: keyof PeriodData["bs"]; value: string }
  | { type: "is"; periodIdx: number; key: keyof PeriodData["is"]; value: string }
  | { type: "cf"; periodIdx: number; key: keyof PeriodData["cf"]; value: string };

const initial: WizardState = {
  step: 1,
  companyId: "MANUAL",
  ticker: "",
  latestPeriodEnd: "2025-03-31",
  numPeriods: 3,
  currency: "INR_CR",
  activePeriodIdx: 0,
  periods: [blankPeriod(), blankPeriod(), blankPeriod()],
};

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "step": return { ...state, step: action.step };
    case "meta": return { ...state, [action.key]: action.value };
    case "setNumPeriods": {
      const n = Math.max(1, Math.min(10, action.value));
      const periods = Array.from({ length: n }, (_, i) => state.periods[i] ?? blankPeriod());
      return { ...state, numPeriods: n, periods, activePeriodIdx: Math.min(state.activePeriodIdx, n - 1) };
    }
    case "activePeriod": return { ...state, activePeriodIdx: action.idx };
    case "bs": {
      const periods = state.periods.map((p, i) => i === action.periodIdx ? { ...p, bs: { ...p.bs, [action.key]: action.value } } : p);
      return { ...state, periods };
    }
    case "is": {
      const periods = state.periods.map((p, i) => i === action.periodIdx ? { ...p, is: { ...p.is, [action.key]: action.value } } : p);
      return { ...state, periods };
    }
    case "cf": {
      const periods = state.periods.map((p, i) => i === action.periodIdx ? { ...p, cf: { ...p.cf, [action.key]: action.value } } : p);
      return { ...state, periods };
    }
    default: return state;
  }
}

const num = (s: string) => { const v = Number((s || "0").replace(/,/g, "")); return Number.isFinite(v) ? v : 0; };

function currencyMultiplier(c: Currency): number {
  if (c === "INR_LAKH") return 0.01;
  if (c === "USD_MN") return 8.5;
  return 1;
}

function getPeriodEnd(latestEnd: string, idx: number, total: number): string {
  const baseYear = Number(latestEnd.slice(0, 4));
  const rest = latestEnd.slice(4);
  const year = baseYear - (total - 1 - idx);
  return `${year}${rest}`;
}

function buildRawFromPeriod(pd: PeriodData, periodEnd: string, companyId: string, mult: number): RawPeriodData {
  const b = pd.bs;
  const is_ = pd.is;
  const cf = pd.cf;
  const TA = num(b.TA) * mult, FA = num(b.FA) * mult, FO = num(b.FO) * mult;
  const OL = num(b.OL) * mult, CSE = num(b.CSE) * mult, MI = num(b.MI) * mult;
  const PPE = num(b.PPE) * mult, Inv = num(b.Inventory) * mult;
  const TradeRec = num(b.TradeRec) * mult, TradePay = num(b.TradePay) * mult;
  const sales = num(is_.Sales) * mult, pat = num(is_.PAT) * mult;
  const pbt = num(is_.PBT) * mult, tax = num(is_.Tax) * mult;
  const finCost = num(is_.FinanceCost) * mult, finInc = num(is_.FinanceIncome) * mult;
  const tci = num(is_.TCI) * mult, nci = num(is_.NCI) * mult;
  const cogs = num(is_.COGS) * mult, da = num(is_.DA) * mult;
  const cfo = num(cf.CFO) * mult, capex = num(cf.Capex) * mult;
  const divPaid = num(cf.DividendPaid) * mult, eqIssued = num(cf.EquityIssued) * mult;
  const intRec = num(cf.InterestReceived) * mult, divRec = num(cf.DividendReceived) * mult;

  return {
    company_id: companyId || "MANUAL",
    period_end: periodEnd,
    raw_metric_values: {
      "Total Assets__BalanceSheet": TA,
      "Total Equity__BalanceSheet": CSE + MI,
      "Total Stockholders' Equity__BalanceSheet": CSE,
      "Minority Interest__BalanceSheet": MI,
      ...(FA > 0 ? {
        "Cash and Cash Equivalents__BalanceSheet": FA * 0.20,
        "Current Investments__BalanceSheet": FA * 0.30,
        "Investments - Long-term__BalanceSheet": FA * 0.25,
        "Others Financial Assets - Short-term__BalanceSheet": FA * 0.25,
      } : {}),
      ...(FO > 0 ? {
        "Long Term Borrowings__BalanceSheet": FO * 0.55,
        "Short Term Borrowings__BalanceSheet": FO * 0.30,
        "Others Financial Liabilities - Short-term__BalanceSheet": FO * 0.15,
      } : {}),
      ...(OL > 0 ? {
        "Trade Payables__BalanceSheet": TradePay > 0 ? TradePay : OL * 0.35,
        "Other Current Liabilities__BalanceSheet": OL * 0.40,
        "Long-term Provisions__BalanceSheet": OL * 0.10,
        "Current Tax Liabilities - Short-term__BalanceSheet": OL * 0.05,
        "Other Non-Current Liabilities__BalanceSheet": OL * 0.10,
      } : {}),
      ...(PPE > 0 ? { "Property, plant and equipment__BalanceSheet": PPE } : {}),
      ...(Inv > 0 ? { "Inventories__BalanceSheet": Inv } : {}),
      ...(TradeRec > 0 ? { "Trade Receivables - Short-term__BalanceSheet": TradeRec } : {}),
      "Revenue From Operations(Net)__ProfitLoss": sales,
      "Profit After Tax__ProfitLoss": pat,
      "Profit Before Tax__ProfitLoss": pbt,
      "Tax Expenses__ProfitLoss": tax,
      "Finance Cost__ProfitLoss": finCost,
      ...(finInc > 0 ? { "Interest Income__ProfitLoss": finInc } : {}),
      "Total Comprehensive Income for the Year__ProfitLoss": tci || pat,
      "Non-Controlling Interests__ProfitLoss": nci,
      ...(cogs > 0 ? { "Cost of Materials Consumed__ProfitLoss": cogs } : {}),
      ...(da > 0 ? { "Depreciation, Depletion and Amortization Expense__ProfitLoss": da } : {}),
      "Net Cash from Operating Activities__CashFlow": cfo,
      "Purchased of Fixed Assets__CashFlow": -Math.abs(capex),
      "Dividend Paid__CashFlow": -Math.abs(divPaid),
      "Proceeds from Issue of shares (incl share premium)__CashFlow": Math.abs(eqIssued),
      "Interest Received__CashFlow": Math.abs(intRec),
      "Dividend Received__CashFlow": Math.abs(divRec),
    },
  };
}

export default function ManualEntryWizard({ onSubmit }: { onSubmit: (rows: RawPeriodData[]) => void }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const mult = currencyMultiplier(state.currency);
  const ap = state.activePeriodIdx;
  const pd = state.periods[ap] ?? blankPeriod();

  const periodLabels = useMemo(() =>
    Array.from({ length: state.numPeriods }, (_, i) => {
      const pe = getPeriodEnd(state.latestPeriodEnd, i, state.numPeriods);
      return `FY${pe.slice(2, 4)}`;
    }),
    [state.latestPeriodEnd, state.numPeriods]
  );

  const bsChecks = useMemo(() => {
    const TA = num(pd.bs.TA), FA = num(pd.bs.FA), FO = num(pd.bs.FO);
    const OL = num(pd.bs.OL), CSE = num(pd.bs.CSE), MI = num(pd.bs.MI);
    const OA = TA - FA, NOA = OA - OL, NFO = FO - FA;
    const idErr = TA > 0 ? Math.abs((CSE + MI) - (NOA - NFO)) / Math.max(TA, 1) : null;
    return { OA, NOA, NFO, idErr, ok: idErr == null || idErr < 0.02 };
  }, [pd.bs]);

  const completionPct = useMemo(() => {
    const requiredFields: Array<[keyof PeriodData, string]> = [
      ["bs", "TA"], ["bs", "FA"], ["bs", "FO"], ["bs", "OL"], ["bs", "CSE"],
      ["is", "Sales"], ["is", "PAT"], ["is", "FinanceCost"],
      ["cf", "CFO"], ["cf", "Capex"],
    ];
    let filled = 0;
    for (let i = 0; i < state.numPeriods; i++) {
      const p = state.periods[i];
      if (!p) continue;
      for (const [stmt, key] of requiredFields) {
        if (num((p[stmt] as Record<string, string>)[key]) !== 0) filled++;
      }
    }
    return Math.round((filled / (state.numPeriods * requiredFields.length)) * 100);
  }, [state.periods, state.numPeriods]);

  const submit = () => {
    setSubmitError(null);
    const rows = state.periods.slice(0, state.numPeriods).map((p, i) =>
      buildRawFromPeriod(p, getPeriodEnd(state.latestPeriodEnd, i, state.numPeriods), state.companyId, mult)
    );
    const hasSales = rows.some(r => (r.raw_metric_values["Revenue From Operations(Net)__ProfitLoss"] as number) > 0);
    if (!hasSales) { setSubmitError("At least one period must have Sales > 0."); return; }
    onSubmit(rows);
  };

  const goStep = (s: 1|2|3|4|5) => dispatch({ type: "step", step: s });

  return (
    <div className="border border-slate-200 rounded-xl p-5 bg-slate-50 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h4 className="font-semibold text-slate-700">Manual Entry Wizard — Step {state.step}/5</h4>
          <p className="text-xs text-slate-500">Direct entry using canonical N&P structure — no CSV required</p>
        </div>
        <div className="flex gap-1.5">
          {([1,2,3,4,5] as const).map(s => (
            <button key={s} onClick={() => goStep(s)}
              className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${state.step === s ? "bg-indigo-600 text-white shadow" : "bg-white text-slate-600 border hover:bg-slate-100"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Period selector (steps 2–4) */}
      {state.step >= 2 && state.step <= 4 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Editing period:</span>
          {Array.from({ length: state.numPeriods }, (_, i) => (
            <button key={i} onClick={() => dispatch({ type: "activePeriod", idx: i })}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${ap === i ? "bg-indigo-100 text-indigo-700 border-indigo-300" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
              {getPeriodEnd(state.latestPeriodEnd, i, state.numPeriods).slice(0, 7)}
            </button>
          ))}
        </div>
      )}

      {/* ── Step 1: Setup ── */}
      {state.step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Company ID" value={state.companyId} onChange={v => dispatch({ type: "meta", key: "companyId", value: v.toUpperCase() })} />
            <Field label="Ticker" value={state.ticker} onChange={v => dispatch({ type: "meta", key: "ticker", value: v.toUpperCase() })} />
            <Field label="Latest FY End (YYYY-MM-DD)" value={state.latestPeriodEnd} onChange={v => dispatch({ type: "meta", key: "latestPeriodEnd", value: v })} />
            <div>
              <label className="block text-xs text-slate-500 mb-1">No. of Periods (1–10)</label>
              <input type="number" min={1} max={10} value={state.numPeriods}
                onChange={e => dispatch({ type: "setNumPeriods", value: Number(e.target.value) })}
                className="w-full px-2 py-1.5 border rounded bg-white text-sm focus:ring-1 focus:ring-indigo-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Currency</label>
            <select value={state.currency} onChange={e => dispatch({ type: "meta", key: "currency", value: e.target.value })}
              className="px-3 py-1.5 border rounded bg-white text-sm">
              <option value="INR_CR">INR Crores</option>
              <option value="INR_LAKH">INR Lakhs (converted to Cr)</option>
              <option value="USD_MN">USD Millions (≈ INR Cr)</option>
            </select>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
            <strong>Periods:</strong>{" "}
            {Array.from({ length: state.numPeriods }, (_, i) => getPeriodEnd(state.latestPeriodEnd, i, state.numPeriods).slice(0, 7)).join(", ")}
          </div>
        </div>
      )}

      {/* ── Step 2: Balance Sheet ── */}
      {state.step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-600 bg-white border rounded p-2">
            <strong>N&P Identity:</strong> NOA = OA − OL = CSE + MI + NFO, where OA = TA − FA, NFO = FO − FA
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label="Total Assets (TA)" value={pd.bs.TA} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "TA", value: v })} />
            <Field label="Financial Assets (FA)" value={pd.bs.FA} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "FA", value: v })} hint="Cash + investments" />
            <Field label="Financial Obligations (FO)" value={pd.bs.FO} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "FO", value: v })} hint="Borrowings + leases" />
            <Field label="Operating Liabilities (OL)" value={pd.bs.OL} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "OL", value: v })} hint="Trade payables + prov." />
            <Field label="Common Equity (CSE)" value={pd.bs.CSE} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "CSE", value: v })} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label="Minority Interest" value={pd.bs.MI} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "MI", value: v })} />
            <Field label="PPE (Net)" value={pd.bs.PPE} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "PPE", value: v })} />
            <Field label="Inventories" value={pd.bs.Inventory} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "Inventory", value: v })} />
            <Field label="Trade Receivables" value={pd.bs.TradeRec} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "TradeRec", value: v })} />
            <Field label="Trade Payables" value={pd.bs.TradePay} onChange={v => dispatch({ type: "bs", periodIdx: ap, key: "TradePay", value: v })} />
          </div>
          <div className={`p-2 rounded-lg text-xs font-mono ${bsChecks.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-amber-50 border border-amber-200 text-amber-800"}`}>
            OA = {bsChecks.OA.toFixed(0)} | NOA = {bsChecks.NOA.toFixed(0)} | NFO = {bsChecks.NFO.toFixed(0)} |
            Identity Δ = {bsChecks.idErr != null ? (bsChecks.idErr * 100).toFixed(2) + "%" : "—"}{bsChecks.ok ? " ✓" : " ⚠"}
          </div>
        </div>
      )}

      {/* ── Step 3: Income Statement ── */}
      {state.step === 3 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-600 bg-white border rounded p-2">
            <strong>N&P OI derivation:</strong> OI = CNI + NFE + MII, where CNI = TCI − TCI_NCI, NFE = (FinanceCost − FinanceIncome) × (1−t)
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Sales / Revenue" value={pd.is.Sales} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "Sales", value: v })} />
            <Field label="COGS" value={pd.is.COGS} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "COGS", value: v })} hint="Materials + purchases" />
            <Field label="Depreciation & Amort." value={pd.is.DA} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "DA", value: v })} />
            <Field label="Finance Cost" value={pd.is.FinanceCost} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "FinanceCost", value: v })} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Finance Income" value={pd.is.FinanceIncome} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "FinanceIncome", value: v })} hint="Interest + div. income" />
            <Field label="PBT" value={pd.is.PBT} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "PBT", value: v })} />
            <Field label="Tax Expense" value={pd.is.Tax} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "Tax", value: v })} />
            <Field label="PAT" value={pd.is.PAT} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "PAT", value: v })} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
            <Field label="Total Comprehensive Income (TCI)" value={pd.is.TCI} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "TCI", value: v })} hint="PAT + OCI; blank → PAT used" />
            <Field label="NCI Share of TCI" value={pd.is.NCI} onChange={v => dispatch({ type: "is", periodIdx: ap, key: "NCI", value: v })} hint="Minority interest portion" />
          </div>
        </div>
      )}

      {/* ── Step 4: Cash Flow ── */}
      {state.step === 4 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="CFO (Net Cash from Ops)" value={pd.cf.CFO} onChange={v => dispatch({ type: "cf", periodIdx: ap, key: "CFO", value: v })} />
            <Field label="Capex (Capital Expenditure)" value={pd.cf.Capex} onChange={v => dispatch({ type: "cf", periodIdx: ap, key: "Capex", value: v })} hint="Enter as positive" />
            <Field label="Dividend Paid" value={pd.cf.DividendPaid} onChange={v => dispatch({ type: "cf", periodIdx: ap, key: "DividendPaid", value: v })} hint="Enter as positive" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Equity Issued (proceeds)" value={pd.cf.EquityIssued} onChange={v => dispatch({ type: "cf", periodIdx: ap, key: "EquityIssued", value: v })} />
            <Field label="Interest Received" value={pd.cf.InterestReceived} onChange={v => dispatch({ type: "cf", periodIdx: ap, key: "InterestReceived", value: v })} />
            <Field label="Dividend Received" value={pd.cf.DividendReceived} onChange={v => dispatch({ type: "cf", periodIdx: ap, key: "DividendReceived", value: v })} />
          </div>
          {num(pd.cf.CFO) !== 0 && num(pd.is.PAT) !== 0 && (
            <div className="text-xs bg-white border rounded p-2">
              CEQI = CFO/PAT = {(num(pd.cf.CFO) / Math.max(num(pd.is.PAT), 0.001)).toFixed(2)}
              {num(pd.cf.CFO) / Math.max(num(pd.is.PAT), 0.001) >= 0.85 ? " ✓ Good" : " ⚠ Low — earnings less cash-confirmable"}
            </div>
          )}
        </div>
      )}

      {/* ── Step 5: Review ── */}
      {state.step === 5 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              { label: "Company", val: `${state.companyId}${state.ticker ? ` (${state.ticker})` : ""}` },
              { label: "Periods", val: `${state.numPeriods} × ${state.currency}` },
              { label: "Range", val: `${getPeriodEnd(state.latestPeriodEnd, 0, state.numPeriods).slice(0, 7)} – ${state.latestPeriodEnd.slice(0, 7)}` },
              { label: "Completion", val: `${completionPct}%` },
            ].map(({ label, val }) => (
              <div key={label} className="bg-white p-3 rounded-lg border">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="font-semibold">{val}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="px-3 py-2 text-left font-semibold">Period</th>
                  <th className="px-3 py-2 text-right">Sales</th>
                  <th className="px-3 py-2 text-right">PAT</th>
                  <th className="px-3 py-2 text-right">TA</th>
                  <th className="px-3 py-2 text-right">NOA</th>
                  <th className="px-3 py-2 text-right">CFO</th>
                  <th className="px-3 py-2 text-center">BS ✓</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.periods.slice(0, state.numPeriods).map((p, i) => {
                  const TA = num(p.bs.TA), FA = num(p.bs.FA), OL = num(p.bs.OL), FO = num(p.bs.FO);
                  const CSE = num(p.bs.CSE), MI = num(p.bs.MI);
                  const NOA = (TA - FA) - OL;
                  const idOk = TA > 0 ? Math.abs((CSE + MI) - (NOA - (FO - FA))) / TA < 0.02 : null;
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-mono">{getPeriodEnd(state.latestPeriodEnd, i, state.numPeriods).slice(0, 7)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{num(p.is.Sales) > 0 ? num(p.is.Sales).toLocaleString() : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{num(p.is.PAT) > 0 ? num(p.is.PAT).toLocaleString() : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{TA > 0 ? TA.toLocaleString() : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{TA > 0 ? NOA.toFixed(0) : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{num(p.cf.CFO) !== 0 ? num(p.cf.CFO).toLocaleString() : "—"}</td>
                      <td className="px-3 py-1.5 text-center">{idOk == null ? "—" : idOk ? "✓" : "⚠"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {submitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">⚠ {submitError}</div>
          )}

          <div className="flex gap-3 flex-wrap">
            <button onClick={submit}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 text-sm">
              Run Engine ({state.numPeriods} period{state.numPeriods !== 1 ? "s" : ""})
            </button>
            <button onClick={() => goStep(2)}
              className="px-4 py-2 rounded-lg border text-sm text-slate-600 hover:bg-white">
              ← Edit Data
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      {state.step < 5 && (
        <div className="flex justify-between pt-2 border-t border-slate-200">
          {state.step > 1 ? (
            <button onClick={() => goStep((state.step - 1) as any)} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded hover:bg-white">
              ← Previous
            </button>
          ) : <div />}
          <button onClick={() => goStep((state.step + 1) as any)}
            className="px-4 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-medium hover:bg-indigo-100">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder ?? "0"}
        className="w-full px-2 py-1.5 border rounded bg-white text-sm focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}
