/**
 * V3 Analytics shared presentational subcomponents.
 * Extracted verbatim from V3AnalyticsPanel.tsx.
 */
import { type ReactNode } from "react";

/* ── Null state helper ────────────────────────────────────────── */
export function NullState({ message }: { message: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}

/* ── Shared subcomponents ─────────────────────────────────────── */
export function MetricCard({ label, value, badge, color }: { label: string; value: string; badge: string; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-800 mb-1 truncate">{value}</p>
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>{badge}</span>
    </div>
  );
}

export function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs font-semibold text-slate-600 mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 font-medium text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}
