import type { MoatScoreResult } from "../../engine/moatScoring";
import type { CapAllocScoreResult } from "../../engine/capitalAllocationScoring";
import type { DistressAssessment } from "../../engine/distressDetector";

interface Props {
  moat: MoatScoreResult | null;
  capAlloc: CapAllocScoreResult | null;
  distress: DistressAssessment | null;
  /** Margin of safety: (intrinsic - price) / price */
  marginOfSafety: number | null;
  /** Current market price (for messaging) */
  price: number | null;
  /** Intrinsic value midpoint (for messaging) */
  intrinsic: number | null;
}

type Verdict = "screaming-buy" | "buy" | "hold" | "avoid" | "distressed";

interface VerdictProfile {
  label: string;
  color: string;
  bg: string;
  border: string;
  emoji: string;
  blurb: string;
}

const VERDICTS: Record<Verdict, VerdictProfile> = {
  "screaming-buy": {
    label: "Screaming Buy",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/40 dark:to-emerald-800/30",
    border: "border-emerald-400 dark:border-emerald-600",
    emoji: "🚀",
    blurb: "High-quality business + capable management + cheap valuation. Rare combination.",
  },
  buy: {
    label: "Buy",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/40 dark:to-blue-800/30",
    border: "border-blue-400 dark:border-blue-600",
    emoji: "✅",
    blurb: "Quality business at fair-to-attractive price. Worth a position.",
  },
  hold: {
    label: "Hold / Watch",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/40 dark:to-amber-800/30",
    border: "border-amber-400 dark:border-amber-600",
    emoji: "👀",
    blurb: "Mixed signals — wait for a better entry or stronger fundamentals.",
  },
  avoid: {
    label: "Avoid",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/40 dark:to-red-800/30",
    border: "border-red-400 dark:border-red-600",
    emoji: "🛑",
    blurb: "Either weak business, poor management, or expensive valuation. Skip.",
  },
  distressed: {
    label: "Distressed",
    color: "text-red-800 dark:text-red-200",
    bg: "bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/60 dark:to-red-800/50",
    border: "border-red-600 dark:border-red-500",
    emoji: "💀",
    blurb: "Financial distress detected. Equity models unreliable. Speculative.",
  },
};

function deriveVerdict(
  moat: MoatScoreResult | null,
  capAlloc: CapAllocScoreResult | null,
  distress: DistressAssessment | null,
  mos: number | null,
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];

  // 1. Distress trumps everything
  if (distress?.equityModelsBlocked || distress?.severity === "severe" || distress?.severity === "critical") {
    reasons.push(`Distress signal: ${distress.reasons[0] ?? "equity models unreliable"}`);
    return { verdict: "distressed", reasons };
  }

  const moatScore = moat?.compositeScore ?? null;
  const capScore = capAlloc?.compositeScore ?? null;
  const moatWide = moat?.moatWidth === "wide";

  // 2. Compose the quality picture
  const goodBusiness = moatScore != null && moatScore >= 60;
  const goodManagement = capScore != null && capScore >= 60;
  const greatBusiness = moatScore != null && moatScore >= 75;
  const greatManagement = capScore != null && capScore >= 75;

  if (greatBusiness) reasons.push(`Strong moat (score ${moatScore}, ${moat!.moatWidth})`);
  else if (goodBusiness) reasons.push(`Decent moat (score ${moatScore})`);
  else if (moatScore != null) reasons.push(`Weak moat (score ${moatScore})`);

  if (greatManagement) reasons.push(`Excellent capital allocation (grade ${capAlloc!.grade})`);
  else if (goodManagement) reasons.push(`Good capital allocation (grade ${capAlloc!.grade})`);
  else if (capScore != null) reasons.push(`Mediocre capital allocation (grade ${capAlloc!.grade})`);

  // 3. Compose the valuation picture
  const cheap = mos != null && mos > 0.25;
  const fair = mos != null && mos > 0.0 && mos <= 0.25;
  const expensive = mos != null && mos <= 0.0;

  if (cheap) reasons.push(`Margin of safety: ${(mos! * 100).toFixed(0)}% — cheap`);
  else if (fair) reasons.push(`Margin of safety: ${(mos! * 100).toFixed(0)}% — fair`);
  else if (expensive) reasons.push(`Margin of safety: ${(mos! * 100).toFixed(0)}% — expensive`);
  else reasons.push("No valuation reference (price or intrinsic missing)");

  // 4. Combine into verdict
  // Screaming buy: great + great + cheap
  if ((greatBusiness || moatWide) && greatManagement && cheap) {
    return { verdict: "screaming-buy", reasons };
  }
  // Buy: good business + good management + at-least-fair price (or great + cheap)
  if (goodBusiness && goodManagement && (fair || cheap)) {
    return { verdict: "buy", reasons };
  }
  if ((greatBusiness || moatWide) && (cheap || fair)) {
    return { verdict: "buy", reasons };
  }
  // Avoid: weak business OR weak management
  if (moatScore != null && capScore != null && (moatScore < 35 || capScore < 35)) {
    return { verdict: "avoid", reasons };
  }
  // Avoid: expensive
  if (expensive && !(greatBusiness && greatManagement)) {
    return { verdict: "avoid", reasons };
  }
  // Default: hold
  return { verdict: "hold", reasons };
}

export default function InvestmentThesisCard({ moat, capAlloc, distress, marginOfSafety, price, intrinsic }: Props) {
  const { verdict, reasons } = deriveVerdict(moat, capAlloc, distress, marginOfSafety);
  const profile = VERDICTS[verdict];

  return (
    <div className={`rounded-2xl border-2 ${profile.border} ${profile.bg} p-6 shadow-sm`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{profile.emoji}</span>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Investment Thesis</div>
            <div className={`text-2xl font-bold ${profile.color}`}>{profile.label}</div>
          </div>
        </div>
        {price != null && intrinsic != null && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Price vs Value</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
              ₹{price.toFixed(0)} <span className="text-slate-400">vs</span> ₹{intrinsic.toFixed(0)}
            </div>
          </div>
        )}
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-300 italic mb-3">"{profile.blurb}"</p>

      <div className="space-y-1.5">
        {reasons.map((r, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <span className="text-slate-400 mt-0.5">▪</span>
            <span>{r}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
        Synthesis from: 5-dimension moat scorer · 5-dimension capital allocation grade · distress detector · margin-of-safety calculation.
        Verdict is advisory — not a substitute for your own judgement.
      </div>
    </div>
  );
}
