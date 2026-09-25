/**
 * Case §3 — Evidence & trust: what was checked and what failed. The rigor
 * ladder, the reconciliation residuals and the parser-fidelity checks from the
 * run's trust envelope; every list states its total, failures first.
 */
import type { LegacyAnalysisRunExecutionResult } from "../../engine/analysisRun";
import { Withheld } from "../ui/Withheld";

type Envelope = NonNullable<LegacyAnalysisRunExecutionResult["run"]>["trustEnvelope"];

const STATUS_TONE: Record<string, string> = {
  confirmed: "text-emerald-700 dark:text-emerald-400",
  degraded: "text-amber-700 dark:text-amber-400",
  failed: "text-red-700 dark:text-red-400",
};

export function EvidenceSection({ result }: { result: LegacyAnalysisRunExecutionResult }) {
  if (!result.run) {
    return <Withheld reason={`The analysis failed before producing evidence${result.status === "failed" ? `: ${result.message}` : "."}`} />;
  }
  const envelope = result.run.trustEnvelope;
  return (
    <div className="space-y-4">
      <RigorLadder envelope={envelope} />
      <Reconciliation envelope={envelope} />
      <ParserFidelity envelope={envelope} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="wb-surface rounded-xl border p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {children}
    </div>
  );
}

function RigorLadder({ envelope }: { envelope: Envelope }) {
  const { rigor } = envelope;
  return (
    <Card title="Rigor ladder">
      <p className="mt-1 text-sm">Reached: <strong>{rigor.currentLabel}</strong>. {rigor.summary}</p>
      <ol className="mt-3 space-y-2">
        {rigor.checkpoints.map((c) => (
          <li key={c.level} className="flex gap-3 text-sm">
            <span className={`w-28 shrink-0 font-medium ${c.achieved ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>
              {c.achieved ? "Achieved" : "Not achieved"}
            </span>
            <span>
              <span className="font-medium">{c.label}</span>
              <span className="block text-xs text-slate-500">{c.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Reconciliation({ envelope }: { envelope: Envelope }) {
  const { reconciliation } = envelope;
  const order = { failed: 0, degraded: 1, confirmed: 2 } as Record<string, number>;
  const checks = [...reconciliation.checks].sort((a, b) =>
    (order[a.status] ?? 3) - (order[b.status] ?? 3) || Math.abs(b.ratio) - Math.abs(a.ratio));
  const failing = checks.filter((c) => c.status !== "confirmed").length;
  return (
    <Card title="Reconciliation">
      <p className="mt-1 text-sm">
        <span className={`font-medium ${STATUS_TONE[reconciliation.status] ?? ""}`}>{reconciliation.status}</span> — {reconciliation.summary}
      </p>
      <p className="mt-1 text-xs text-slate-500">{failing} of {checks.length} checks not confirmed. Diagnostic checks are shown but do not gate the rigor level.</p>
      <div className="mt-2 max-h-96 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-medium">Check</th>
              <th className="py-1 font-medium">Year</th>
              <th className="py-1 text-right font-medium">Residual</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => (
              <tr key={`${c.key}-${c.periodEnd}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2">{c.label}{c.role === "diagnostic" ? <span className="text-slate-500"> (diagnostic)</span> : null}</td>
                <td className="py-1 pr-2">{c.periodEnd}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{Number.isFinite(c.ratio) ? `${(c.ratio * 100).toFixed(1)}%` : "not computable"}</td>
                <td className={`py-1 ${STATUS_TONE[c.status] ?? ""}`}>{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ParserFidelity({ envelope }: { envelope: Envelope }) {
  const { parserFidelity } = envelope;
  const checks = [...parserFidelity.checks].sort((a, b) => Number(a.passed) - Number(b.passed));
  const failed = checks.filter((c) => !c.passed).length;
  return (
    <Card title="Parser fidelity">
      <p className="mt-1 text-sm">
        <span className={`font-medium ${STATUS_TONE[parserFidelity.status] ?? ""}`}>{parserFidelity.status}</span>
        {" "}(score {parserFidelity.score}) — {parserFidelity.summary}
      </p>
      <p className="mt-1 text-xs text-slate-500">{failed} of {checks.length} checks failed.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {checks.map((c) => (
          <li key={c.id}>
            <span className={c.passed ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>{c.passed ? "Passed" : "Failed"}</span>
            {" "}<span className="font-medium">{c.label}</span>
            <span className="block text-xs text-slate-500">{c.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
