/**
 * Case §6 — Peers: the company beside its same-type library peers on the
 * reformulated basis (latest-year RNOA, margin, turnover, ROCE, growth) and
 * the base-case value against price. Peers are analysed only when asked —
 * each is a full run — through the same session run cache as the Case.
 */
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import type { LibraryCompany } from "../../components/data-entry/companyRegistry";
import { formatPct, formatPerShare } from "../../engine/valuationCommandCenter";
import type { CompanyRunState } from "../companyRun";
import { percent } from "../format";
import { Withheld } from "../ui/Withheld";

/** How many peers are compared at most. */
export const MAX_PEERS = 4;

/** Same-type library companies, excluding the company itself, by name. */
export function choosePeers(company: LibraryCompany, companies: readonly LibraryCompany[]): LibraryCompany[] {
  return companies
    .filter((c) => c.type === company.type && c.folder !== company.folder)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_PEERS);
}

export interface PeerMetrics {
  readonly latestPeriod: string | null;
  readonly rnoa: number | null;
  readonly pm: number | null;
  readonly ato: number | null;
  readonly roce: number | null;
  readonly salesGrowth: number | null;
  readonly baseValue: number | null;
  readonly upside: number | null;
}

const finite = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);

/** The comparison row for one run: the latest reported year and the base case. */
export function peerMetrics(result: LegacyAnalysisRunExecutionResult): PeerMetrics {
  const periods = result.materialization.pipelineResult?.periods ?? [];
  const last = periods[periods.length - 1];
  const base = result.materialization.commandCenter?.scenarios.find((s) => s.key === "base") ?? null;
  return {
    latestPeriod: last?.period_end ?? null,
    rnoa: finite(last?.ratios?.RNOA),
    pm: finite(last?.ratios?.PM),
    ato: finite(last?.ratios?.ATO),
    roce: finite(last?.ratios?.ROCE),
    salesGrowth: finite(last?.ratios?.Sales_growth),
    baseValue: finite(base?.intrinsicPerShare),
    upside: finite(base?.upsidePct),
  };
}

export function PeersSection({
  company,
  result,
  peers,
  peerRuns,
  onLoadPeers,
}: {
  company: LibraryCompany;
  result: LegacyAnalysisRunExecutionResult;
  peers: readonly LibraryCompany[];
  /** Null until the reader asks for the comparison. */
  peerRuns: ReadonlyMap<string, CompanyRunState> | null;
  onLoadPeers: () => void;
}) {
  if (peers.length === 0) {
    return <Withheld reason={`No other ${company.type} company in the library to compare with.`} />;
  }
  const rows: { company: LibraryCompany; state: CompanyRunState | null; self: boolean }[] = [
    { company, state: { status: "ready", result }, self: true },
    ...peers.map((p) => ({ company: p, state: peerRuns?.get(p.folder) ?? null, self: false })),
  ];
  return (
    <div className="wb-surface overflow-x-auto rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{company.name} and its {company.type} peers</h2>
      <p className="mt-1 text-xs text-slate-500">
        {peers.length} peer{peers.length === 1 ? "" : "s"} from the library, latest reported year, on the reformulated basis. Each peer is a full analysis run.
      </p>
      {!peerRuns && (
        <button type="button" onClick={onLoadPeers} className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400 dark:border-slate-600">
          Analyse {peers.length} peer{peers.length === 1 ? "" : "s"}
        </button>
      )}
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-right text-xs text-slate-500">
            <th className="py-1 text-left font-medium">Company</th>
            <th className="py-1 font-medium">Year</th>
            <th className="py-1 font-medium">RNOA</th>
            <th className="py-1 font-medium">Margin</th>
            <th className="py-1 font-medium">Turnover</th>
            <th className="py-1 font-medium">ROCE</th>
            <th className="py-1 font-medium">Sales growth</th>
            <th className="py-1 font-medium">Base value</th>
            <th className="py-1 font-medium">Upside</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ company: c, state, self }) => (
            <tr key={c.folder} className={`border-t border-slate-100 text-right tabular-nums dark:border-slate-800 ${self ? "font-semibold" : ""}`}>
              <th scope="row" className="py-1 text-left font-normal">{c.name}</th>
              <PeerCells state={state} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeerCells({ state }: { state: CompanyRunState | null }) {
  if (!state) return <td colSpan={8} className="py-1 text-left text-xs text-slate-500">Not analysed yet.</td>;
  if (state.status === "loading") return <td colSpan={8} className="py-1 text-left text-xs text-slate-500">Analysing…</td>;
  if (state.status === "error") return <td colSpan={8} className="py-1 text-left"><Withheld reason={state.message} /></td>;
  const m = peerMetrics(state.result);
  const cell = (text: string | null, reason: string) => (
    <td className="py-1">{text ?? <span className="text-xs text-slate-400" title={reason}>n/a</span>}</td>
  );
  return (
    <>
      {cell(m.latestPeriod, "No recast period")}
      {cell(percent(m.rnoa), "RNOA not computable (NOA too small or missing)")}
      {cell(percent(m.pm), "No sales")}
      {cell(m.ato != null ? `${m.ato.toFixed(2)}×` : null, "Turnover not computable")}
      {cell(percent(m.roce), "ROCE not computable")}
      {cell(percent(m.salesGrowth), "No prior year")}
      {cell(m.baseValue != null ? formatPerShare(m.baseValue) : null, "No industrial base case (e.g. a financial institution) or no share count")}
      {cell(m.upside != null ? formatPct(m.upside) : null, "No price or no base value")}
    </>
  );
}
