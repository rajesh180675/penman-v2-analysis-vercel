/**
 * @vitest-environment jsdom
 *
 * The pin's original reason has expired, and it is kept for a different one.
 *
 * It was added because `gridViaHtml` swallowed the missing-DOMParser
 * ReferenceError and fell back to the regex grid, which extracted so much less
 * (475 metric keys vs 4407 on this TCS ZIP) that the snapshot came in at 2.26 MB
 * and the >10 MB assertion below failed for reasons unrelated to the transport
 * code it guards. The cleanCell fix closed that gap — node and jsdom now agree
 * exactly at 4407 keys / 60425 values — and this spec has been measured passing
 * under node with the pin removed.
 *
 * It stays because with a DOM this is the only place in CI where a real
 * multi-MB Capitaline export goes through the DOM grid strategy: node takes the
 * regex path, so dropping the pin would leave `gridViaHtml` exercised only
 * against synthetic fixtures, on the path every browser user actually runs.
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
