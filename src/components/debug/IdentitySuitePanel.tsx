/* ── Accounting Identity Test Suite (A1–A9) panel ─────────────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

import type { IdentitySuiteReport } from "../../engine/identityTests";
import { Card, StatBox } from "./debugUi";

export function IdentitySuitePanel({
  identitySuite,
}: {
  identitySuite: IdentitySuiteReport;
}) {
  return (
    <Card title="Unit Test Suite — Accounting Identities (A1–A9)">
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatBox label="Assertions" value={identitySuite.total} />
        <StatBox label="Passed" value={identitySuite.passed} />
        <StatBox label="Failed" value={identitySuite.failed} highlight={identitySuite.failed > 0} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        {Object.entries(identitySuite.byAssertion).map(([id, s]) => (
          <div key={id} className="border border-slate-200 rounded-lg p-2 text-xs">
            <div className="font-semibold text-slate-700">{id}</div>
            <div className="text-green-700">Pass: {s.passed}</div>
            <div className={`${s.failed > 0 ? "text-red-700" : "text-slate-500"}`}>Fail: {s.failed}</div>
          </div>
        ))}
      </div>
      {identitySuite.failed > 0 && (
        <div className="max-h-56 overflow-auto border border-red-200 bg-red-50 rounded-lg p-3 text-xs font-mono space-y-1">
          {identitySuite.results.filter((r) => !r.pass).slice(0, 120).map((r, i) => (
            <div key={`${r.id}-${r.period}-${i}`}>
              {r.period} {r.id} diff={r.diff.toFixed(4)} (tol={r.tolerance.toFixed(4)}){r.reasonCode ? ` [${r.reasonCode}]` : ""}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
