/**
 * PvreSection — probabilistic valuation range viewer.
 *
 * Milestone D. Runs the PVRE sampler on demand (button-triggered; each run
 * re-runs the engine up to `iterations` times) and renders the resulting
 * value distribution, cross-model dispersion gate, and the P the stock is
 * undervalued at the live/reference market price.
 */
import { useState } from "react";
import type { buildValuationCommandCenter } from "../../engine/valuationCommandCenter";
import type { RecastPeriod, EngineConfig } from "../../engine/types";
import { resolveShareBasis } from "../../engine/shareCountTools";
import { runPvre, PVRE_DEFAULT_BOUNDS } from "../../engine/pvre";
import { buildBrowserSnapshot, persistBrowserSnapshot, listBrowserSnapshots } from "../../engine/pvre/browserStore";
import { formatPct } from "../../engine/valuationCommandCenter";
import { StatTile } from "./atoms";
import { QuantileFanChart } from "../charts/QuantileFanChart";

type CommandCenter = ReturnType<typeof buildValuationCommandCenter>;

function gateBadge(gate: "pass" | "guarded" | "blocked" | null) {
  if (gate == null) return <span className="text-xs wb-text-3">—</span>;
  const cls =
    gate === "pass"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
      : gate === "guarded"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
        : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{gate}</span>
  );
}

export default function PvreSection({
  commandCenter,
  data,
  config,
}: {
  commandCenter: CommandCenter;
  data: RecastPeriod[];
  config: EngineConfig;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof runPvre> | null>(null);
  const [seed, setSeed] = useState(42);
  const [iterations, setIterations] = useState(128);

  const base = commandCenter.scenarios.find((s) => s.key === "base");
  const ticker = config.ticker ?? null;
  const history = ticker && typeof localStorage !== "undefined" ? listBrowserSnapshots(ticker) : [];
  if (!base) return null;

  const run = () => {
    setBusy(true);
    try {
      // We defer to setTimeout so the button shows its loading state.
      setTimeout(() => {
        try {
          const scenarioConfig = resolveShareBasis(data, config).valuationConfig;
          const out = runPvre({
            latest: data[data.length - 1]!,
            baseScenario: base,
            config,
            scenarioConfig,
            seed,
            iterations,
            marketPrice: commandCenter.marketPrice ?? null,
            bounds: PVRE_DEFAULT_BOUNDS,
          });
          setResult(out);
          if (out.status === "ok" && config.ticker) {
            try {
              persistBrowserSnapshot(buildBrowserSnapshot(out, { ticker: config.ticker }));
            } catch {
              /* storage may be unavailable in private mode; non-fatal */
            }
          }
        } finally {
          setBusy(false);
        }
      }, 0);
    } catch (err) {
      setBusy(false);
      throw err;
    }
  };

  return (
    <section className="wb-surface rounded-2xl border p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide wb-text-3">
            Probabilistic Intrinsic Value (PVRE)
          </div>
          <p className="mt-1 text-sm wb-text-2">
            Monte-Carlo distribution of intrinsic value across sampled cost-of-capital, terminal growth,
            and first-year growth/margin inputs. Uses the existing base-scenario engine; adds uncertainty,
            not new math.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 text-xs">
            <label className="wb-text-2">
              Seed{" "}
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-20 rounded border wb-border-strong wb-surface px-2 py-1 wb-text-1"
                disabled={busy}
              />
            </label>
            <label className="wb-text-2">
              Iterations{" "}
              <input
                type="number"
                min={40}
                max={2000}
                step={32}
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
                className="w-20 rounded border wb-border-strong wb-surface px-2 py-1 wb-text-1"
                disabled={busy}
              />
            </label>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Running…" : result ? "Re-run" : "Run PVRE"}
            </button>
          </div>
          {result?.status === "ok" ? (
            <div className="text-[11px] wb-text-3">
              Ran in the browser — seed {result.seed} × {result.iterations} draws.
            </div>
          ) : null}
        </div>
      </div>

      {!result ? (
        <div className="mt-4 rounded-lg border border-dashed wb-border-strong wb-surface-inset p-4 text-sm wb-text-2">
          Run PVRE to see the intrinsic-value distribution, the cross-model disagreement gate, and an
          under-valuation probability. Same seed produces the same output.
        </div>
      ) : result.status === "skipped" ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200">
          Skipped: {"reason" in result ? result.reason : "unknown"}
        </div>
      ) : (
        <>
          {/* Quantile fan — the distribution at a glance */}
          {result.intrinsic && (
            <div className="mt-4 overflow-x-auto">
              <QuantileFanChart
                band={{
                  label: `seed ${result.seed} × ${result.iterations} draws`,
                  q05: result.intrinsic.q05,
                  q25: result.intrinsic.q25,
                  q50: result.intrinsic.q50,
                  q75: result.intrinsic.q75,
                  q95: result.intrinsic.q95,
                }}
                referencePrice={result.referencePrice}
                probabilityUndervalued={result.probabilityUndervalued}
                width={520}
                height={190}
              />
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <StatTile label="Intrinsic range (5–95%)" value={
              result.intrinsic
                ? `₹${result.intrinsic.q05.toFixed(0)} – ₹${result.intrinsic.q95.toFixed(0)}`
                : "—"
            } />
            <StatTile label="Median intrinsic" value={
              result.intrinsic ? `₹${result.intrinsic.q50.toFixed(0)}` : "—"
            } />
            <StatTile label="Disagreement gate" value={
              result.disagreement ? result.disagreement.gate.toUpperCase() : "—"
            } />
            <StatTile label="P(undervalued)" value={
              result.probabilityUndervalued != null ? formatPct(result.probabilityUndervalued, 0) : "—"
            } />
          </div>

          {result.disagreement ? (
            <div className="mt-3 text-xs wb-text-2">
              <div className="flex items-center gap-2">
                <span>Cross-model dispersion gate:</span>
                {gateBadge(result.disagreement.gate)}
                <span className="wb-text-3">
                  (dispersion ratio {result.disagreement.dispersionRatio != null
                    ? result.disagreement.dispersionRatio.toFixed(2)
                    : "?"})
                </span>
              </div>
              <div className="mt-1 wb-text-3">{result.disagreement.reason}</div>
            </div>
          ) : null}

          {history.length > 1 ? (
            <div className="mt-4 rounded-lg border wb-border wb-surface-inset p-3 text-xs wb-text-2">
              <div className="font-medium wb-text-1">Vintage history ({history.length} stored)</div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {history.slice(-6).map((s) => (
                  <div key={`${s.takenAt}-${s.seed}`} className="rounded border wb-border wb-surface p-2">
                    <div className="font-mono text-[10px] wb-text-3">{s.takenAt}</div>
                    <div className="text-[11px]">
                      ₹{s.intrinsicQ50?.toFixed(0) ?? "?"} <span className="wb-text-3">({s.disagreementGate ?? "?"})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
