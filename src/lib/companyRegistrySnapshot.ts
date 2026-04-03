import type { AnalysisTraceabilityEnvelope } from "../engine/analysisTraceability";
import { TRACEABILITY_SCHEMA_VERSION } from "../engine/policyVersions";
import { CompanyRegistry, MultiCompanyRecord } from "../engine/types";

export const COMPANY_REGISTRY_SNAPSHOT_SCHEMA_VERSION = "2026-04-comparison-registry-v1";

export interface CompanyRegistrySnapshot {
  schemaVersion: typeof COMPANY_REGISTRY_SNAPSHOT_SCHEMA_VERSION;
  storedAt: string | null;
  companies: Record<string, MultiCompanyRecord>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeTraceabilityEnvelope(value: unknown): AnalysisTraceabilityEnvelope | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== TRACEABILITY_SCHEMA_VERSION) return null;
  if (!("generatedAt" in value) || (value.generatedAt !== null && typeof value.generatedAt !== "string")) return null;
  if (!isRecord(value.runContext) || !isRecord(value.policyVersions) || !isRecord(value.confidence) || !isRecord(value.rigor)) return null;
  return value as unknown as AnalysisTraceabilityEnvelope;
}

export function sanitizeCompanyRecord(value: unknown): MultiCompanyRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  return {
    id: value.id,
    label: typeof value.label === "string" && value.label ? value.label : value.id,
    rawData: Array.isArray(value.rawData) ? value.rawData : [],
    recastData: Array.isArray(value.recastData) ? value.recastData : [],
    traceability: sanitizeTraceabilityEnvelope(value.traceability),
  };
}

function sanitizeCompaniesMap(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, MultiCompanyRecord>>((acc, [companyId, recordValue]) => {
    const record = sanitizeCompanyRecord(recordValue);
    if (!record) return acc;
    acc[companyId] = record.id === companyId ? record : { ...record, id: companyId };
    return acc;
  }, {});
}

export function readCompanyRegistrySnapshot(value: unknown): CompanyRegistry {
  if (!isRecord(value)) return { companies: {} };
  if ("schemaVersion" in value && value.schemaVersion !== COMPANY_REGISTRY_SNAPSHOT_SCHEMA_VERSION) {
    return { companies: {} };
  }
  return {
    companies: sanitizeCompaniesMap(value.companies),
  };
}

export function buildCompanyRegistrySnapshot(registry: CompanyRegistry, storedAt = new Date().toISOString()): CompanyRegistrySnapshot {
  return {
    schemaVersion: COMPANY_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    storedAt,
    companies: registry.companies,
  };
}

function compareIsoTimestamps(left: string | null | undefined, right: string | null | undefined) {
  const leftValue = typeof left === "string" ? left : "";
  const rightValue = typeof right === "string" ? right : "";
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
}

function mergeCompanyRecord(current: MultiCompanyRecord, incoming: MultiCompanyRecord): MultiCompanyRecord {
  const preferredTraceability =
    compareIsoTimestamps(incoming.traceability?.generatedAt, current.traceability?.generatedAt) >= 0
      ? incoming.traceability ?? current.traceability ?? null
      : current.traceability ?? incoming.traceability ?? null;

  return {
    id: incoming.id || current.id,
    label: incoming.label || current.label || incoming.id || current.id,
    rawData: incoming.rawData.length >= current.rawData.length ? incoming.rawData : current.rawData,
    recastData: incoming.recastData.length >= current.recastData.length ? incoming.recastData : current.recastData,
    traceability: preferredTraceability,
  };
}

export function mergeCompanyRegistries(current: CompanyRegistry, incoming: CompanyRegistry): CompanyRegistry {
  const nextCompanies = { ...current.companies };
  for (const [companyId, incomingRecord] of Object.entries(incoming.companies)) {
    const currentRecord = nextCompanies[companyId];
    nextCompanies[companyId] = currentRecord ? mergeCompanyRecord(currentRecord, incomingRecord) : incomingRecord;
  }
  return { companies: nextCompanies };
}
