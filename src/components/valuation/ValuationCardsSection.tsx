import { computeValuation } from "../../engine/PenmanNissimEngine";
import type { ContinuingValueGuardModel } from "../../engine/types";
import { toPerShare } from "../../engine/shareCountTools";
import { ValCard } from "./atoms";
import { type CVMethod, fmt, fmtPerShare } from "./ValuationReport.formatters";

type Valuation = ReturnType<typeof computeValuation>;

/**
 * The Gordon guard's own explanation for a nulled continuing value.
 *
 * `gordonCv` already builds a precise reason — it names the terminal growth and
 * the capital cost it had to be below — and `computeValuation` returns them as
 * `continuingValueGuards`. Only CV3/CV03 discount through Gordon; CV1 is zero
 * and CV2 is a no-growth perpetuity, so neither can trip the spread guard and
 * neither should borrow its wording.
 */
function gordonGuardReason(
  val: Valuation,
  model: ContinuingValueGuardModel,
  cv: CVMethod,
): string | null {
  if (cv !== "CV3") return null;
  return (val.continuingValueGuards ?? []).find((g) => g.model === model)?.reason ?? null;
}

/**
 * `ValCard` decides a card is skipped from `value == null` and renders the
 * reason only inside that branch, so a reason gated on any narrower condition
 * leaves a bare "— Skipped" with nothing beside it — indistinguishable from a
 * card that was never wired up.
 *
 * `V_RE` is null when `equityModelsBlocked || CV_RE_3 == null`
 * (`PenmanNissimEngine.ts:372`), and this card used to explain only the first
 * of those. Typing a terminal growth above ke in the Growth input nulls the
 * value through the second and said nothing at all.
 */
function reCardSkipReason(val: Valuation, cv: CVMethod): string {
  // Checked ahead of the guard: when net worth is gone the equity side has no
  // value to continue, which is the more fundamental of the two blockers.
  if (val.equityModelsBlocked) {
    return val.equityBlockedReason ?? "Equity-side model skipped (negative net worth).";
  }
  return gordonGuardReason(val, "RE_CV3", cv)
    ?? "Residual-income value unavailable for the selected continuing-value method.";
}

/**
 * The ReOI card's reason was already gated on the value being null, so it
 * always said something — but it asserted the cause in prose while the guard
 * carries the actual rates. Prefer the guard's string and keep a non-empty
 * fallback for a null that arrives some other way.
 */
function reoiCardSkipReason(val: Valuation, cv: CVMethod): string {
  return gordonGuardReason(val, "ReOI_CV03", cv)
    ?? "ReOI growth continuing value skipped: terminal growth must be below operating capital cost.";
}

export default function ValuationCardsSection({
  val,
  V_RE,
  V_ReOI,
  cv,
  sharesOut,
}: {
  val: ReturnType<typeof computeValuation>;
  V_RE: number | null;
  V_ReOI: number | null;
  cv: CVMethod;
  sharesOut: number | null;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <ValCard color="indigo" title={`V (RE · ${cv})`} subtitle="Eq.(1a) · Clean surplus" value={V_RE}
        items={V_RE == null ? [] : [
          { l: "CSE₀ (base book value)", v: val.CSE0 },
          { l: "PV of RE series", v: val.pvRE },
          { l: `CV PV (${cv})`, v: V_RE - val.CSE0 - val.pvRE },
        ]} fmt={fmt}
        perShare={V_RE == null ? null : toPerShare(V_RE, sharesOut)}
        skipReason={V_RE == null ? reCardSkipReason(val, cv) : null}
      />
      <ValCard color="emerald" title={`V (ReOI · ${cv === "CV1" ? "CV01" : cv === "CV2" ? "CV02" : "CV03"})`}
        subtitle="Eq.(9) · Ops-only · EV−NFO" value={V_ReOI}
        items={V_ReOI == null ? [] : [
          ...(val.EV_ReOI != null ? [{ l: "EV (NOA₀ + PV ReOI + CV)", v: val.EV_ReOI }] : []),
          { l: "Less: NFO (latest)", v: -val.NFO_latest },
          { l: "PV ReOI", v: val.pvReOI },
        ]} fmt={fmt}
        perShare={V_ReOI == null ? null : toPerShare(V_ReOI, sharesOut)}
        skipReason={V_ReOI == null ? reoiCardSkipReason(val, cv) : null}
      />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">All CV Methods — RE</div>
        {[
          { label: "CV1 (zero)", v: val.V_RE_CV1 },
          { label: "CV2 (perp.)", v: val.V_RE_CV2 },
          { label: "CV3 (growth)", v: val.V_RE_CV3 },
        ].map((row) => (
          <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-mono font-semibold text-indigo-700">
              {row.v == null
                ? <span className="text-amber-600">— (skipped)</span>
                : sharesOut
                  ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share`
                  : `₹${fmt(row.v)} Cr`}
            </span>
          </div>
        ))}
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-4 mb-3">All CV Methods — ReOI</div>
        {[
          { label: "CV01 (zero)", v: val.V_ReOI_CV01 },
          { label: "CV02 (perp.)", v: val.V_ReOI_CV02 },
          { label: "CV03 (growth)", v: val.V_ReOI_CV03 },
        ].map((row) => (
          <div key={row.label} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-mono font-semibold text-emerald-700">
              {row.v == null
                ? <span className="text-amber-600">— (skipped)</span>
                : sharesOut
                  ? `${fmtPerShare(toPerShare(row.v, sharesOut))} / share`
                  : `₹${fmt(row.v)} Cr`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
