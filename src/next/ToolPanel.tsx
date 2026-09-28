/**
 * The Record and Lab tools, rendered on a company's shared run. Its own chunk,
 * and each panel lazy within it: the report pulls in exceljs, jspdf and KaTeX,
 * which a Case visit never loads (docs/ui-revamp-plan.md, bundle budget).
 */
import { lazy, useMemo } from "react";
import type { TabId } from "../app/tabs";
import type { CompanyRegistry } from "../engine/types";
import type { CompanyRunState } from "./companyRun";
import { buildToolInputs, type ToolInputs } from "./toolInputs";
import { Withheld } from "./ui/Withheld";

const AcademicReport = lazy(() => import("../components/AcademicReport"));
const FinancialInstitutionReport = lazy(() => import("../components/FinancialInstitutionReport"));
const InvestmentThesis = lazy(() => import("../components/InvestmentThesis"));
const RegressionReport = lazy(() => import("../components/RegressionReport"));
const V3AnalyticsPanel = lazy(() => import("../components/V3AnalyticsPanel"));
const DebugPanel = lazy(() => import("../components/DebugPanel"));
const RunInspector = lazy(() => import("../components/RunInspector"));
const DesignSystemShowcase = lazy(() => import("../components/design/DesignSystemShowcase"));
const ChartGallery = lazy(() => import("../components/design/ChartGallery"));

type ReadyRun = Extract<CompanyRunState, { status: "ready" }>;

export function ToolPanel({ tab, run, sessionRegistry }: {
  tab: TabId;
  /** The chosen company's run; null when no company is chosen. */
  run: ReadyRun | null;
  /** Companies analysed this session (the Regression tool's "loaded in session"). */
  sessionRegistry: CompanyRegistry;
}) {
  const inputs = useMemo(() => (run ? buildToolInputs(run.result, run.debug ?? null) : null), [run]);

  // Tools that need no company.
  switch (tab) {
    case "design":
      return import.meta.env.DEV ? <DesignSystemShowcase /> : <Withheld reason="The design system checklist is in development builds only." />;
    case "charts":
      return import.meta.env.DEV ? <ChartGallery /> : <Withheld reason="The chart gallery is in development builds only." />;
    case "inspector":
      return <RunInspector auditMeta={null} analysisStatus={inputs?.analysisStatus ?? null} />;
    default:
      break;
  }

  if (!inputs) return <Withheld reason="Choose a company first — this tool works on one company's data." />;
  const { recastData, pipelineResult, traceability, publication, config } = inputs;
  const itServices = pipelineResult?.itServices ?? null;
  const noRecast = <Withheld reason={noRecastReason(inputs)} />;

  switch (tab) {
    case "report":
      if (recastData) {
        return (
          <AcademicReport
            data={recastData}
            config={config}
            rawData={inputs.rawData}
            auditMeta={null}
            traceability={traceability}
            publication={publication}
            ratioSanity={pipelineResult?.ratioSanity ?? null}
            itServices={itServices}
          />
        );
      }
      if (pipelineResult?.bankResult) {
        return (
          <FinancialInstitutionReport
            bankResult={pipelineResult.bankResult}
            config={config}
            companyId={inputs.companyId}
            auditRunId={null}
            marketCapCr={null}
            nbfcSidecar={null}
          />
        );
      }
      return noRecast;
    case "thesis":
      return recastData ? <InvestmentThesis data={recastData} config={config} itServices={itServices} /> : noRecast;
    case "regression":
      return recastData
        ? (
          <RegressionReport
            rawData={inputs.rawData}
            recastData={recastData}
            config={config}
            registry={sessionRegistry}
            traceability={traceability}
            traceabilitySummary={publication?.traceabilitySummary ?? null}
          />
        )
        : noRecast;
    case "v3analytics":
      return recastData
        ? <V3AnalyticsPanel data={recastData} config={config} traceability={traceability} traceabilitySummary={publication?.traceabilitySummary ?? null} itServices={itServices} />
        : noRecast;
    case "debug":
      return (
        <DebugPanel
          debugInfo={inputs.debugInfo}
          recastData={recastData}
          rawData={inputs.rawData}
          qualityGate={inputs.qualityGate}
          engineError={inputs.engineError}
          greenfield={pipelineResult?.greenfield ?? null}
        />
      );
    default:
      return <Withheld reason="This tool does not live in the Record or the Lab." />;
  }
}

export function noRecastReason(inputs: Pick<ToolInputs, "engineError" | "pipelineResult">): string {
  if (inputs.engineError) return `The analysis failed: ${inputs.engineError}`;
  if (inputs.pipelineResult?.analysisFamily === "financial-institution") {
    return "This tool reads the industrial reformulation, which banks, NBFCs and insurers do not have.";
  }
  return "The analysis produced no reformulated statements.";
}
