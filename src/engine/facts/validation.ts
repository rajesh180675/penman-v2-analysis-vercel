import {
  FACT_SET_SCHEMA_VERSION,
  type AccountingStandard,
  type CanonicalFact,
  type ContractError,
  type ContractErrorCode,
  type FactFrequency,
  type FactScope,
  type FactSet,
  type FactSetContent,
  type FactStatement,
  type FailClosedResult,
  type NumericFactUnit,
  type Sha256Id,
  type SourceMode,
  type SourceNumericScale,
  type SourceArtifact,
  type ValidatedCanonicalFact,
  type ValidatedFactSet,
  type ValidatedFactSetContent,
  type ValidatedSourceArtifact,
} from "./contracts";
import {
  canonicalFactIdentityKey,
  canonicalizeCanonicalFact,
  sourceArtifactIdsForFact,
} from "./identity";

type UnknownRecord = Record<string, unknown>;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|-?[1-9][0-9]*)(?:\.[0-9]+)?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const INVENTED_LOCATORS = new Set(["-", "n/a", "na", "none", "null", "unknown", "unavailable"]);

const SOURCE_MODES = ["capitaline", "screener", "xbrl", "json", "manual", "sidecar"] as const;
const SCOPES = ["consolidated", "standalone", "segment", "unknown"] as const;
const STATEMENTS = ["BS", "IS", "CF", "OCI", "EQUITY", "SEGMENT", "MARKET"] as const;
const STANDARDS = ["ind-as", "ifrs", "revised-sch-vi", "standard", "unknown"] as const;
const PERIOD_KINDS = ["instant", "duration"] as const;
const FREQUENCIES = ["annual", "quarterly", "ttm", "unknown"] as const;
const SOURCE_SCALES = [
  "absolute",
  "thousand",
  "lakh",
  "million",
  "crore",
  "ratio",
  "count",
] as const;
const NUMERIC_UNITS = [
  "INR_ABSOLUTE",
  "INR_CRORE",
  "INR_PER_SHARE",
  "ABSOLUTE_SHARES",
  "CRORE_SHARES",
  "FRACTION",
  "RATIO",
  "COUNT",
] as const;

const UNIT_EXPECTATIONS: Readonly<
  Record<NumericFactUnit, { readonly sourceScales: readonly SourceNumericScale[]; readonly currency: "INR" | null }>
> = {
  INR_ABSOLUTE: { sourceScales: ["absolute", "thousand", "lakh", "million", "crore"], currency: "INR" },
  INR_CRORE: { sourceScales: ["absolute", "thousand", "lakh", "million", "crore"], currency: "INR" },
  INR_PER_SHARE: { sourceScales: ["absolute"], currency: "INR" },
  ABSOLUTE_SHARES: { sourceScales: ["absolute", "thousand", "lakh", "million", "crore"], currency: null },
  CRORE_SHARES: { sourceScales: ["absolute", "thousand", "lakh", "million", "crore"], currency: null },
  FRACTION: { sourceScales: ["ratio"], currency: null },
  RATIO: { sourceScales: ["ratio"], currency: null },
  COUNT: { sourceScales: ["count"], currency: null },
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function addError(
  errors: ContractError[],
  code: ContractErrorCode,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function checkShape(
  record: UnknownRecord,
  path: string,
  required: readonly string[],
  allowed: readonly string[],
  errors: ContractError[],
): void {
  for (const key of required) {
    if (!hasOwn(record, key)) {
      addError(errors, "missing-field", `${path}.${key}`, `Required field '${key}' is missing.`);
    }
  }
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      addError(errors, "unexpected-field", `${path}.${key}`, `Field '${key}' is not part of this schema.`);
    }
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: ContractError[],
): value is T {
  if (!isOneOf(value, allowed)) {
    addError(errors, "invalid-enum", path, `Expected one of: ${allowed.join(", ")}.`);
    return false;
  }
  return true;
}

function checkIdentifier(value: unknown, path: string, errors: ContractError[]): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    addError(errors, "invalid-identifier", path, "Expected a non-empty identifier without surrounding whitespace.");
    return false;
  }
  return true;
}

function checkNonEmptyString(value: unknown, path: string, errors: ContractError[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(errors, "invalid-type", path, "Expected a non-empty string.");
    return false;
  }
  return true;
}

function checkNullableString(value: unknown, path: string, errors: ContractError[]): void {
  if (value !== null && typeof value !== "string") {
    addError(errors, "invalid-type", path, "Expected a string or null.");
  }
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function checkDate(value: unknown, path: string, errors: ContractError[]): value is string {
  if (typeof value !== "string" || !isValidIsoDate(value)) {
    addError(errors, "invalid-date", path, "Expected a real calendar date in YYYY-MM-DD form.");
    return false;
  }
  return true;
}

function checkNullableDate(value: unknown, path: string, errors: ContractError[]): void {
  if (value !== null) checkDate(value, path, errors);
}

function checkNullableTimestamp(value: unknown, path: string, errors: ContractError[]): void {
  if (value === null) return;
  const fraction = typeof value === "string" ? /\.(\d{1,3})Z$/.exec(value)?.[1] ?? "" : "";
  const canonicalTimestamp =
    typeof value === "string"
      ? `${value.slice(0, 19)}.${fraction.padEnd(3, "0")}Z`
      : "";
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== canonicalTimestamp
  ) {
    addError(errors, "invalid-timestamp", path, "Expected a valid UTC timestamp ending in Z, or null.");
  }
}

function checkHash(value: unknown, path: string, errors: ContractError[]): value is Sha256Id {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    addError(errors, "invalid-hash", path, "Expected a lowercase, algorithm-prefixed SHA-256 id.");
    return false;
  }
  return true;
}

function validateSourceArtifactAt(
  input: unknown,
  path: string,
  errors: ContractError[],
): input is SourceArtifact {
  const start = errors.length;
  if (!isRecord(input)) {
    addError(errors, "invalid-type", path, "Expected a source artifact object.");
    return false;
  }
  const fields = [
    "artifactId",
    "fileName",
    "mediaType",
    "byteLength",
    "sourceMode",
    "acquiredAt",
    "filingAsOf",
    "issuerId",
    "scope",
    "parserVersion",
    "contentClass",
  ] as const;
  checkShape(input, path, fields, fields, errors);
  checkHash(input.artifactId, `${path}.artifactId`, errors);
  checkNonEmptyString(input.fileName, `${path}.fileName`, errors);
  if (!checkNonEmptyString(input.mediaType, `${path}.mediaType`, errors) || !String(input.mediaType).includes("/")) {
    if (typeof input.mediaType === "string" && !input.mediaType.includes("/")) {
      addError(errors, "invalid-type", `${path}.mediaType`, "Expected an IANA-style media type.");
    }
  }
  if (!Number.isInteger(input.byteLength) || typeof input.byteLength !== "number" || input.byteLength < 0) {
    addError(errors, "invalid-type", `${path}.byteLength`, "Expected a non-negative integer byte length.");
  }
  checkEnum<SourceMode>(input.sourceMode, SOURCE_MODES, `${path}.sourceMode`, errors);
  checkNullableTimestamp(input.acquiredAt, `${path}.acquiredAt`, errors);
  checkNullableDate(input.filingAsOf, `${path}.filingAsOf`, errors);
  checkIdentifier(input.issuerId, `${path}.issuerId`, errors);
  checkEnum<FactScope>(input.scope, SCOPES, `${path}.scope`, errors);
  checkIdentifier(input.parserVersion, `${path}.parserVersion`, errors);
  checkIdentifier(input.contentClass, `${path}.contentClass`, errors);
  return errors.length === start;
}

function validatePeriod(value: unknown, path: string, errors: ContractError[]): void {
  if (!isRecord(value)) {
    addError(errors, "invalid-type", path, "Expected a fact period object.");
    return;
  }
  const fields = ["start", "end", "kind", "frequency"] as const;
  checkShape(value, path, fields, fields, errors);
  const start = value.start;
  const end = value.end;
  const endValid = checkDate(end, `${path}.end`, errors);
  const kindValid = checkEnum(value.kind, PERIOD_KINDS, `${path}.kind`, errors);
  checkEnum<FactFrequency>(value.frequency, FREQUENCIES, `${path}.frequency`, errors);
  if (kindValid && value.kind === "instant" && value.start !== null) {
    addError(errors, "invalid-period", `${path}.start`, "Instant facts must use null for period.start.");
  }
  if (kindValid && value.kind === "duration") {
    const startValid = checkDate(start, `${path}.start`, errors);
    if (startValid && endValid && start > end) {
      addError(errors, "invalid-period", path, "Duration period.start must not follow period.end.");
    }
  } else if (!kindValid || value.kind !== "instant") {
    if (value.start !== null && typeof value.start !== "string") {
      addError(errors, "invalid-period", `${path}.start`, "Expected a date or null.");
    }
  }
}

function validateNumericValue(value: UnknownRecord, path: string, errors: ContractError[]): void {
  const fields = ["kind", "decimal", "currency", "sourceScale", "normalizedUnit"] as const;
  checkShape(value, path, fields, fields, errors);
  if (typeof value.decimal !== "string" || !DECIMAL_PATTERN.test(value.decimal) || value.decimal === "-0") {
    addError(errors, "invalid-decimal", `${path}.decimal`, "Expected a finite canonical decimal without exponent, separators, leading zeroes, or negative zero.");
  }
  const scaleValid = checkEnum<SourceNumericScale>(value.sourceScale, SOURCE_SCALES, `${path}.sourceScale`, errors);
  const normalizedUnit = value.normalizedUnit;
  const unitValid = checkEnum<NumericFactUnit>(normalizedUnit, NUMERIC_UNITS, `${path}.normalizedUnit`, errors);
  if (value.currency !== null && (typeof value.currency !== "string" || !CURRENCY_PATTERN.test(value.currency))) {
    addError(errors, "invalid-currency", `${path}.currency`, "Currency must be a three-letter uppercase code or null.");
  }
  if (unitValid) {
    const expected = UNIT_EXPECTATIONS[normalizedUnit];
    if (scaleValid && !expected.sourceScales.includes(value.sourceScale as SourceNumericScale)) {
      addError(errors, "invalid-unit", `${path}.sourceScale`, `${normalizedUnit} requires a compatible sourceScale (${expected.sourceScales.join(", ")}).`);
    }
    if (value.currency !== expected.currency) {
      addError(errors, "invalid-currency", `${path}.currency`, `${normalizedUnit} requires currency ${expected.currency === null ? "null" : `'${expected.currency}'`}.`);
    }
  }
}

function validateFactValue(value: unknown, path: string, errors: ContractError[]): void {
  if (!isRecord(value)) {
    addError(errors, "invalid-type", path, "Expected a canonical fact value object.");
    return;
  }
  if (value.kind === "numeric") {
    validateNumericValue(value, path, errors);
    return;
  }
  if (value.kind === "date") {
    const fields = ["kind", "date", "sourceText", "normalizedUnit"] as const;
    checkShape(value, path, fields, fields, errors);
    checkDate(value.date, `${path}.date`, errors);
    checkNullableString(value.sourceText, `${path}.sourceText`, errors);
    if (value.normalizedUnit !== "DATE") addError(errors, "invalid-unit", `${path}.normalizedUnit`, "Date facts require DATE.");
    return;
  }
  if (value.kind === "text") {
    const fields = ["kind", "text", "normalizedUnit"] as const;
    checkShape(value, path, fields, fields, errors);
    checkNonEmptyString(value.text, `${path}.text`, errors);
    if (value.normalizedUnit !== "TEXT") addError(errors, "invalid-unit", `${path}.normalizedUnit`, "Text facts require TEXT.");
    return;
  }
  if (value.kind === "boolean") {
    const fields = ["kind", "boolean", "sourceText", "normalizedUnit"] as const;
    checkShape(value, path, fields, fields, errors);
    if (typeof value.boolean !== "boolean") addError(errors, "invalid-type", `${path}.boolean`, "Expected a boolean.");
    checkNullableString(value.sourceText, `${path}.sourceText`, errors);
    if (value.normalizedUnit !== "BOOLEAN") addError(errors, "invalid-unit", `${path}.normalizedUnit`, "Boolean facts require BOOLEAN.");
    return;
  }
  addError(errors, "unsupported-value", `${path}.kind`, "Expected numeric, date, text, or boolean fact value.");
}

function validateDimensions(value: unknown, path: string, errors: ContractError[]): void {
  if (!isRecord(value)) {
    addError(errors, "invalid-dimension", path, "Expected a dimension object.");
    return;
  }
  for (const [key, dimension] of Object.entries(value)) {
    if (key.length === 0 || key.trim() !== key || typeof dimension !== "string" || dimension.length === 0 || dimension.trim() !== dimension) {
      addError(errors, "invalid-dimension", `${path}.${key}`, "Dimension names and values must be non-empty strings without surrounding whitespace.");
    }
  }
}

function validateLocatorText(value: unknown, path: string, errors: ContractError[]): void {
  if (value === null) return;
  if (typeof value !== "string" || value.trim().length === 0 || INVENTED_LOCATORS.has(value.trim().toLowerCase())) {
    addError(errors, "invalid-locator", path, "Use the exact source-native locator, or null when it was not captured.");
  }
}

function validateLocators(origin: UnknownRecord, path: string, errors: ContractError[]): void {
  validateLocatorText(origin.sheet, `${path}.sheet`, errors);
  for (const coordinate of ["row", "column"] as const) {
    const value = origin[coordinate];
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
      addError(errors, "invalid-locator", `${path}.${coordinate}`, "Use a one-based source coordinate, or null when unavailable.");
    }
  }
  validateLocatorText(origin.cellRange, `${path}.cellRange`, errors);
  validateLocatorText(origin.xbrlContextId, `${path}.xbrlContextId`, errors);
}

const LOCATOR_FIELDS = ["sheet", "row", "column", "cellRange", "xbrlContextId"] as const;

function validateOrigin(value: unknown, factKind: unknown, path: string, errors: ContractError[]): void {
  if (!isRecord(value)) {
    addError(errors, "missing-field", path, "Every fact requires explicit provenance.");
    return;
  }
  const common = ["kind", ...LOCATOR_FIELDS] as const;
  if (value.kind === "reported") {
    const fields = [...common, "artifactId", "parserMethod"] as const;
    checkShape(value, path, fields, fields, errors);
    checkHash(value.artifactId, `${path}.artifactId`, errors);
    if (checkIdentifier(value.parserMethod, `${path}.parserMethod`, errors) && (value.parserMethod === "manual" || value.parserMethod === "derived")) {
      addError(errors, "invalid-origin", `${path}.parserMethod`, "Reported provenance requires a source parser method.");
    }
  } else if (value.kind === "manual") {
    const fields = [...common, "artifactId", "parserMethod", "entryRef", "enteredBy"] as const;
    checkShape(value, path, fields, fields, errors);
    checkHash(value.artifactId, `${path}.artifactId`, errors);
    if (value.parserMethod !== "manual") addError(errors, "invalid-origin", `${path}.parserMethod`, "Manual facts require parserMethod 'manual'.");
    checkNullableString(value.entryRef, `${path}.entryRef`, errors);
    checkNullableString(value.enteredBy, `${path}.enteredBy`, errors);
  } else if (value.kind === "derived") {
    const fields = [...common, "sourceArtifactIds", "parserMethod", "transformationId", "formulaVersion", "inputFactIds"] as const;
    checkShape(value, path, fields, fields, errors);
    if (value.parserMethod !== "derived") addError(errors, "invalid-origin", `${path}.parserMethod`, "Derived facts require parserMethod 'derived'.");
    checkIdentifier(value.transformationId, `${path}.transformationId`, errors);
    checkIdentifier(value.formulaVersion, `${path}.formulaVersion`, errors);
    validateIdentifierArray(value.sourceArtifactIds, `${path}.sourceArtifactIds`, true, true, errors);
    validateIdentifierArray(value.inputFactIds, `${path}.inputFactIds`, true, false, errors);
  } else {
    addError(errors, "invalid-origin", `${path}.kind`, "Origin kind must be reported, manual, or derived.");
  }
  validateLocators(value, path, errors);
  if (typeof factKind === "string" && value.kind !== factKind) {
    addError(errors, "invalid-origin", `${path}.kind`, "origin.kind must match factKind.");
  }
}

function validateIdentifierArray(
  value: unknown,
  path: string,
  nonEmpty: boolean,
  hashes: boolean,
  errors: ContractError[],
): void {
  if (!Array.isArray(value)) {
    addError(errors, "invalid-type", path, "Expected an array.");
    return;
  }
  if (nonEmpty && value.length === 0) addError(errors, "invalid-origin", path, "At least one provenance reference is required.");
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const valid = hashes
      ? checkHash(entry, `${path}[${index}]`, errors)
      : checkIdentifier(entry, `${path}[${index}]`, errors);
    if (valid && seen.has(entry)) addError(errors, "invalid-origin", `${path}[${index}]`, "Provenance references must be unique.");
    if (valid) seen.add(entry);
  });
}

function validateCanonicalFactAt(
  input: unknown,
  path: string,
  errors: ContractError[],
): input is CanonicalFact {
  const start = errors.length;
  if (!isRecord(input)) {
    addError(errors, "invalid-type", path, "Expected a canonical fact object.");
    return false;
  }
  const fields = [
    "factId", "issuerId", "conceptId", "rawLabel", "statement", "period", "value",
    "scope", "dimensions", "accountingStandard", "filingVersion", "factKind", "confidence", "origin",
  ] as const;
  checkShape(input, path, fields, fields, errors);
  checkIdentifier(input.factId, `${path}.factId`, errors);
  checkIdentifier(input.issuerId, `${path}.issuerId`, errors);
  checkIdentifier(input.conceptId, `${path}.conceptId`, errors);
  checkNonEmptyString(input.rawLabel, `${path}.rawLabel`, errors);
  checkEnum<FactStatement>(input.statement, STATEMENTS, `${path}.statement`, errors);
  validatePeriod(input.period, `${path}.period`, errors);
  validateFactValue(input.value, `${path}.value`, errors);
  checkEnum<FactScope>(input.scope, SCOPES, `${path}.scope`, errors);
  validateDimensions(input.dimensions, `${path}.dimensions`, errors);
  checkEnum<AccountingStandard>(input.accountingStandard, STANDARDS, `${path}.accountingStandard`, errors);
  checkIdentifier(input.filingVersion, `${path}.filingVersion`, errors);
  if (!checkEnum(input.factKind, ["reported", "manual", "derived"] as const, `${path}.factKind`, errors)) {
    // The origin validator still records provenance errors independently.
  } else if (
    (input.factKind === "reported" && !isOneOf(input.confidence, ["exact", "mapped", "inferred"] as const)) ||
    (input.factKind === "manual" && input.confidence !== "manual") ||
    (input.factKind === "derived" && input.confidence !== "derived")
  ) {
    addError(errors, "invalid-origin", `${path}.confidence`, "confidence must match factKind.");
  }
  validateOrigin(input.origin, input.factKind, `${path}.origin`, errors);
  return errors.length === start;
}

function validateFactSetAt(
  input: unknown,
  requireId: boolean,
  errors: ContractError[],
): input is FactSetContent | FactSet {
  if (!isRecord(input)) {
    addError(errors, "invalid-type", "$", "Expected a fact-set object.");
    return false;
  }
  const contentFields = ["schemaVersion", "issuerId", "sourceArtifacts", "facts"] as const;
  const required = requireId ? [...contentFields, "factSetId"] : contentFields;
  checkShape(input, "$", required, required, errors);
  if (input.schemaVersion !== FACT_SET_SCHEMA_VERSION) {
    addError(errors, "invalid-enum", "$.schemaVersion", `Expected schemaVersion '${FACT_SET_SCHEMA_VERSION}'.`);
  }
  const issuerId = input.issuerId;
  const issuerValid = checkIdentifier(issuerId, "$.issuerId", errors);
  if (requireId) checkHash(input.factSetId, "$.factSetId", errors);

  const artifacts: SourceArtifact[] = [];
  if (!Array.isArray(input.sourceArtifacts)) {
    addError(errors, "invalid-type", "$.sourceArtifacts", "Expected an artifact array.");
  } else {
    input.sourceArtifacts.forEach((artifact, index) => {
      if (validateSourceArtifactAt(artifact, `$.sourceArtifacts[${index}]`, errors)) artifacts.push(artifact);
    });
  }

  const facts: CanonicalFact[] = [];
  if (!Array.isArray(input.facts)) {
    addError(errors, "invalid-type", "$.facts", "Expected a fact array.");
  } else {
    if (input.facts.length === 0) addError(errors, "empty-fact-set", "$.facts", "A canonical fact set cannot be empty.");
    input.facts.forEach((fact, index) => {
      if (validateCanonicalFactAt(fact, `$.facts[${index}]`, errors)) facts.push(fact);
    });
  }

  validateCrossReferences(issuerValid ? issuerId : null, artifacts, facts, errors);
  return errors.length === 0;
}

function validateCrossReferences(
  issuerId: string | null,
  artifacts: readonly SourceArtifact[],
  facts: readonly CanonicalFact[],
  errors: ContractError[],
): void {
  const artifactById = new Map<Sha256Id, { artifact: SourceArtifact; index: number }>();
  artifacts.forEach((artifact, index) => {
    const existing = artifactById.get(artifact.artifactId);
    if (existing) {
      addError(errors, "duplicate-artifact", `$.sourceArtifacts[${index}].artifactId`, `Duplicates artifact at index ${existing.index}.`);
    } else artifactById.set(artifact.artifactId, { artifact, index });
    if (issuerId !== null && artifact.issuerId !== issuerId) {
      addError(errors, "issuer-mismatch", `$.sourceArtifacts[${index}].issuerId`, "Artifact issuer must match FactSet issuer.");
    }
  });

  const factIndexById = new Map<string, number>();
  const factById = new Map<string, CanonicalFact>();
  const identityMap = new Map<string, { fact: CanonicalFact; index: number; payload: string }>();
  facts.forEach((fact, index) => {
    const priorId = factIndexById.get(fact.factId);
    if (priorId !== undefined) addError(errors, "duplicate-fact-id", `$.facts[${index}].factId`, `Duplicates factId at index ${priorId}.`);
    else {
      factIndexById.set(fact.factId, index);
      factById.set(fact.factId, fact);
    }
    if (issuerId !== null && fact.issuerId !== issuerId) {
      addError(errors, "issuer-mismatch", `$.facts[${index}].issuerId`, "Fact issuer must match FactSet issuer.");
    }
    const identity = canonicalFactIdentityKey(fact);
    const payload = canonicalizeCanonicalFact(fact);
    const existing = identityMap.get(identity);
    if (existing) {
      const samePayload = payload === existing.payload;
      addError(
        errors,
        samePayload ? "duplicate-fact-identity" : "conflicting-fact-identity",
        `$.facts[${index}]`,
        samePayload
          ? `Duplicates the complete fact identity at index ${existing.index}.`
          : `Conflicts with fact identity at index ${existing.index}; preserve a new filing/artifact identity instead of overwriting it.`,
      );
    } else identityMap.set(identity, { fact, index, payload });
  });

  facts.forEach((fact, index) => {
    for (const artifactId of sourceArtifactIdsForFact(fact)) {
      const artifact = artifactById.get(artifactId)?.artifact;
      if (!artifact) {
        addError(errors, "missing-artifact", `$.facts[${index}].origin`, `Referenced artifact '${artifactId}' is absent from this FactSet.`);
      } else if (fact.factKind === "manual" && artifact.sourceMode !== "manual") {
        addError(errors, "invalid-origin", `$.facts[${index}].origin.artifactId`, "Manual facts must reference a manual source artifact.");
      } else if (fact.factKind === "reported" && artifact.sourceMode === "manual") {
        addError(errors, "invalid-origin", `$.facts[${index}].origin.artifactId`, "Reported facts cannot reference a manual source artifact.");
      }
    }
    if (fact.origin.kind === "derived") {
      for (const inputId of fact.origin.inputFactIds) {
        if (!factById.has(inputId)) {
          addError(errors, "missing-input-fact", `$.facts[${index}].origin.inputFactIds`, `Derived input '${inputId}' is absent from this FactSet.`);
        }
      }
    }
  });
  validateDerivationGraph(facts, factIndexById, errors);
}

function validateDerivationGraph(
  facts: readonly CanonicalFact[],
  factIndexById: ReadonlyMap<string, number>,
  errors: ContractError[],
): void {
  const derivedInputs = new Map<string, readonly string[]>();
  for (const fact of facts) {
    if (fact.origin.kind === "derived") derivedInputs.set(fact.factId, fact.origin.inputFactIds);
  }
  const state = new Map<string, "visiting" | "visited">();
  const reportedCycles = new Set<string>();
  const visit = (factId: string): void => {
    if (state.get(factId) === "visited") return;
    if (state.get(factId) === "visiting") {
      if (!reportedCycles.has(factId)) {
        reportedCycles.add(factId);
        const index = factIndexById.get(factId);
        addError(errors, "cyclic-derivation", index === undefined ? "$.facts" : `$.facts[${index}].origin.inputFactIds`, `Derived fact '${factId}' participates in a cycle.`);
      }
      return;
    }
    state.set(factId, "visiting");
    for (const inputId of derivedInputs.get(factId) ?? []) {
      if (derivedInputs.has(inputId)) visit(inputId);
    }
    state.set(factId, "visited");
  };
  for (const factId of derivedInputs.keys()) visit(factId);
}

function failure<T>(errors: ContractError[]): FailClosedResult<T> {
  return { ok: false, errors: errors as [ContractError, ...ContractError[]] };
}

export function validateSourceArtifact(input: unknown): FailClosedResult<ValidatedSourceArtifact> {
  const errors: ContractError[] = [];
  if (!validateSourceArtifactAt(input, "$", errors)) return failure(errors);
  return { ok: true, value: input as ValidatedSourceArtifact };
}

export function validateCanonicalFact(input: unknown): FailClosedResult<ValidatedCanonicalFact> {
  const errors: ContractError[] = [];
  if (!validateCanonicalFactAt(input, "$", errors)) return failure(errors);
  return { ok: true, value: input as ValidatedCanonicalFact };
}

export function validateFactSetContent(input: unknown): FailClosedResult<ValidatedFactSetContent> {
  const errors: ContractError[] = [];
  if (!validateFactSetAt(input, false, errors)) return failure(errors);
  return { ok: true, value: input as ValidatedFactSetContent };
}

/** Structural and relational validation; call verifyFactSetIdentity for hash verification. */
export function validateFactSet(input: unknown): FailClosedResult<ValidatedFactSet> {
  const errors: ContractError[] = [];
  if (!validateFactSetAt(input, true, errors)) return failure(errors);
  return { ok: true, value: input as ValidatedFactSet };
}
