import type { CapitalineParseDebug } from "../capitalineParser";
import { CONCEPT_ONTOLOGY } from "../conceptOntology";
import type { RawPeriodData } from "../types";
import type {
  AccountingStandard,
  FactScope,
  FactStatement,
  Sha256Id,
  SourceArtifact,
  SourceMode,
} from "./contracts";
import type {
  LegacyConceptMapping,
  LegacyMetricOrigin,
  LegacyPeriodSource,
} from "./legacyRawAdapter";

export const CANONICAL_SOURCE_ADAPTER_VERSION = "2026-07-canonical-source-adapter-v1" as const;

export interface CanonicalFactIngestionBundle {
  readonly sourceArtifacts: readonly SourceArtifact[];
  readonly periodSources: Readonly<Record<string, LegacyPeriodSource>>;
  readonly conceptMappings: readonly LegacyConceptMapping[];
}

const STATEMENT_BY_ONTOLOGY = {
  BalanceSheet: "BS",
  ProfitLoss: "IS",
  CashFlow: "CF",
} as const satisfies Readonly<Record<string, FactStatement>>;

function annualDurationStart(periodEnd: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (!match) return null;
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(end.getTime())) return null;
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString().slice(0, 10);
}

function accountingStandard(raw: RawPeriodData): AccountingStandard {
  return raw.accounting_standard ?? "unknown";
}

function candidateRawKey(
  raw: RawPeriodData,
  aliases: readonly string[],
  statement: "BalanceSheet" | "ProfitLoss" | "CashFlow",
): string | null {
  const keys = Object.keys(raw.raw_metric_values);
  const exact = new Map(keys.map((key) => [key.toLocaleLowerCase(), key]));
  for (const alias of aliases) {
    const composite = exact.get(`${alias}__${statement}`.toLocaleLowerCase());
    if (composite && Number.isFinite(raw.raw_metric_values[composite])) return composite;
  }
  for (const alias of aliases) {
    const base = exact.get(alias.toLocaleLowerCase());
    if (base && Number.isFinite(raw.raw_metric_values[base])) return base;
  }
  return null;
}

/** Build only ontology-backed, explicitly selected mappings. */
export function buildOntologyConceptMappings(
  rawData: readonly RawPeriodData[],
): readonly LegacyConceptMapping[] {
  const grouped = new Map<string, { mapping: Omit<LegacyConceptMapping, "periodEnds">; periods: string[] }>();
  for (const raw of rawData) {
    for (const concept of CONCEPT_ONTOLOGY) {
      if (concept.statement === "Derived" || concept.id === "shares") continue;
      const rawLabel = candidateRawKey(raw, concept.aliases, concept.statement);
      if (!rawLabel) continue;
      const statement = STATEMENT_BY_ONTOLOGY[concept.statement];
      const mapping = {
        rawLabel,
        conceptId: concept.id,
        statement,
        periodKind: statement === "BS" ? "instant" as const : "duration" as const,
        normalizedUnit: "INR_CRORE" as const,
        storedScale: "crore" as const,
        currency: "INR",
      };
      const key = `${mapping.rawLabel}\u0000${mapping.conceptId}\u0000${mapping.statement}`;
      const existing = grouped.get(key) ?? { mapping, periods: [] };
      existing.periods.push(raw.period_end);
      grouped.set(key, existing);
    }
  }
  return Object.freeze([...grouped.values()].map(({ mapping, periods }) => Object.freeze({
    ...mapping,
    periodEnds: Object.freeze([...new Set(periods)].sort()),
  })));
}

function mediaTypeForFile(fileName: string): string {
  if (/\.csv$/i.test(fileName)) return "text/csv";
  if (/\.xml$/i.test(fileName)) return "application/xml";
  if (/\.html?$/i.test(fileName)) return "text/html";
  if (/\.xls[xm]?$/i.test(fileName)) return "application/vnd.ms-excel";
  if (/\.json$/i.test(fileName)) return "application/json";
  return "text/plain";
}

function artifactFromCapitalineHash(args: {
  readonly hash: CapitalineParseDebug["sourceArtifactHashes"][number];
  readonly issuerId: string;
  readonly scope: FactScope;
  readonly contentClass: string;
}): SourceArtifact {
  return {
    artifactId: `sha256:${args.hash.sha256}` as Sha256Id,
    fileName: args.hash.fileName,
    mediaType: mediaTypeForFile(args.hash.fileName),
    byteLength: args.hash.byteLength,
    sourceMode: "capitaline",
    acquiredAt: null,
    filingAsOf: null,
    issuerId: args.issuerId,
    scope: args.scope,
    parserVersion: CANONICAL_SOURCE_ADAPTER_VERSION,
    contentClass: args.contentClass,
  };
}

export function buildCapitalineCanonicalFactBundle(args: {
  readonly rawData: readonly RawPeriodData[];
  readonly debug: CapitalineParseDebug;
  readonly scope: FactScope;
  readonly contentClass: string;
}): CanonicalFactIngestionBundle | null {
  const issuerId = args.rawData[0]?.company_id ?? args.debug.companyId;
  const sourceArtifacts = args.debug.sourceArtifactHashes.map((hash) => artifactFromCapitalineHash({
    hash,
    issuerId,
    scope: args.scope,
    contentClass: args.contentClass,
  }));
  if (!sourceArtifacts.length || !args.debug.factOrigins) return null;
  const artifactByFile = new Map(sourceArtifacts.map((artifact) => [artifact.fileName.toLocaleLowerCase(), artifact]));
  const periodSources: Record<string, LegacyPeriodSource> = {};
  for (const raw of args.rawData) {
    const origins = args.debug.factOrigins[raw.period_end] ?? {};
    const metricOrigins: Record<string, LegacyMetricOrigin> = {};
    for (const [rawLabel, origin] of Object.entries(origins)) {
      const artifact = artifactByFile.get(origin.fileName.toLocaleLowerCase());
      if (!artifact) continue;
      metricOrigins[rawLabel] = {
        artifactId: artifact.artifactId,
        parserMethod: `capitaline:${origin.parserMethod}`,
        sheet: null,
        row: origin.row,
        column: origin.column,
        cellRange: null,
        xbrlContextId: null,
      };
    }
    const firstOrigin = Object.values(metricOrigins)[0];
    periodSources[raw.period_end] = firstOrigin
      ? {
          kind: "reported",
          artifactId: firstOrigin.artifactId,
          filingVersion: "original",
          scope: args.scope,
          accountingStandard: accountingStandard(raw),
          durationStart: annualDurationStart(raw.period_end),
          metricOrigins,
        }
      : { kind: "source-unavailable", reason: "No file/cell origin survived parser precedence for this period." };
  }
  return {
    sourceArtifacts: Object.freeze(sourceArtifacts),
    periodSources: Object.freeze(periodSources),
    conceptMappings: buildOntologyConceptMappings(args.rawData),
  };
}

async function sha256Text(text: string): Promise<Sha256Id> {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto SHA-256 is required for source artifact identity.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** Source-level adapter for Screener, JSON, XBRL, and manual payloads. */
export async function buildTextCanonicalFactBundle(args: {
  readonly rawData: readonly RawPeriodData[];
  readonly sourceText: string;
  readonly sourceMode: Exclude<SourceMode, "capitaline" | "sidecar">;
  readonly fileName: string;
  readonly scope: FactScope;
  readonly contentClass: string;
  readonly enteredBy?: string | null | undefined;
}): Promise<CanonicalFactIngestionBundle | null> {
  const issuerId = args.rawData[0]?.company_id;
  if (!issuerId || !args.rawData.length || !args.sourceText.length) return null;
  const artifactId = await sha256Text(args.sourceText);
  const artifact: SourceArtifact = {
    artifactId,
    fileName: args.fileName,
    mediaType: mediaTypeForFile(args.fileName),
    byteLength: new TextEncoder().encode(args.sourceText).byteLength,
    sourceMode: args.sourceMode,
    acquiredAt: null,
    filingAsOf: null,
    issuerId,
    scope: args.scope,
    parserVersion: CANONICAL_SOURCE_ADAPTER_VERSION,
    contentClass: args.contentClass,
  };
  const periodSources = Object.fromEntries(args.rawData.map((raw) => [raw.period_end, {
    kind: args.sourceMode === "manual" ? "manual" as const : "reported" as const,
    artifactId,
    filingVersion: "original",
    scope: args.scope,
    accountingStandard: accountingStandard(raw),
    durationStart: annualDurationStart(raw.period_end),
    enteredBy: args.enteredBy ?? null,
  }]));
  return {
    sourceArtifacts: Object.freeze([artifact]),
    periodSources: Object.freeze(periodSources),
    conceptMappings: buildOntologyConceptMappings(args.rawData),
  };
}
