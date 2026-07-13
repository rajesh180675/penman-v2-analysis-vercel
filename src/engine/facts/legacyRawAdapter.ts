import { reproducibilityHash } from "../../lib/evidenceLocking";
import type { RawPeriodData } from "../types";
import { FACT_SET_SCHEMA_VERSION, type CanonicalFact, type FactPeriodKind, type FactSet, type FactStatement, type NumericFactUnit, type OriginLocator, type Sha256Id, type SourceArtifact, type SourceNumericScale } from "./contracts";
import { createFactSet } from "./factory";

export interface LegacyConceptMapping {
  readonly rawLabel: string;
  readonly conceptId: string;
  readonly statement: FactStatement;
  readonly periodKind: FactPeriodKind;
  readonly normalizedUnit: NumericFactUnit;
  /** Scale of the value as stored in RawPeriodData, after parser normalization. */
  readonly storedScale: SourceNumericScale;
  readonly currency: string | null;
  /** Optional exact applicability used when source labels change by vintage. */
  readonly periodEnds?: readonly string[] | undefined;
}

export interface LegacyMetricOrigin extends Partial<OriginLocator> {
  readonly artifactId: Sha256Id;
  readonly parserMethod?: string | undefined;
}

export type LegacyPeriodSource =
  | {
      readonly kind: "reported" | "manual";
      readonly artifactId: Sha256Id;
      readonly filingVersion: string;
      readonly scope: CanonicalFact["scope"];
      readonly accountingStandard: CanonicalFact["accountingStandard"];
      readonly durationStart: string | null;
      readonly locators?: Readonly<Record<string, Partial<OriginLocator>>> | undefined;
      /** Per-metric artifact/cell ownership for multi-file filings. */
      readonly metricOrigins?: Readonly<Record<string, LegacyMetricOrigin>> | undefined;
      readonly enteredBy?: string | null | undefined;
    }
  | {
      readonly kind: "source-unavailable";
      readonly reason: string;
    };

export interface LegacyUnitTrace {
  readonly period: string;
  readonly originalCurrencyUnit: RawPeriodData["currency_unit"] | "Crores";
  readonly upstreamMultiplierToCrore: number | null;
  readonly status: "declared" | "legacy-default" | "unknown";
}

export interface LegacyFactAdapterDiagnostic {
  readonly code:
    | "SOURCE_UNAVAILABLE"
    | "SOURCE_ARTIFACT_MISSING"
    | "METRIC_ORIGIN_MISSING"
    | "DURATION_START_MISSING"
    | "NO_MAPPED_FACTS"
    | "FACT_SET_VALIDATION_FAILED";
  readonly period: string | null;
  readonly rawLabel: string | null;
  readonly severity: "warning" | "blocker";
  readonly message: string;
}

export type LegacyFactAdapterResult =
  | {
      readonly status: "created";
      readonly factSet: FactSet;
      readonly diagnostics: readonly LegacyFactAdapterDiagnostic[];
      readonly unitTrace: readonly LegacyUnitTrace[];
    }
  | {
      readonly status: "blocked";
      readonly factSet: null;
      readonly diagnostics: readonly LegacyFactAdapterDiagnostic[];
      readonly unitTrace: readonly LegacyUnitTrace[];
    };

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError("Canonical facts require finite numeric values.");
  if (Object.is(value, -0)) return "0";
  const raw = value.toString();
  if (!/[eE]/.test(raw)) return raw;
  return value.toFixed(15).replace(/0+$/, "").replace(/\.$/, "");
}

function fullLocator(locator?: Partial<OriginLocator>): OriginLocator {
  return {
    sheet: locator?.sheet ?? null,
    row: locator?.row ?? null,
    column: locator?.column ?? null,
    cellRange: locator?.cellRange ?? null,
    xbrlContextId: locator?.xbrlContextId ?? null,
  };
}

function upstreamMultiplier(unit: RawPeriodData["currency_unit"] | undefined): number | null {
  if (unit == null || unit === "Crores") return 1;
  if (unit === "Lakhs") return 0.01;
  if (unit === "Millions") return 0.1;
  if (unit === "Thousands") return 0.0001;
  if (unit === "Absolute") return 0.0000001;
  return null;
}

async function buildFact(args: {
  raw: RawPeriodData;
  value: number;
  mapping: LegacyConceptMapping;
  source: Exclude<LegacyPeriodSource, { kind: "source-unavailable" }>;
}): Promise<CanonicalFact> {
  const metricOrigin = args.source.metricOrigins?.[args.mapping.rawLabel];
  const effectiveLocator = fullLocator(metricOrigin ?? args.source.locators?.[args.mapping.rawLabel]);
  const period = {
    start: args.mapping.periodKind === "duration" ? args.source.durationStart : null,
    end: args.raw.period_end,
    kind: args.mapping.periodKind,
    frequency: "annual" as const,
  };
  const common = {
    issuerId: args.raw.company_id,
    conceptId: args.mapping.conceptId,
    rawLabel: args.mapping.rawLabel,
    statement: args.mapping.statement,
    period,
    value: {
      kind: "numeric" as const,
      decimal: decimal(args.value),
      currency: args.mapping.currency,
      sourceScale: args.mapping.storedScale,
      normalizedUnit: args.mapping.normalizedUnit,
    },
    scope: args.source.scope,
    dimensions: {},
    accountingStandard: args.source.accountingStandard,
    filingVersion: args.source.filingVersion,
  };
  const digest = await reproducibilityHash(common as unknown as Record<string, unknown>);
  const factId = `fact:${digest}`;
  if (args.source.kind === "manual") {
    return {
      ...common,
      factId,
      factKind: "manual",
      confidence: "manual",
      origin: {
        kind: "manual",
        artifactId: metricOrigin?.artifactId ?? args.source.artifactId,
        parserMethod: "manual",
        entryRef: null,
        enteredBy: args.source.enteredBy ?? null,
        ...effectiveLocator,
      },
    };
  }
  return {
    ...common,
    factId,
    factKind: "reported",
    confidence: "mapped",
    origin: {
      kind: "reported",
      artifactId: metricOrigin?.artifactId ?? args.source.artifactId,
      parserMethod: metricOrigin?.parserMethod ?? "legacy-raw-explicit-map-v1",
      ...effectiveLocator,
    },
  };
}

export async function adaptLegacyRawPeriodsToFactSet(input: {
  readonly rawData: readonly RawPeriodData[];
  readonly sourceArtifacts: readonly SourceArtifact[];
  readonly periodSources: Readonly<Record<string, LegacyPeriodSource>>;
  readonly conceptMappings: readonly LegacyConceptMapping[];
}): Promise<LegacyFactAdapterResult> {
  const diagnostics: LegacyFactAdapterDiagnostic[] = [];
  const facts: CanonicalFact[] = [];
  const artifactIds = new Set(input.sourceArtifacts.map((artifact) => artifact.artifactId));
  const mappings = new Map<string, LegacyConceptMapping[]>();
  for (const mapping of input.conceptMappings) {
    const entries = mappings.get(mapping.rawLabel) ?? [];
    entries.push(mapping);
    mappings.set(mapping.rawLabel, entries);
  }
  const unitTrace = input.rawData.map((raw): LegacyUnitTrace => ({
    period: raw.period_end,
    originalCurrencyUnit: raw.currency_unit ?? "Crores",
    upstreamMultiplierToCrore: upstreamMultiplier(raw.currency_unit),
    status: raw.currency_unit == null ? "legacy-default" : raw.currency_unit === "Unknown" ? "unknown" : "declared",
  }));

  for (const raw of input.rawData) {
    const source = input.periodSources[raw.period_end];
    if (!source) {
      diagnostics.push({
        code: "SOURCE_UNAVAILABLE",
        period: raw.period_end,
        rawLabel: null,
        severity: "blocker",
        message: "No source declaration was supplied for this period.",
      });
      continue;
    }
    if (source.kind === "source-unavailable") {
      diagnostics.push({
        code: "SOURCE_UNAVAILABLE",
        period: raw.period_end,
        rawLabel: null,
        severity: "blocker",
        message: source.reason,
      });
      continue;
    }
    if (!artifactIds.has(source.artifactId)) {
      diagnostics.push({
        code: "SOURCE_ARTIFACT_MISSING",
        period: raw.period_end,
        rawLabel: null,
        severity: "blocker",
        message: `Declared artifact ${source.artifactId} is absent from the adapter input.`,
      });
      continue;
    }
    for (const [rawLabel, rawValue] of Object.entries(raw.raw_metric_values)) {
      const mapping = mappings.get(rawLabel)?.find((candidate) =>
        candidate.periodEnds == null || candidate.periodEnds.includes(raw.period_end));
      if (!mapping || rawValue == null || !Number.isFinite(rawValue)) continue;
      const metricOrigin = source.metricOrigins?.[rawLabel];
      if (source.metricOrigins && !metricOrigin) {
        diagnostics.push({
          code: "METRIC_ORIGIN_MISSING",
          period: raw.period_end,
          rawLabel,
          severity: "blocker",
          message: "Mapped metric has no winning source-artifact coordinate.",
        });
        continue;
      }
      if (metricOrigin && !artifactIds.has(metricOrigin.artifactId)) {
        diagnostics.push({
          code: "SOURCE_ARTIFACT_MISSING",
          period: raw.period_end,
          rawLabel,
          severity: "blocker",
          message: `Metric origin artifact ${metricOrigin.artifactId} is absent from the adapter input.`,
        });
        continue;
      }
      if (mapping.periodKind === "duration" && !source.durationStart) {
        diagnostics.push({
          code: "DURATION_START_MISSING",
          period: raw.period_end,
          rawLabel,
          severity: "blocker",
          message: "Duration facts require an explicitly supplied start date.",
        });
        continue;
      }
      facts.push(await buildFact({ raw, value: rawValue, mapping, source }));
    }
  }

  if (facts.length === 0) {
    diagnostics.push({ code: "NO_MAPPED_FACTS", period: null, rawLabel: null, severity: "blocker", message: "No non-null raw values had an explicit concept mapping and usable source." });
    return { status: "blocked", factSet: null, diagnostics, unitTrace };
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "blocker")) {
    return { status: "blocked", factSet: null, diagnostics, unitTrace };
  }
  const created = await createFactSet({
    schemaVersion: FACT_SET_SCHEMA_VERSION,
    issuerId: input.rawData[0]?.company_id ?? input.sourceArtifacts[0]?.issuerId ?? "unavailable",
    sourceArtifacts: input.sourceArtifacts,
    facts,
  });
  if (created.ok === false) {
    diagnostics.push({
      code: "FACT_SET_VALIDATION_FAILED",
      period: null,
      rawLabel: null,
      severity: "blocker",
      message: created.errors.map((error) => `${error.path}: ${error.message}`).join("; "),
    });
    return { status: "blocked", factSet: null, diagnostics, unitTrace };
  }
  return { status: "created", factSet: created.value, diagnostics, unitTrace };
}
