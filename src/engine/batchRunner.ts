/* ================================================================
   batchRunner.ts — Company-universe batch analysis

   Loads a list of companies from the library, runs each through the
   same pipeline used by the single-company UI, and returns a
   CompanyRegistry ready for Comparison / Watchlist surfaces.

   Design choices:
   - Sequential execution: large Capitaline ZIPs (ITC ~13 MB) are
     memory-heavy in jsdom; running many in parallel OOMs the tab.
   - Per-company isolation: one failure does not abort the batch.
   - Local-first: on localhost, always fetch from Vite-served public/
     files (never Vercel Blob) to avoid cache/timeout issues.
   - Trace-instrumented: every async step logs start/success/error.
================================================================ */

import type { RawPeriodData, RecastPeriod, EngineConfig, CompanyRegistry, MultiCompanyRecord } from "./types";
import type { CompanyType } from "./types/company";
import { parseCapitalineZip, CapitalineParseDebug } from "./capitalineParser";
import { processCompanyDataFull } from "./pipeline";
import { fetchBankQualityIndicators, type BankQualityIndicators } from "./bankQualityIndicators";
import { evaluateQualityGate, auditMappingCoverage } from "./mappingAudit";
import { resolveValuationReadiness } from "./valuationPolicy";
import { deriveAnalysisStatus } from "./analysisStatus";
import { buildAnalysisTraceability } from "./analysisTraceability";
import { getAnalysisPolicyVersions } from "./policyVersions";
import { trace } from "../lib/traceLogger";

const POLICY_VERSIONS = getAnalysisPolicyVersions();

export interface BatchCompanyInput {
  folder: string;
  name: string;
  ticker: string;
  type: CompanyType;
  sector?: string | null | undefined;
  hasStandalone?: boolean | undefined;
  blobUrl?: string | null | undefined;
  standaloneBlobUrl?: string | null | undefined;
  qualityIndicatorsBlobUrl?: string | null | undefined;
}

export interface BatchRunResult {
  registry: CompanyRegistry;
  errors: Record<string, string>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    byFamily: Record<string, number>;
  };
}

function encodePath(s: string): string {
  return encodeURIComponent(s).replace(/%26/g, "&");
}

function isLocalDev(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function isFinancialCompany(type: CompanyType): boolean {
  return type === "bank" || type === "nbfc" || type === "insurance";
}

async function fetchArrayBuffer(
  url: string,
  fetchImpl: typeof fetch,
  context: { companyId: string; kind: string },
): Promise<ArrayBuffer> {
  const t0 = performance.now();
  trace("pipeline", "fetch:start", { ...context, url });
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    trace("pipeline", "fetch:error", { ...context, url, error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
    throw new Error(`${context.kind} fetch failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (!res.ok) {
    trace("pipeline", "fetch:httpError", { ...context, url, status: res.status, statusText: res.statusText }, null, { level: "error" });
    throw new Error(`${context.kind} fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  trace("pipeline", "fetch:success", { ...context, url, bytes: buf.byteLength, duration_ms: Math.round(performance.now() - t0) });
  return buf;
}

function buildCompanyConfig(baseConfig: EngineConfig, input: BatchCompanyInput, qualityBlobUrl: string | null): EngineConfig {
  return {
    ...baseConfig,
    company_type: input.type,
    ticker: input.ticker,
    quality_data_folder: input.folder,
    quality_indicators_blob_url: qualityBlobUrl ?? undefined,
    market_data_symbol: input.ticker,
    market_data_provider: baseConfig.market_data_provider ?? "nse",
  };
}

async function loadQualitySidecar(
  input: BatchCompanyInput,
  fetchImpl: typeof fetch,
): Promise<BankQualityIndicators | null> {
  if (!isFinancialCompany(input.type)) return null;

  const preferLocal = isLocalDev();
  const blobUrl = input.qualityIndicatorsBlobUrl;
  const url = (!preferLocal && blobUrl) ? `${blobUrl}?v=${Date.now()}` : undefined;

  try {
    return await fetchBankQualityIndicators(input.folder, fetchImpl, url);
  } catch (err) {
    trace("pipeline", "qualitySidecar:error", { folder: input.folder, error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
    return null;
  }
}

function buildTraceability(
  input: BatchCompanyInput,
  rawData: RawPeriodData[],
  recastData: RecastPeriod[],
  config: EngineConfig,
  debug: CapitalineParseDebug,
  pipelineResult: ReturnType<typeof processCompanyDataFull>,
): import("./types/traceability").AnalysisTraceabilityEnvelope {
  const qualityGate = evaluateQualityGate(rawData, config, recastData);
  const mappingAudit = auditMappingCoverage(rawData);
  const valuationReadiness = recastData.length > 0 ? resolveValuationReadiness(recastData) : null;
  const analysisStatus = deriveAnalysisStatus(qualityGate, valuationReadiness, mappingAudit);
  const bankResult = pipelineResult.analysisFamily === "financial-institution" ? pipelineResult.bankResult : null;

  return buildAnalysisTraceability({
    companyId: input.folder,
    sourceMode: "capitaline",
    rawData,
    recastData,
    config,
    qualityGate,
    mappingAudit,
    analysisStatus,
    policyVersions: POLICY_VERSIONS,
    debugInfo: debug,
    bankMetrics: bankResult?.bankMetrics ?? null,
    bankSubtype: bankResult?.subtype ?? null,
  });
}

async function runOneCompany(
  input: BatchCompanyInput,
  baseConfig: EngineConfig,
  fetchImpl: typeof fetch,
): Promise<{ record: MultiCompanyRecord; family: string } | { error: string }> {
  const t0 = performance.now();
  trace("pipeline", "company:start", { folder: input.folder, type: input.type });

  try {
    const preferLocal = isLocalDev();
    const zipUrl = (!preferLocal && input.blobUrl)
      ? input.blobUrl
      : `/data/companies/${encodePath(input.folder)}/${encodePath(input.folder)}.zip`;

    const zipBuf = await fetchArrayBuffer(zipUrl, fetchImpl, { companyId: input.folder, kind: "consolidated-zip" });
    // Cache check: avoid re-parsing a multi-MB Capitaline ZIP we've already parsed.
    const { readCachedParse, writeCachedParse, sha256Hex } = await import("../lib/capitalineParseCache");
    const zipSha = await sha256Hex(zipBuf);
    let parseResult: { periods: RawPeriodData[]; debug: import("./capitalineParser").CapitalineParseDebug; segmentData: import("./segmentParser").AllSegmentData | null } | null = null;
    if (zipSha) {
      const cached = await readCachedParse(zipSha);
      if (cached) parseResult = { periods: cached.periods, debug: cached.debug, segmentData: cached.segmentData };
    }
    if (!parseResult) {
      parseResult = await parseCapitalineZip(zipBuf, { companyId: input.folder, filename: `${input.folder}.zip` });
      if (zipSha) {
        void writeCachedParse({
          zipSha256: zipSha,
          zipSize: zipBuf.byteLength,
          cachedAt: new Date().toISOString(),
          periods: parseResult.periods,
          debug: parseResult.debug,
          segmentData: parseResult.segmentData,
        });
      }
    }

    let standaloneRaw: RawPeriodData[] | null = null;
    if (input.hasStandalone) {
      const standaloneUrl = (!preferLocal && input.standaloneBlobUrl)
        ? input.standaloneBlobUrl
        : `/data/companies/${encodePath(input.folder)}/standalone.zip`;
      try {
        const standaloneBuf = await fetchArrayBuffer(standaloneUrl, fetchImpl, { companyId: input.folder, kind: "standalone-zip" });
        const standaloneSha = await sha256Hex(standaloneBuf);
        let standaloneResult: { periods: RawPeriodData[]; debug: import("./capitalineParser").CapitalineParseDebug; segmentData: import("./segmentParser").AllSegmentData | null } | null = null;
        if (standaloneSha) {
          const cached = await readCachedParse(standaloneSha);
          if (cached) standaloneResult = { periods: cached.periods, debug: cached.debug, segmentData: cached.segmentData };
        }
        if (!standaloneResult) {
          standaloneResult = await parseCapitalineZip(standaloneBuf, { companyId: `${input.folder}-standalone`, filename: "standalone.zip" });
          if (standaloneSha) {
            void writeCachedParse({
              zipSha256: standaloneSha,
              zipSize: standaloneBuf.byteLength,
              cachedAt: new Date().toISOString(),
              periods: standaloneResult.periods,
              debug: standaloneResult.debug,
              segmentData: standaloneResult.segmentData,
            });
          }
        }
        standaloneRaw = standaloneResult.periods;
      } catch (err) {
        trace("pipeline", "standalone:skipped", { folder: input.folder, error: String(err) }, null, { level: "warn" });
      }
    }

    const qualityBlobUrl = (!preferLocal && input.qualityIndicatorsBlobUrl) ? input.qualityIndicatorsBlobUrl : null;
    const config = buildCompanyConfig(baseConfig, input, qualityBlobUrl);
    const bankQuality = await loadQualitySidecar(input, fetchImpl);

    const rawData = parseResult.periods;
    const pipelineResult = processCompanyDataFull(rawData, config, bankQuality);
    const recastData = pipelineResult.periods ?? [];

    const traceability = buildTraceability(
      input,
      rawData,
      recastData,
      config,
      parseResult.debug,
      pipelineResult,
    );

    const record: MultiCompanyRecord = {
      id: input.folder,
      label: input.name,
      rawData: rawData,
      recastData: recastData,
      companyType: input.type,
      sector: input.sector ?? null,
      traceability,
    };

    if (standaloneRaw) {
      (record as unknown as { standaloneRawData?: RawPeriodData[] }).standaloneRawData = standaloneRaw;
    }

    trace("pipeline", "company:success", { folder: input.folder, family: pipelineResult.analysisFamily, periods: rawData.length, duration_ms: Math.round(performance.now() - t0) });
    return { record, family: pipelineResult.analysisFamily };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trace("pipeline", "company:error", { folder: input.folder, error: msg, stack: (err as Error)?.stack, duration_ms: Math.round(performance.now() - t0) }, null, { level: "error" });
    return { error: msg };
  }
}

/**
 * Run a batch of companies through the full analysis pipeline.
 *
 * @param inputs Library-style company descriptors (usually from registry.json).
 * @param baseConfig Shared EngineConfig used as a template (ke, kd, tax, etc.).
 * @param fetchImpl Optional fetch override (for tests or non-browser environments).
 */
export async function runBatchAnalysis(
  inputs: BatchCompanyInput[],
  baseConfig: EngineConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<BatchRunResult> {
  const t0 = performance.now();
  trace("pipeline", "runBatchAnalysis:start", { count: inputs.length });

  const registry: CompanyRegistry = { companies: {} };
  const errors: Record<string, string> = {};
  const byFamily: Record<string, number> = {};

  for (const input of inputs) {
    const result = await runOneCompany(input, baseConfig, fetchImpl);
    if ("error" in result) {
      errors[input.folder] = result.error;
    } else {
      registry.companies[result.record.id] = result.record;
      byFamily[result.family] = (byFamily[result.family] ?? 0) + 1;
    }
  }

  const summary = {
    total: inputs.length,
    succeeded: Object.keys(registry.companies).length,
    failed: Object.keys(errors).length,
    byFamily,
  };

  trace("pipeline", "runBatchAnalysis:complete", { ...summary, duration_ms: Math.round(performance.now() - t0) });
  return { registry, errors, summary };
}
