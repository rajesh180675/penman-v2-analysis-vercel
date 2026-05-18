import type { RecastPeriod } from "../../engine/types";

interface Props {
  /** Latest period quality data */
  data: RecastPeriod[];
}

interface ScoreEntry {
  name: string;
  value: number | null;
  status: "good" | "neutral" | "bad" | "unknown";
  detail: string;
  scale: string;
}

/**
 * Unified Quality Score Dashboard — surfaces all 5 distress/quality models
 * in one place: Piotroski F, Altman Z', Beneish M, Zmijewski X, Ohlson O.
 * Each scored independently with traffic-light status + interpretation.
 */
export default function QualityScoreDashboard({ data }: Props) {
  if (!data || data.length === 0 || !data[data.length - 1].quality) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Quality Score Dashboard</h3>
        <p className="text-xs text-slate-500 mt-2">No quality data available.</p>
      </div>
    );
  }

  const q = data[data.length - 1].quality!;

  // Scoring rules:
  // - Piotroski (0–9): >=7 good, 3–6 neutral, <3 bad
  // - Altman Z' (>0): >2.9 good, 1.23–2.9 neutral, <1.23 bad
  // - Beneish M-score: <-2.22 good, -2.22..-1.78 neutral, >-1.78 bad (manipulation flag)
  // - Zmijewski X-score: <0 good (low distress probability), 0..1 neutral, >1 bad
  // - Ohlson O-score: <0.18 good, 0.18..0.5 neutral, >0.5 bad (using prob_distress)

  const scores: ScoreEntry[] = [
    {
      name: "Piotroski F-Score",
      value: q.piotroski_total ?? null,
      status: q.piotroski_total >= 7 ? "good" : q.piotroski_total >= 3 ? "neutral" : "bad",
      detail: q.piotroski_total >= 7 ? "Strong fundamentals" : q.piotroski_total >= 3 ? "Mixed signals" : "Weak fundamentals",
      scale: "0–9",
    },
    {
      name: "Altman Z'-Score",
      value: q.altman_zprime ?? null,
      status: q.altman_zprime > 2.9 ? "good" : q.altman_zprime >= 1.23 ? "neutral" : "bad",
      detail: q.altman_zprime > 2.9 ? "Safe zone" : q.altman_zprime >= 1.23 ? "Grey zone" : "Distress zone",
      scale: ">2.9 safe · 1.23–2.9 grey · <1.23 distress",
    },
    {
      name: "Beneish M-Score",
      value: q.beneish_mscore ?? null,
      status: q.beneish_mscore != null && q.beneish_mscore < -2.22 ? "good" :
              q.beneish_mscore != null && q.beneish_mscore < -1.78 ? "neutral" : "bad",
      detail: q.beneish_mscore != null && q.beneish_mscore < -2.22 ? "No manipulation flag" :
              q.beneish_mscore != null && q.beneish_mscore < -1.78 ? "Borderline" : "Manipulation flag — investigate",
      scale: "<-2.22 clean · >-1.78 flagged",
    },
    {
      name: "Zmijewski X-Score",
      value: q.zmijewski_xscore ?? null,
      status: q.zmijewski_xscore == null ? "unknown" :
              q.zmijewski_xscore < 0 ? "good" :
              q.zmijewski_xscore < 1 ? "neutral" : "bad",
      detail: q.zmijewski_xscore == null ? "Insufficient data" :
              q.zmijewski_xscore < 0 ? "Low distress probability" :
              q.zmijewski_xscore < 1 ? "Elevated risk" : "High distress probability",
      scale: "<0 low risk · >1 high risk",
    },
    {
      name: "Ohlson O-Score (P)",
      value: q.ohlson_prob_distress != null ? q.ohlson_prob_distress * 100 : null,
      status: q.ohlson_prob_distress == null ? "unknown" :
              q.ohlson_prob_distress < 0.18 ? "good" :
              q.ohlson_prob_distress < 0.5 ? "neutral" : "bad",
      detail: q.ohlson_prob_distress == null ? "Insufficient data" :
              q.ohlson_prob_distress < 0.18 ? "Low bankruptcy probability" :
              q.ohlson_prob_distress < 0.5 ? "Elevated probability" : "High bankruptcy probability",
      scale: "<18% low · >50% high",
    },
  ];

  const goodCount = scores.filter(s => s.status === "good").length;
  const badCount = scores.filter(s => s.status === "bad").length;
  const verdict =
    goodCount >= 4 ? { label: "Quality Composite: STRONG", color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-900/30" } :
    badCount >= 3 ? { label: "Quality Composite: WEAK", color: "text-red-700 dark:text-red-300", bg: "bg-red-50 dark:bg-red-900/30" } :
    badCount >= 1 ? { label: "Quality Composite: MIXED", color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-900/30" } :
                    { label: "Quality Composite: NEUTRAL", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-50 dark:bg-blue-900/30" };

  const statusStyle = (s: ScoreEntry["status"]) => {
    switch (s) {
      case "good":    return { bg: "bg-emerald-50 dark:bg-emerald-900/30", border: "border-emerald-300 dark:border-emerald-700", text: "text-emerald-700 dark:text-emerald-300", emoji: "✅" };
      case "neutral": return { bg: "bg-amber-50 dark:bg-amber-900/30",     border: "border-amber-300 dark:border-amber-700",     text: "text-amber-700 dark:text-amber-300",     emoji: "⚠️" };
      case "bad":     return { bg: "bg-red-50 dark:bg-red-900/30",         border: "border-red-300 dark:border-red-700",         text: "text-red-700 dark:text-red-300",         emoji: "🛑" };
      default:        return { bg: "bg-slate-50 dark:bg-slate-800/50",     border: "border-slate-300 dark:border-slate-700",     text: "text-slate-500",                            emoji: "—" };
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/60 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Quality Score Dashboard</h3>
          <p className="text-xs text-slate-500">5 academic distress / quality models, traffic-lit and explained.</p>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${verdict.bg} ${verdict.color}`}>
          {verdict.label}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {scores.map((s, i) => {
          const style = statusStyle(s.status);
          return (
            <div key={i} className={`rounded-lg border-2 ${style.border} ${style.bg} p-3`}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{s.name}</div>
                <span className="text-base">{style.emoji}</span>
              </div>
              <div className={`text-2xl font-bold ${style.text}`}>
                {s.value != null && Number.isFinite(s.value) ? s.value.toFixed(2) : "—"}
                {s.name === "Ohlson O-Score (P)" && s.value != null && <span className="text-sm">%</span>}
              </div>
              <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">{s.detail}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-500 mt-1 italic">{s.scale}</div>
            </div>
          );
        })}
      </div>

      <div className="text-[11px] text-slate-500 italic pt-1">
        Each model captures a different angle: Piotroski (fundamentals improvement), Altman (manufacturing distress), Beneish (earnings manipulation), Zmijewski / Ohlson (statistical bankruptcy probability).
        Strength comes from convergence — when 4+ agree, the signal is robust; when models diverge, dig deeper.
      </div>
    </div>
  );
}
