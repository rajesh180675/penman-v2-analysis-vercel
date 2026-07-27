/**
 * @vitest-environment jsdom
 *
 * jsdom is load-bearing here, not incidental. `gridViaHtml` and
 * `gridViaSpreadsheetML` call `new DOMParser()` inside a bare
 * `try { } catch { return [] }`, so without a DOM the Capitaline parser does not
 * fail — it silently falls back to the regex grid strategy and extracts far less.
 * Measured on this TCS ZIP: 4407 unique metric keys under jsdom vs 475 under
 * node, 60425 non-null values vs 6499, with `periods.length === 15` either way.
 * The snapshot then comes in at 2.26 MB and the >10 MB budget assertion below
 * fails for a reason that has nothing to do with the transport code it guards.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveAnalysisStatus } from "../../engine/analysisStatus";
import { parseCapitalineZip } from "../../engine/capitalineParser";
import { auditMappingCoverage, evaluateQualityGate } from "../../engine/mappingAudit";
import { processCompanyDataFull } from "../../engine/pipeline";
import { DEFAULT_CONFIG, type EngineConfig } from "../../engine/types";
import { resolveValuationReadiness } from "../../engine/valuationPolicy";
import { buildAnalysisSnapshot } from "../auditSnapshot";
import {
  AUDIT_EVENT_PAYLOAD_BUDGET_BYTES,
  buildCompactAnalysisSnapshot,
  jsonUtf8Bytes,
  prepareAnalysisSnapshotTransport,
} from "../auditSnapshotTransport";

describe("real-company audit snapshot budget", () => {
  it("keeps the full TCS analysis snapshot event below the transport budget", async () => {
    const projectRoot = resolve(process.cwd());
    const folder = "Tata Consultancy Services Ltd";
    const zipPath = join(projectRoot, "public", "data", "companies", folder, `${folder}.zip`);
    const source = readFileSync(zipPath);
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const parsed = await parseCapitalineZip(bytes, { companyId: "TCS", filename: `${folder}.zip` });
    const config: EngineConfig = {
      ...DEFAULT_CONFIG,
      ticker: "TCS",
      company_type: "it-services",
      market_data_symbol: "TCS",
      quality_data_folder: folder,
    };
    const pipeline = processCompanyDataFull(parsed.periods, config);
    const mappingAudit = auditMappingCoverage(parsed.periods);
    const qualityGate = evaluateQualityGate(parsed.periods, config, pipeline.periods);
    const valuationReadiness = pipeline.periods.length ? resolveValuationReadiness(pipeline.periods) : null;
    const analysisStatus = deriveAnalysisStatus(qualityGate, valuationReadiness, mappingAudit);
    const snapshot = buildAnalysisSnapshot({
      rawData: parsed.periods,
      recastData: pipeline.periods,
      config,
      debugInfo: parsed.debug,
      parserDiagnostics: null,
      qualityGate,
      mappingAudit,
      engineError: null,
      analysisStatus,
      auditMeta: {
        runId: "audit-size-budget-tcs",
        companyId: "TCS",
        sourceMode: "capitaline",
        fileName: `${folder}.zip`,
        runAccessToken: "audit-size-budget-token",
        contentClass: "confidential-financial-statements",
        retentionDays: 45,
      },
    });
    const fullBytes = jsonUtf8Bytes(snapshot);
    const compact = buildCompactAnalysisSnapshot(snapshot, {
      filename: "analysis-snapshot-tcs.json.gz",
      contentType: "application/gzip",
      contentEncoding: "gzip",
      contentHash: "a".repeat(64),
      contentHashAlgorithm: "sha256",
      uncompressedBytes: fullBytes,
      storedBytes: 0,
      persisted: true,
      pathname: "audit/artifacts/audit-size-budget-tcs/analysis-snapshot-tcs.json.gz",
    });
    const compactBytes = jsonUtf8Bytes(compact);
    const prepared = await prepareAnalysisSnapshotTransport(snapshot);

    expect(parsed.periods).toHaveLength(15);
    expect(fullBytes).toBeGreaterThan(10 * 1024 * 1024);
    expect(compactBytes).toBeLessThanOrEqual(AUDIT_EVENT_PAYLOAD_BUDGET_BYTES);
    expect(prepared.descriptor.uncompressedBytes).toBe(fullBytes);
    expect(prepared.descriptor.contentHash).toMatch(/^(?:[a-f0-9]{64}|[a-f0-9]{8})$/);
    expect(prepared.descriptor.storedBytes).toBe(prepared.blob.size);
    expect(jsonUtf8Bytes(prepared.compactSnapshot)).toBeLessThanOrEqual(AUDIT_EVENT_PAYLOAD_BUDGET_BYTES);
  }, 120_000);
});
