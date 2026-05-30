import { useState } from "react";
import { trace } from "../lib/traceLogger";
import type { FinancialInstitutionAnalysisResult } from "../engine/analysisFamily";
import type { BankScenarioCard } from "../engine/bankValuation";
import type { NbfcSidecarData } from "../engine/nbfcSidecarLoader";
import type { EngineConfig } from "../engine/types";
import { SectionHeader, InsightBlock } from "./shared/DesignSystem";
import { generateBankNarrative } from "../engine/narrativeEngine";
import BankHealthChart from "./charts/BankHealthChart";
import SubsidiaryGrowthChart from "./charts/SubsidiaryGrowthChart";
import LgdStageChart from "./charts/LgdStageChart";
import { fmtCr, fmtPct } from "./financial-institution/financialInstitutionFormatters";
import { NbfcMetricsSection } from "./financial-institution/NbfcMetricsSection";
import { InsuranceMetricsSection } from "./financial-institution/InsuranceMetricsSection";
import { NbfcQualitySection } from "./financial-institution/NbfcQualitySection";
import { NbfcRegulatoryPanel } from "./financial-institution/NbfcRegulatoryPanel";
import { NbfcSubsidiaryPanel } from "./financial-institution/NbfcSubsidiaryPanel";
import { NbfcGovernorBanners } from "./financial-institution/NbfcGovernorBanners";
import { AssetQualitySection } from "./financial-institution/AssetQualitySection";
import { ModelCard } from "./financial-institution/ModelCard";

interface Props {
  bankResult: FinancialInstitutionAnalysisResult;
  marketCapCr?: number | null | undefined;
  /** Engine config — required for Excel export. When omitted, export button hidden. */
  config?: EngineConfig | undefined;
  /** Company label used in Cover sheet. Falls back to config.ticker. */
  companyId?: string | null | undefined;
  /** Audit run ID surfaced in Cover sheet for traceability. */
  auditRunId?: string | null | undefined;
  /** Phase D4 — LGD stage migration + RBI NHB regulatory metrics. */
  nbfcSidecar?: NbfcSidecarData | null | undefined;
}

export default function FinancialInstitutionReport({ bankResult, marketCapCr, config, companyId, auditRunId, nbfcSidecar }: Props) {
  const valuation = bankResult.valuation;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportWorkbook = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const { generateBankWorkbook } = await import("../engine/bankExcelExport");
      // config is required for the workbook; if not passed, fall back to a minimal default
      const cfg = config ?? null;
      if (!cfg) {
        throw new Error("Engine config not available — cannot generate workbook.");
      }
      const wbArray = await generateBankWorkbook(bankResult, cfg, {
        companyLabel: companyId ?? cfg.ticker ?? undefined,
        auditRunId: auditRunId ?? null,
        marketCapCr,
      });
      const blob = new Blob([wbArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const latestPeriod = bankResult.periods[bankResult.periods.length - 1]?.period_end?.slice(0, 10) ?? "latest";
      const subtypeLower = bankResult.subtype.toLowerCase();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${subtypeLower}_workbook_${latestPeriod}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace("export", "financialInstitutionReport:failed", { error: msg }, null, { level: "error" });
      setExportError(msg);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Financial Institution Analysis"
        subtitle={`${bankResult.subtype} · ${bankResult.periods.length} periods — NIM, credit costs, capital adequacy, and valuation`}
        icon="🏦"
      />

      {/* Bank narrative insight — auto-generated */}
      {(() => {
        const latestMetrics = bankResult.bankMetrics?.[bankResult.bankMetrics.length - 1];
        if (!latestMetrics) return null;
        const leverage = latestMetrics.totalAssets != null && latestMetrics.totalEquity != null && latestMetrics.totalEquity > 0
          ? latestMetrics.totalAssets / latestMetrics.totalEquity
          : null;
        const narrative = generateBankNarrative({
          ticker: config?.ticker ?? companyId ?? "Bank",
          nim: latestMetrics.nim ?? null,
          costToIncome: latestMetrics.costToIncome ?? null,
          gnpa: null,
          nnpa: null,
          pcr: null,
          roa: latestMetrics.roa ?? null,
          roe: latestMetrics.roe ?? null,
          crar: null,
          leverageMultiple: leverage,
        });
        return narrative ? <InsightBlock text={narrative} icon="🏦" /> : null;
      })()}

      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Subtype: <span className="font-mono">{bankResult.subtype}</span> · {bankResult.periods.length} periods
          </div>
        </div>
        {/* H5 — Bank/NBFC/Insurance Excel export. Industrial pipeline already
            had this; banks were the audit gap. Workbook contents adapt to subtype. */}
        {config && (
          <button
            onClick={handleExportWorkbook}
            disabled={exporting}
            className="text-sm px-3 py-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/60 font-medium border border-emerald-200 dark:border-emerald-900/60 disabled:opacity-50"
          >
            {exporting ? "Generating…" : "📥 Export Excel Workbook"}
          </button>
        )}
      </div>
      {exportError && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 p-3 text-sm text-rose-900 dark:text-rose-200">
          Export failed: {exportError}
        </div>
      )}

      {bankResult.bankMetrics && bankResult.bankMetrics.length >= 2 && (
        <BankHealthChart metrics={bankResult.bankMetrics} ke={null} />
      )}

      {bankResult.periods.length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">Period Snapshots</h3>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-slate-300 dark:border-slate-700">
                  <th className="text-left py-1 pr-3">Period</th>
                  <th className="text-right py-1 px-3">Book Value</th>
                  <th className="text-right py-1 px-3">Earnings</th>
                  {bankResult.subtype === "nbfc" ? (
                    <th className="text-right py-1 px-3">Borrowings</th>
                  ) : bankResult.subtype === "insurance" ? (
                    <th className="text-right py-1 px-3">Premium Earned</th>
                  ) : (
                    <th className="text-right py-1 px-3">Deposits</th>
                  )}
                  <th className="text-right py-1 px-3">
                    {bankResult.subtype === "nbfc" ? "Loan Book" : bankResult.subtype === "insurance" ? "Claims Incurred" : "Advances"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bankResult.periods.map((p) => (
                  <tr key={p.period_end} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-1 pr-3 font-mono">{p.period_end}</td>
                    <td className="text-right py-1 px-3">{fmtCr(p.bookValue)}</td>
                    <td className="text-right py-1 px-3">{fmtCr(p.earnings)}</td>
                    {config?.shares_outstanding && config.shares_outstanding > 0 && (<>
                      <td className="text-right py-1 px-3 text-indigo-600 dark:text-indigo-400">
                        {p.bookValue != null ? `₹${(p.bookValue / config.shares_outstanding).toFixed(0)}` : "—"}
                      </td>
                      <td className="text-right py-1 px-3 text-indigo-600 dark:text-indigo-400">
                        {p.earnings != null ? `₹${(p.earnings / config.shares_outstanding).toFixed(1)}` : "—"}
                      </td>
                    </>)}
                    <td className="text-right py-1 px-3">
                      {fmtCr(
                        bankResult.subtype === "nbfc"
                          ? p.borrowings
                          : bankResult.subtype === "insurance"
                          ? p.premiumEarned
                          : p.deposits
                      )}
                    </td>
                    <td className="text-right py-1 px-3">
                      {fmtCr(bankResult.subtype === "insurance" ? p.claimsExpense : p.advances)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Phase K2 — NBFC-specific framing: leverage, yield/cost/spread, debt mix.
          Only rendered when subtype is NBFC and bankMetrics is present. */}
      {bankResult.subtype === "nbfc" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && (
        <NbfcMetricsSection metrics={bankResult.bankMetrics} />
      )}

      {/* Phase D2 — NBFC IndAS-109 quality (Stage 3, ECL coverage, AUM, AUM growth). */}
      {bankResult.subtype === "nbfc" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && (
        <NbfcQualitySection metrics={bankResult.bankMetrics} />
      )}

      {/* Phase D3c — Subsidiary breakdown from sidecar data.
       *  Available for banks AND NBFCs whenever the sidecar carries
       *  Capitaline "Subsidiaries" exports. Render is gated on data presence
       *  (subsidiaries non-empty), not subtype. */}
      {bankResult.bankMetrics && bankResult.bankMetrics.length > 0 &&
        bankResult.bankMetrics.some(m =>
          m.quality?.subsidiaries && m.quality.subsidiaries.length > 0 &&
          m.quality.subsidiaries.some(s => s.name !== "No Subsidiaries")
        ) && (
        <NbfcSubsidiaryPanel metrics={bankResult.bankMetrics} />
      )}
      {bankResult.bankMetrics && bankResult.bankMetrics.length > 0 &&
        bankResult.bankMetrics.some(m =>
          m.quality?.subsidiaries && m.quality.subsidiaries.length > 0 &&
          m.quality.subsidiaries.some(s => s.name !== "No Subsidiaries")
        ) && (
        <SubsidiaryGrowthChart
          periods={bankResult.bankMetrics.filter(m => m.quality?.subsidiaries).map(m => ({
            fiscal_label: m.period_end.slice(0, 4),
            subsidiaries: m.quality!.subsidiaries!,
          }))}
        />
      )}

      {/* Phase D4 — LGD stage migration + RBI NHB regulatory metrics. */}
      {bankResult.subtype === "nbfc" && nbfcSidecar && (
        <NbfcRegulatoryPanel sidecar={nbfcSidecar} />
      )}
      {bankResult.subtype === "nbfc" && nbfcSidecar && nbfcSidecar.lgd.length >= 2 && (
        <LgdStageChart lgdData={nbfcSidecar.lgd} />
      )}

      {/* Phase D2 — NBFC governor + credit-cycle advisory banners. */}
      {bankResult.subtype === "nbfc" && valuation && (
        <NbfcGovernorBanners
          crarGov={valuation.crarGovernor}
          cycle={valuation.creditCostCycle}
          eclStressGov={valuation.eclStressGovernor}
          spreadComp={valuation.spreadCompression}
        />
      )}

      {/* Insurance-specific framing */}
      {bankResult.subtype === "insurance" && bankResult.bankMetrics && bankResult.bankMetrics.length > 0 && (
        <InsuranceMetricsSection metrics={bankResult.bankMetrics} />
      )}

      {/* Phase B5.3 — Asset Quality (NPA, CRAR, PCR, slippage, CASA, growth).
          Renders for both bank and NBFC subtypes when bankMetrics + assetQuality
          are present. The section itself handles the no-coverage case with an
          amber reminder banner — drop a quality_indicators.json sidecar to
          populate it. */}
      {(bankResult.subtype === "bank" || bankResult.subtype === "nbfc") &&
        bankResult.bankMetrics &&
        bankResult.bankMetrics.length > 0 &&
        bankResult.assetQuality && (
          <AssetQualitySection
            metrics={bankResult.bankMetrics}
            signals={bankResult.assetQuality}
          />
        )}

      {valuation && (
        <section>
          <h3 className="font-semibold mb-2">{bankResult.subtype === "insurance" ? "Insurance Valuation" : "Bank Valuation"} (Phase B4)</h3>
          <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Sustainable ROE</div>
              <div className="font-semibold">{fmtPct(valuation.sustainableROE)}</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Cost of Equity (ke)</div>
              <div className="font-semibold">{fmtPct(valuation.ke)}</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Terminal Growth (g)</div>
              <div className="font-semibold">{fmtPct(valuation.terminalGrowth)}</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">Latest Book Value</div>
              <div className="font-semibold">{fmtCr(valuation.latestBookValue)}</div>
            </div>
          </div>

          <div className={`grid grid-cols-1 ${
            (valuation.evBased?.status === "computed" ? 1 : 0) +
            (valuation.pAum?.status === "computed" ? 1 : 0) +
            (valuation.roaLeverageRI?.status === "computed" ? 1 : 0) >= 2
              ? "md:grid-cols-3 lg:grid-cols-5"
              : valuation.evBased?.status === "computed" ||
                valuation.pAum?.status === "computed" ||
                valuation.roaLeverageRI?.status === "computed"
              ? "md:grid-cols-4"
              : "md:grid-cols-3"
          } gap-3 mb-4`}>
            <ModelCard name="Justified P/B Gordon" model={valuation.justifiedPB} marketCap={marketCapCr} />
            <ModelCard name="Equity Residual Income" model={valuation.equityResidualIncome} marketCap={marketCapCr} />
            <ModelCard name="Sustainable DDM" model={valuation.sustainableDDM} marketCap={marketCapCr} />
            {valuation.evBased?.status === "computed" && (
              <ModelCard name="EV Based Valuation" model={valuation.evBased} marketCap={marketCapCr} />
            )}
            {/* Phase D2 — NBFC P/AUM lens. */}
            {valuation.pAum && (
              <ModelCard name="P/AUM (NBFC)" model={valuation.pAum} marketCap={marketCapCr} />
            )}
            {/* Phase D2 — ROA × Leverage three-stage Residual Income (NBFC). */}
            {valuation.roaLeverageRI && (
              <ModelCard name="ROA × Leverage RI (NBFC)" model={valuation.roaLeverageRI} marketCap={marketCapCr} />
            )}
          </div>

          {valuation.triangulatedValue != null && (
            <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50/40 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
              <div className="text-xs uppercase tracking-wide text-indigo-700 dark:text-indigo-300 mb-1">Triangulated Intrinsic Value (median)</div>
              <div className="text-3xl font-bold">{fmtCr(valuation.triangulatedValue)}</div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Median of {valuation.modelsContributing.length} model(s): {valuation.modelsContributing.join(", ")}
              </div>
              {marketCapCr != null && marketCapCr > 0 && (
                <div className={`text-sm mt-2 ${(valuation.triangulatedValue / marketCapCr - 1) > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                  {(valuation.triangulatedValue / marketCapCr - 1) > 0 ? "+" : ""}{fmtPct(valuation.triangulatedValue / marketCapCr - 1, 0)} vs market cap of {fmtCr(marketCapCr)}
                </div>
              )}
            </div>
          )}

          {valuation.modelsContributing.length === 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              No models could compute a value. Each model's reason for skipping is shown above.
            </div>
          )}
          {/* Phase E: Scenario Analysis */}
          {valuation.scenarios && valuation.scenarios.cards.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-3 text-slate-700 dark:text-slate-300">
                Scenario Analysis (Phase E)
              </h4>
              <div className="grid grid-cols-3 gap-3">
                {valuation.scenarios.cards.map((card: BankScenarioCard) => {
                  const colorClass =
                    card.key === "base"
                      ? "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/20"
                      : card.key === "stress"
                        ? "border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-900/20"
                        : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/20";
                  const upsideClass =
                    card.upsidePct != null && card.upsidePct > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400";
                  return (
                    <div key={card.key} className={"rounded-lg border p-4 text-sm " + colorClass}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs uppercase tracking-wide">
                          {card.label}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {Math.round(card.probability * 100)}%
                        </span>
                      </div>
                      <div className="text-2xl font-bold mb-1">
                        {(() => {
                          const shares = config?.shares_outstanding;
                          const perShare = shares && shares > 0 && card.intrinsicValue != null
                            ? card.intrinsicValue / shares
                            : card.intrinsicPerShare;
                          return perShare != null
                            ? `₹${perShare.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                            : card.intrinsicValue != null
                              ? fmtCr(card.intrinsicValue)
                              : "N/A";
                        })()}
                      </div>
                      {card.intrinsicValue != null && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 -mt-0.5 mb-1">
                          {fmtCr(card.intrinsicValue)} total
                        </div>
                      )}
                      {card.upsidePct != null && (
                        <div className={"text-xs font-medium " + upsideClass}>
                          {card.upsidePct > 0 ? "+" : ""}
                          {Math.round(card.upsidePct * 100)}% vs market
                        </div>
                      )}
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                        ROE {Math.round(card.roe * 100)}% &middot; g {Math.round(card.g * 100)}% &middot; ke {Math.round(card.ke * 100)}%
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 italic">
                        {card.reason}
                      </div>
                    </div>
                  );
                })}
              </div>
              {valuation.scenarios.primary && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Primary case: {valuation.scenarios.primary}
                </div>
              )}
            </div>
          )}

        </section>
      )}

      {!valuation && (
        <section>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Bank valuation not computed. This usually means the engine config wasn't passed to processBankData (legacy code path) or the data is empty.
          </div>
        </section>
      )}
    </div>
  );
}
