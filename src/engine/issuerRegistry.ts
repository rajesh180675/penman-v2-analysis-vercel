import { AnalysisStatusSummary } from "./analysisStatus";
import { EngineConfig, RawPeriodData } from "./types";

interface IssuerMasterRecordShape {
  issuerId: string;
  legalName: string;
  primaryTicker: string | null;
  exchange: string | null;
  sector: string | null;
  subSector: string | null;
  businessModel: string;
  supportStatus: "supported" | "guarded" | "unsupported";
  source: "workspace" | "audit" | "manual";
  lastRefreshedAt: string;
}

function inferExchange(symbol: string | null | undefined) {
  if (!symbol) return null;
  const normalized = symbol.toUpperCase();
  if (normalized.endsWith(".BSE")) return "BSE";
  if (normalized.endsWith(".NSE")) return "NSE";
  return "NSE/BSE";
}

function inferBusinessModel(config: EngineConfig, companyId: string) {
  const label = `${config.sector_template ?? ""} ${companyId}`.toLowerCase();
  if (label.includes("paint")) return "brand-led decorative and industrial coatings";
  if (label.includes("consumer") || label.includes("fmcg")) return "consumer staples with brand and distribution economics";
  if (label.includes("commodity")) return "price-taking, cycle-sensitive industrial commodity model";
  if (label.includes("industrial")) return "asset-backed industrial manufacturing and distribution";
  if (label.includes("retail")) return "retail and channel-scale consumer distribution";
  if (label.includes("service")) return "service-led model with human-capital intensity";
  if (label.includes("bank") || label.includes("nbfc") || label.includes("insurance")) return "financial institution balance-sheet intermediation";
  return "general listed operating company";
}

function supportStatusFromAnalysis(analysisStatus?: AnalysisStatusSummary | null): IssuerMasterRecordShape["supportStatus"] {
  if (analysisStatus?.status === "blocked") return "unsupported";
  if (analysisStatus?.status === "guarded") return "guarded";
  return "supported";
}

export function buildIssuerMasterRecord(args: {
  companyId: string;
  label?: string | null | undefined;
  rawData: RawPeriodData[] | null;
  config: EngineConfig;
  analysisStatus?: AnalysisStatusSummary | null | undefined;
  existing?: IssuerMasterRecordShape | null | undefined;
}): IssuerMasterRecordShape {
  const { companyId, label, rawData, config, analysisStatus, existing } = args;
  const primaryTicker = config.market_data_symbol ?? config.ticker ?? existing?.primaryTicker ?? null;
  const sector = config.sector_template ?? existing?.sector ?? null;

  return {
    issuerId: companyId,
    legalName: label || existing?.legalName || rawData?.[0]?.company_id || companyId,
    primaryTicker,
    exchange: inferExchange(primaryTicker) ?? existing?.exchange ?? null,
    sector,
    subSector: existing?.subSector ?? sector,
    businessModel: inferBusinessModel(config, companyId),
    supportStatus: supportStatusFromAnalysis(analysisStatus),
    source: existing ? existing.source : rawData?.length ? "audit" : "workspace",
    lastRefreshedAt: new Date().toISOString(),
  };
}
