import { useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { EngineConfig, RawPeriodData, RecastPeriod } from "../engine/types";
import { resolveCostOfCapitalFromConfig } from "../engine/costOfCapital";
import { ACTIVE_MARKET_PACKS, analysisAsOfToday } from "../engine/marketPacks";
import { computeValuation, deriveKwFromStructure } from "../engine/PenmanNissimEngine";
import { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { buildAnalysisPublicationSnapshot } from "../lib/publication/analysisPublicationSnapshot";
import { deriveCompanyLabel } from "../engine/valuationPolicy";
import { computeV3Analytics, V3AnalyticsBundle, computeAnchorTable } from "../engine/v3Analytics";
import { AuditSubmissionMeta } from "../lib/audit";
import { trace } from "../lib/traceLogger";
import TraceabilityTrustPanel from "./TraceabilityTrustPanel";
import type { SanityAssessment } from "../engine/ratioSanity";
import type { ITServicesSignal } from "../engine/itServicesDetector";
import type { ReportArtifactKind, ReportExportResult } from "../reporting";
import {
  cagr,
  avg,
  median,
} from "./academic/AcademicReport.formatters";
import {
  computeSection6BLocal,
  computeNoaDiagnostics,
  computeNoaShiftSeries,
  computePeriodDiagnostics,
  computeRatioTimeline,
} from "./academic/AcademicReport.hooks";
import {
  runExportPdf,
  runExportIcBundle,
  runExportWorkbook,
} from "./academic/AcademicReport.exports";
import { MemoHeaderSection } from "./academic/MemoHeaderSection";
import { ExecutiveFindingsSection } from "./academic/ExecutiveFindingsSection";
import { MethodologySection } from "./academic/MethodologySection";
import { ProfitabilityDiagnosticsSection, VersionChangeLogSection } from "./academic/ProfitabilityDiagnostics";
import { NoaDenominatorSection, NoaStructuralBreakSection } from "./academic/NoaDiagnosticsSection";
import { BalanceSheetSection } from "./academic/BalanceSheetSection";
import { CashFlowQualitySection, AccrualTimeSeriesSection, OperatingTrajectorySection } from "./academic/CashFlowSections";
import { ValuationSynthesisSection, SensitivityMatrixSection, ResidualIncomeStreamSection, TerminalSensitivitySection } from "./academic/ValuationSection";
import { Section6BPanel } from "./academic/Section6BPanel";
import { QualityScoreSection, InvestmentInterpretationSection } from "./academic/QualityAndInterpretationSections";
import { ExportToolbar } from "./academic/ExportToolbar";
import { useAcademicEquations } from "./academic/useAcademicEquations";

interface Props {
  data: RecastPeriod[];
  config: EngineConfig;
  rawData?: RawPeriodData[] | null | undefined;
  auditMeta?: AuditSubmissionMeta | null | undefined;
  traceability?: AnalysisTraceabilityEnvelope | null | undefined;
  publication?: ReturnType<typeof buildAnalysisPublicationSnapshot> | null | undefined;
  /** Phase 9 — anchor ratio bands for export confidence stamps. */
  ratioSanity?: SanityAssessment | null | undefined;
  /**
   * Phase E3 — IT-services fingerprint. The moat scorer needs it to mark its
   * own classification unreliable; without it an exported report presents an
   * unqualified moat width for a company whose RNOA is structurally inflated.
   *
   * Required rather than optional — unlike its neighbours here — because this
   * call site previously passed a literal `undefined` under a comment saying
   * the surface had no signal to pass. It did have one; it was never routed.
   * Pass `null` explicitly when a company genuinely has no signal.
   */
  itServices: ITServicesSignal | null;
}

export default function AcademicReport({ data, config, rawData, auditMeta, traceability: sharedTraceability = null, publication: precomputedPublication = null, ratioSanity = null, itServices }: Props) {
  // KaTeX is lazy-loaded so the entry chunk doesn't ship the renderer for
  // users who never open Academic Report.
  const { eqROCE, eqRNOA, eqRE, eqReOI } = useAcademicEquations();

  const reportRef = useRef<HTMLDivElement | null>(null);
  const [activeExport, setActiveExport] = useState<ReportArtifactKind | null>(null);
  const [exportNotice, setExportNotice] = useState<{
    tone: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const [hmacKeyId, setHmacKeyId] = useState("IC-LOCAL-KEY");
  const [hmacSecret, setHmacSecret] = useState("");

  const traceRecords = useMemo(() => {
    const rows: Array<{
      period: string;
      line: string;
      statement: string;
      key: string;
      value: number;
      matchType: string;
      note: string;
    }> = [];
    for (const p of data) {
      if (!p.trace) continue;
      for (const [line, entries] of Object.entries(p.trace)) {
        for (const e of entries) {
          rows.push({
            period: p.period_end,
            line,
            statement: e.statement,
            key: e.key,
            value: e.value,
            matchType: e.matchType,
            note: e.note ?? "",
          });
        }
      }
    }
    return rows;
  }, [data]);

  const fallbackPublication = useMemo(() => buildAnalysisPublicationSnapshot({
    data,
    config,
    rawData,
    auditMeta,
    sharedTraceability,
  }), [data, config, rawData, auditMeta, sharedTraceability]);
  const publication = precomputedPublication ?? fallbackPublication;
  const provenanceRows = publication.provenanceRows;
  const valuationReadiness = publication.valuationReadiness;
  const policyVersions = publication.policyVersions;
  const qualityGate = publication.qualityGate;
  const traceability = publication.traceability;
  const granularityChecklist = publication.granularityChecklist;
  const traceabilitySummary = publication.traceabilitySummary;
  const runIdentity = publication.runIdentity;

  const performExport = async (
    format: ReportArtifactKind,
    operation: () => Promise<ReportExportResult>,
  ) => {
    if (activeExport) return;
    setActiveExport(format);
    setExportNotice(null);
    trace("export", `report-export-${format}-started`, { companyId, format });
    try {
      const result = await operation();
      const size = result.bytes >= 1024 * 1024
        ? `${(result.bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(result.bytes / 1024))} KB`;
      const auditUnavailable = result.auditStatus === "unavailable";
      setExportNotice({
        tone: auditUnavailable ? "warning" : "success",
        message: auditUnavailable
          ? `Downloaded ${result.filename} (${size}). Audit storage was unavailable; the local file is complete.`
          : `Downloaded ${result.filename} (${size}).`,
      });
      trace("export", `report-export-${format}-completed`, { companyId, format }, {
        filename: result.filename,
        bytes: result.bytes,
        auditStatus: result.auditStatus,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportNotice({
        tone: "error",
        message: `Export failed: ${message}`,
      });
      trace("export", `report-export-${format}-failed`, { companyId, format }, { error: message }, { level: "error" });
    } finally {
      setActiveExport(null);
    }
  };

  const exportPdf = () => {
    void performExport("pdf", () => runExportPdf({
      reportEl: reportRef.current,
      data,
      companyId,
      valuationReadiness,
      traceability,
      runIdentity,
      auditMeta,
    }));
  };

  const exportIcBundle = () => {
    void performExport("zip", () => runExportIcBundle({
      reportEl: reportRef.current,
      data,
      traceRecords,
      provenanceRows,
      granularityChecklist,
      valuationReadiness,
      policyVersions,
      traceability,
      runIdentity,
      companyId,
      hmacKeyId,
      hmacSecret,
      auditMeta,
    }));
  };

  const exportWorkbook = () => {
    void performExport("xlsx", () => runExportWorkbook({
      companyId,
      valuationReadiness,
      policyVersions,
      traceability,
      runIdentity,
      auditMeta,
      data,
      valuation,
      config,
      ratioSanity,
    }));
  };

  if (!data || data.length < 2) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
        <p className="font-semibold text-amber-800 text-lg">Need at least 2 periods to generate report</p>
        <p className="text-amber-700 text-sm mt-1">Upload full history to produce a rigorous academic narrative.</p>
      </div>
    );
  }

  const latest = data[data.length - 1]!;
  const first = data[0]!;
  const years = Math.max(data.length - 1, 1);
  const companyId = deriveCompanyLabel(rawData, config.ticker, auditMeta?.companyId);
  const trailing = data.slice(Math.max(0, data.length - 5));
  const valuationData = data.slice(0, Math.max(2, valuationReadiness.anchorIndex + 1));
  const valuationLatest = valuationData[valuationData.length - 1]!;

  const salesCagr = cagr(first.is.Sales, latest.is.Sales, years);
  const cniCagr = cagr(first.is.CNI, latest.is.CNI, years);
  const cseCagr = cagr(first.bs.CSE, latest.bs.CSE, years);

  const roce5 = avg(trailing.map((d) => d.ratios?.ROCE));
  const rnoa5 = median(trailing.map((d) => d.ratios?.RNOA));
  const spread5 = median(trailing.map((d) => d.ratios?.SPREAD));
  const pm5 = avg(trailing.map((d) => d.ratios?.PM));
  const ato5 = median(trailing.map((d) => d.ratios?.ATO));
  const accrual5 = avg(trailing.map((d) => d.ratios?.accrual_ratio_bs));
  const ccr5 = avg(trailing.map((d) => d.ratios?.cash_conversion_ratio));
  const ccrLatest = latest.ratios?.cash_conversion_ratio ?? null;
  const steadyState = data.slice(Math.max(0, data.length - 2));
  const steadyRnoa = avg(steadyState.map((d) => d.ratios?.RNOA));
  const steadyAto = avg(steadyState.map((d) => d.ratios?.ATO));

  const noaDiagnostics = computeNoaDiagnostics(data);
  const noaFlagCount = noaDiagnostics.filter((d) => d.flagged).length;
  const noaShiftSeries = computeNoaShiftSeries(data);
  const largestNoaShift = noaShiftSeries.reduce((best, row) =>
    Math.abs(row.deltaNOA) > Math.abs(best.deltaNOA) ? row : best,
    noaShiftSeries[0] ?? { period: latest.period_end, deltaNOA: 0, deltaOA: 0, deltaFA: 0, deltaOL: 0, deltaFO: 0 },
  );

  // S-9.4C: one cost-of-equity derivation for the whole app. This read the
  // `ke_from_config` helper, which computes `rf + sectorBeta × erp` off the same
  // config fields the resolver does — so the two agreed only by coincidence of
  // constants, and either could have been edited alone while this surface printed
  // one discount rate and the recorded run kept another.
  //
  // Packs supplied for the same reason. This surface is the one a reviewer
  // exports, so the discount rate it prints has to be the rate the run
  // discounted at, and a resolver called without the packs derives the unpinned
  // one from the same config.
  const ke = resolveCostOfCapitalFromConfig({
    config,
    ...ACTIVE_MARKET_PACKS,
    analysisAsOf: analysisAsOfToday(),
  }).ke;
  const kwSeries: number[] = [];
  for (let i = 1; i < valuationData.length; i++) {
    kwSeries.push(deriveKwFromStructure(valuationData[i]!, valuationData[i - 1]!, ke, config.risk_free_rate, config));
  }
  const kw = kwSeries.length ? kwSeries[kwSeries.length - 1]! : ke;
  const kwMedian = median(kwSeries);
  const gInput = Math.min(0.05, Math.max(0.02, (salesCagr ?? 0.04) * 0.5));
  const nominalGdpProxy = 0.06;
  const gCapCandidates = [
    { label: "75% of Sales CAGR", value: Math.max(0, (salesCagr ?? 0.04) * 0.75) },
    { label: "nominal GDP proxy", value: nominalGdpProxy },
    { label: "ke - 2% floor", value: Math.max(0, ke - 0.02) },
  ];
  const bindingGCap = gCapCandidates.reduce((a, b) => (a.value < b.value ? a : b));
  const g = Math.max(0, Math.min(gInput, bindingGCap.value));
  const valuation = computeValuation(valuationData, ke, kw, g, config);
  const valuationLegacyKw = computeValuation(valuationData, ke, config.risk_free_rate, g, config);
  // Phase J2: V_RE_CV3 may be null on negative-equity companies. Fall back
  // to V_ReOI_CV03 for the identity-gap so the report stays renderable.
  const reoiCv03 = valuation.V_ReOI_CV03;
  const reAnchor = valuation.V_RE_CV3 ?? reoiCv03;
  const reoiIdentityGap = reAnchor != null && reoiCv03 != null ? Math.abs(reAnchor - reoiCv03) : 0;
  const reoiIdentityGapPct = reAnchor != null && reAnchor !== 0
    ? reoiIdentityGap / Math.abs(reAnchor)
    : null;

  // §14 V3 Composite Confidence Score
  const v3Bundle: V3AnalyticsBundle | null = (() => {
    if (reAnchor == null || reoiCv03 == null) return null;
    try {
      return computeV3Analytics(
        valuationData,
        config,
        reAnchor,
        reoiCv03,
        config.g_terminal_override,
        kw,
        // Phase E3. This used to be an explicit `undefined` with a comment
        // saying the surface had no signal to pass — but the signal exists, it
        // just was not routed here, so an exported report stated a moat width
        // for an IT-services company without the caveat the scorer writes.
        itServices,
        // Same packs `ke` above was resolved from — an exported report must not
        // discount its bundle at a different rate than it prints.
        { ...ACTIVE_MARKET_PACKS, analysisAsOf: analysisAsOfToday() },
      );
    } catch { return null; }
  })();
  const v3ConfidenceScore = v3Bundle?.confidence.composite ?? null;
  const v3ConfidenceClass = v3Bundle?.confidence.classification ?? null;
  const v3TerminalAnchor = v3Bundle?.anchorResult;

  const sensitivityKe = [Math.max(0.05, ke - 0.04), Math.max(0.05, ke - 0.02), ke, ke + 0.02];
  // S-9.7: g columns must be strictly ascending (monotone)
  const gBase = v3TerminalAnchor?.g_applied ?? g;
  const sensitivityG = [Math.max(0.01, gBase - 0.02), Math.max(0.01, gBase - 0.01), gBase]
    .filter((gv, i, arr) => gv < ke - 0.005 && arr.indexOf(gv) === i)
    .sort((a, b) => a - b);
  const matrixREAnchor = v3TerminalAnchor?.RE_value;
  const sensitivityMatrix = sensitivityKe.map((keCase) => ({
    ke: keCase,
    // Phase J2: V_RE_CV3 may be null when latest CSE ≤ 0; coerce to NaN
    // so downstream rendering shows "—" rather than crashing on null.
    values: sensitivityG.map((gCase) =>
      computeValuation(valuationData, keCase, kw, gCase, config, matrixREAnchor).V_RE_CV3 ?? Number.NaN,
    ),
  }));

  const cumulativeDirtySurplus = data.slice(1).reduce((sum, d, idx) => {
    const prev = data[idx]!;
    return sum + ((d.bs.CSE - prev.bs.CSE) - d.is.CNI + d.cf.d_t);
  }, 0);
  const periodDiagnostics = computePeriodDiagnostics(data);
  const latestDiag = periodDiagnostics[periodDiagnostics.length - 1];
  const prevLatest = data[data.length - 2]!;
  const accrualDeltaReceivables = latest.bs.TradeReceivables - prevLatest.bs.TradeReceivables;
  const accrualDeltaInventory = latest.bs.Inventory - prevLatest.bs.Inventory;
  const accrualDeltaPayables = latest.bs.TradePayables - prevLatest.bs.TradePayables;
  const accrualWorkingCapitalProxy = accrualDeltaReceivables + accrualDeltaInventory - accrualDeltaPayables;
  const accrualDeltaOtherOA = (latest.bs.OA - prevLatest.bs.OA) - accrualDeltaReceivables - accrualDeltaInventory;
  const accrualDeltaOtherOL = (latest.bs.OL - prevLatest.bs.OL) - accrualDeltaPayables;
  const accrualOtherProxy = accrualDeltaOtherOA - accrualDeltaOtherOL;
  const accrualTotalProxy = accrualWorkingCapitalProxy + accrualOtherProxy;
  const accrualSeries = data.slice(1).map((d) => ({ period: d.period_end, accrual: d.ratios?.accrual_ratio_bs ?? null }));
  const latestAccrual = latest.ratios?.accrual_ratio_bs ?? null;

  const fScore = latest.quality?.piotroski_total ?? null;
  const dilutionRecent = data.slice(Math.max(0, data.length - 5)).reduce((sum, d) => sum + Math.max(0, d.cf.EquityIssued || 0), 0);
  const ratioTimeline = computeRatioTimeline(data, periodDiagnostics);
  const explicitHorizonYears = Math.max(valuation.reSeries.length, 0);
  // Phase J2: V_RE_CV3 may be null when latest CSE ≤ 0.
  const terminalWeightRE = valuation.V_RE_CV3 != null && valuation.V_RE_CV3 !== 0 && valuation.CV_RE != null
    ? ((valuation.CV_RE / Math.pow(1 + valuation.ke, explicitHorizonYears)) / valuation.V_RE_CV3)
    : null;
  const latestEq16Residual = latest.ratios?.ROCE_eq16_error ?? null;
  const latestRe = valuation.reSeries.length ? valuation.reSeries[valuation.reSeries.length - 1]!.RE : null;
  const dividendCashGap = latest.cf.DividendPaid - latest.cf.FCF_cash;
  const faRunwayYears = dividendCashGap > 0 ? latest.bs.FA / dividendCashGap : null;
  const mScore = latest.quality?.beneish_mscore ?? null;
  const zScore = latest.quality?.altman_zprime ?? null;

  const zZone = zScore == null ? "N/A" : zScore > 2.9 ? "Safe" : zScore > 1.23 ? "Grey" : "Distress";
  const mFlag = mScore != null && mScore > -1.78;
  const eq16ResidualPp = latestEq16Residual != null ? latestEq16Residual * 100 : null;
  const eq16Tier = eq16ResidualPp == null ? "N/A" : Math.abs(eq16ResidualPp) > 15 ? "CRITICAL" : Math.abs(eq16ResidualPp) > 5 ? "ELEVATED" : Math.abs(eq16ResidualPp) >= 2 ? "WARNING" : "OK";
  const reSeriesVals = valuation.reSeries.map((r) => r.RE);
  const rePrev = reSeriesVals.length >= 2 ? reSeriesVals[reSeriesVals.length - 2] : null;
  const reMedian = median(reSeriesVals);
  const terminalReAnomaly = latestRe != null && ((rePrev != null && latestRe > 2 * rePrev) || (reMedian != null && latestRe > 2.5 * reMedian));
  const terminalFlagCount = (latestDiag?.flags.length ?? 0)
    + (terminalReAnomaly ? 1 : 0)
    + (Math.abs(eq16ResidualPp ?? 0) > 15 ? 1 : 0)
    + ((reoiIdentityGapPct ?? 0) > 0.2 ? 1 : 0);
  const confidenceTier = terminalFlagCount >= 3 ? "structurally compromised" : terminalFlagCount === 2 ? "multiple anomalies" : terminalFlagCount === 1 ? "one anomaly" : "clean";
  const tvContaminated = terminalReAnomaly && ((latestDiag?.flags.length ?? 0) > 0);
  const primaryValuation = v3TerminalAnchor?.V_total ?? valuation.V_RE_CV3;
  const tvShare = v3TerminalAnchor?.TV_share ?? terminalWeightRE;
  const tvGrade = v3TerminalAnchor?.TV_grade ?? (tvShare == null ? "N/A" : tvShare < 0.25 ? "GRADE_A" : tvShare < 0.4 ? "GRADE_B" : tvShare < 0.6 ? "GRADE_C" : "GRADE_D");
  const anchorTable = v3TerminalAnchor
    ? computeAnchorTable(valuation.CSE0, valuation.pvRE, v3TerminalAnchor, ke, explicitHorizonYears)
    : [];

  const sharesFromConfig = config.shares_outstanding ?? null;
  const derivedShareCount = v3Bundle?.shareCount ?? null;
  const sharesToUse = sharesFromConfig ?? derivedShareCount?.shares ?? null;
  const local6B = computeSection6BLocal({
    // Phase J2: when the equity-side path is blocked, anchor on
    // V_ReOI_CV03 so Section 6B still produces an intrinsic-per-share
    // estimate (enterprise-level) rather than crashing on null.
    primaryValue: primaryValuation ?? valuation.V_ReOI_CV03 ?? 0,
    ke,
    g: gBase,
    cse0: valuation.CSE0,
    pvRE: valuation.pvRE,
    reAnchor: v3TerminalAnchor?.RE_value ?? (latestRe ?? 0),
    explicitPeriods: Math.max(explicitHorizonYears, 1),
    periods: valuationData,
    shares: sharesToUse,
    marketPrice: config.market_price,
    sharesSource: sharesFromConfig != null ? "user input" : (derivedShareCount?.source ?? "unavailable"),
  });
  const blockingIssues = qualityGate?.coverageSummary.unresolvedBySeverity.critical ?? [];
  const diagnosticIssues = qualityGate?.coverageSummary.unresolvedBySeverity.warning ?? [];
  const optionalIssues = qualityGate?.coverageSummary.unresolvedBySeverity.info ?? [];

  return (
    <div className="space-y-4">
      <ExportToolbar
        hmacKeyId={hmacKeyId}
        setHmacKeyId={setHmacKeyId}
        hmacSecret={hmacSecret}
        setHmacSecret={setHmacSecret}
        exportWorkbook={exportWorkbook}
        exportPdf={exportPdf}
        exportIcBundle={exportIcBundle}
        activeExport={activeExport}
        notice={exportNotice}
      />

      <div ref={reportRef} className="space-y-6">
      {traceabilitySummary && (
        <TraceabilityTrustPanel
          title="Report Trust Gate"
          summary={traceabilitySummary}
          confidenceStatus={traceability.confidence.status}
          rigorLabel={traceability.rigor.currentLabel}
          parserStatus={traceability.parserFidelity.status}
          reconciliationStatus={traceability.reconciliation.status}
          cautionHeading="Read the memo and exported artifacts in the context of these unresolved gates"
        />
      )}
      <MemoHeaderSection
        companyId={companyId}
        first={first}
        latest={latest}
        valuationReadiness={valuationReadiness}
        qualityGate={qualityGate}
        traceability={traceability}
        runIdentity={runIdentity}
        blockingIssues={blockingIssues}
        diagnosticIssues={diagnosticIssues}
        optionalIssues={optionalIssues}
        primaryValuation={primaryValuation}
        valuation={valuation}
      />


      <ExecutiveFindingsSection
        first={first}
        latest={latest}
        salesCagr={salesCagr}
        cniCagr={cniCagr}
        cseCagr={cseCagr}
        roce5={roce5}
        rnoa5={rnoa5}
        spread5={spread5}
        steadyRnoa={steadyRnoa}
        pm5={pm5}
        ato5={ato5}
        latestAccrual={latestAccrual}
        ccrLatest={ccrLatest}
        ccr5={ccr5}
        accrual5={accrual5}
        fScore={fScore}
        mScore={mScore}
        mFlag={mFlag}
        zScore={zScore}
        zZone={zZone}
        reoiIdentityGap={reoiIdentityGap}
        reoiIdentityGapPct={reoiIdentityGapPct}
        confidenceTier={confidenceTier}
        terminalFlagCount={terminalFlagCount}
        tvGrade={tvGrade}
        tvShare={tvShare}
        valuationReadiness={valuationReadiness}
        valuationLatest={valuationLatest}
        v3ConfidenceScore={v3ConfidenceScore}
        v3ConfidenceClass={v3ConfidenceClass}
        v3TerminalAnchor={v3TerminalAnchor}
        v3Bundle={v3Bundle}
      />


      <MethodologySection
        rawData={rawData}
        data={data}
        eqROCE={eqROCE}
        eqRNOA={eqRNOA}
        eqRE={eqRE}
        eqReOI={eqReOI}
      />


      <ProfitabilityDiagnosticsSection
        latest={latest}
        roce5={roce5}
        rnoa5={rnoa5}
        spread5={spread5}
        pm5={pm5}
        ato5={ato5}
        steadyRnoa={steadyRnoa}
        steadyAto={steadyAto}
        salesCagr={salesCagr}
        cniCagr={cniCagr}
      />

      <VersionChangeLogSection v3Bundle={v3Bundle} />

      <NoaDenominatorSection
        noaDiagnostics={noaDiagnostics}
        noaFlagCount={noaFlagCount}
      />

      <NoaStructuralBreakSection
        largestNoaShift={largestNoaShift}
        noaShiftSeries={noaShiftSeries}
        v3Bundle={v3Bundle}
      />

      <BalanceSheetSection latest={latest} />

      <CashFlowQualitySection
        latest={latest}
        latestAccrual={latestAccrual}
        accrual5={accrual5}
        accrualDeltaReceivables={accrualDeltaReceivables}
        accrualDeltaInventory={accrualDeltaInventory}
        accrualDeltaPayables={accrualDeltaPayables}
        accrualWorkingCapitalProxy={accrualWorkingCapitalProxy}
        accrualDeltaOtherOA={accrualDeltaOtherOA}
        accrualDeltaOtherOL={accrualDeltaOtherOL}
        accrualOtherProxy={accrualOtherProxy}
        accrualTotalProxy={accrualTotalProxy}
        cumulativeDirtySurplus={cumulativeDirtySurplus}
        v3Bundle={v3Bundle}
      />

      <AccrualTimeSeriesSection
        accrualSeries={accrualSeries}
        data={data}
      />

      <OperatingTrajectorySection ratioTimeline={ratioTimeline} />

      <ValuationSynthesisSection
        ke={ke}
        kw={kw}
        kwMedian={kwMedian}
        config={config}
        gBase={gBase}
        valuation={valuation}
        reoiIdentityGap={reoiIdentityGap}
        reoiIdentityGapPct={reoiIdentityGapPct}
        v3Bundle={v3Bundle}
        valuationLegacyKw={valuationLegacyKw}
        explicitHorizonYears={explicitHorizonYears}
        tvShare={tvShare}
        tvGrade={tvGrade}
        eq16ResidualPp={eq16ResidualPp}
        eq16Tier={eq16Tier}
        v3TerminalAnchor={v3TerminalAnchor}
        data={data}
        g={g}
        gInput={gInput}
        bindingGCap={bindingGCap}
        tvContaminated={tvContaminated}
        latest={latest}
      />

      <SensitivityMatrixSection
        sensitivityG={sensitivityG}
        sensitivityMatrix={sensitivityMatrix}
        v3TerminalAnchor={v3TerminalAnchor}
      />

      <ResidualIncomeStreamSection
        valuation={valuation}
        periodDiagnostics={periodDiagnostics}
      />


      <TerminalSensitivitySection
        tvContaminated={tvContaminated}
        anchorTable={anchorTable}
        v3TerminalAnchor={v3TerminalAnchor}
        primaryValuation={primaryValuation}
        valuation={valuation}
      />

      <Section6BPanel
        local6B={local6B}
        v3Bundle={v3Bundle}
      />

      <QualityScoreSection
        latest={latest}
        dilutionRecent={dilutionRecent}
      />

      <InvestmentInterpretationSection
        companyId={companyId}
        latest={latest}
        v3Bundle={v3Bundle}
        dividendCashGap={dividendCashGap}
        faRunwayYears={faRunwayYears}
        latestRe={latestRe}
      />
      </div>
    </div>
  );
}
