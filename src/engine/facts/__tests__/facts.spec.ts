import { describe, expect, it } from "vitest";
import {
  FACT_SET_SCHEMA_VERSION,
  canonicalizeFactSetContent,
  createFactSet,
  factSetContentRef,
  hashFactSetContent,
  validateAndVerifyFactSet,
  validateCanonicalFact,
  validateFactSetContent,
  validateSourceArtifact,
} from "../index";
import type {
  CanonicalFactValue,
  FactSetContent,
  ManualCanonicalFact,
  ReportedCanonicalFact,
  Sha256Id,
  SourceArtifact,
} from "../index";

function hash(character: string): Sha256Id {
  return `sha256:${character.repeat(64).slice(0, 64)}` as Sha256Id;
}

function artifact(
  character = "a",
  overrides: Partial<SourceArtifact> = {},
): SourceArtifact {
  return {
    artifactId: hash(character),
    fileName: "issuer-1-fy2026.json",
    mediaType: "application/json",
    byteLength: 512,
    sourceMode: "json",
    acquiredAt: "2026-07-10T08:30:00.000Z",
    filingAsOf: "2026-05-21",
    issuerId: "issuer-1",
    scope: "consolidated",
    parserVersion: "json-parser-v1",
    contentClass: "annual-filing",
    ...overrides,
  };
}

function reportedFact(
  overrides: Partial<ReportedCanonicalFact> = {},
): ReportedCanonicalFact {
  return {
    factId: "fact-revenue-2026",
    issuerId: "issuer-1",
    conceptId: "revenue",
    rawLabel: "Revenue from operations",
    statement: "IS",
    period: {
      start: "2025-04-01",
      end: "2026-03-31",
      kind: "duration",
      frequency: "annual",
    },
    value: {
      kind: "numeric",
      decimal: "1250.50",
      currency: "INR",
      sourceScale: "crore",
      normalizedUnit: "INR_CRORE",
    },
    scope: "consolidated",
    dimensions: {},
    accountingStandard: "ind-as",
    filingVersion: "filing-2026-original",
    factKind: "reported",
    confidence: "exact",
    origin: {
      kind: "reported",
      artifactId: hash("a"),
      sheet: null,
      row: null,
      column: null,
      cellRange: null,
      xbrlContextId: "FY2026-duration",
      parserMethod: "json-grid-v1",
    },
    ...overrides,
  };
}

function factSetContent(
  facts: readonly ReportedCanonicalFact[] = [reportedFact()],
  sourceArtifacts: readonly SourceArtifact[] = [artifact()],
): FactSetContent {
  return {
    schemaVersion: FACT_SET_SCHEMA_VERSION,
    issuerId: "issuer-1",
    sourceArtifacts,
    facts,
  };
}

function errorCodes(result: ReturnType<typeof validateCanonicalFact>): readonly string[] {
  return result.ok === true ? [] : result.errors.map((error) => error.code);
}

describe("canonical source and fact validation", () => {
  it("accepts a complete source artifact and reported fact", () => {
    const source = artifact();
    const fact = reportedFact();

    expect(validateSourceArtifact(source)).toEqual({ ok: true, value: source });
    expect(validateCanonicalFact(fact)).toEqual({ ok: true, value: fact });
  });

  it("supports numeric, date, text, and boolean values with explicit units", () => {
    const values: readonly CanonicalFactValue[] = [
      {
        kind: "numeric",
        decimal: "10000000",
        currency: "INR",
        sourceScale: "absolute",
        normalizedUnit: "INR_ABSOLUTE",
      },
      {
        kind: "numeric",
        decimal: "1250.50",
        currency: "INR",
        sourceScale: "crore",
        normalizedUnit: "INR_CRORE",
      },
      {
        kind: "numeric",
        decimal: "427500000",
        currency: null,
        sourceScale: "absolute",
        normalizedUnit: "ABSOLUTE_SHARES",
      },
      {
        kind: "numeric",
        decimal: "42.75",
        currency: null,
        sourceScale: "crore",
        normalizedUnit: "CRORE_SHARES",
      },
      {
        kind: "numeric",
        decimal: "0.18",
        currency: null,
        sourceScale: "ratio",
        normalizedUnit: "FRACTION",
      },
      {
        kind: "numeric",
        decimal: "2.4",
        currency: null,
        sourceScale: "ratio",
        normalizedUnit: "RATIO",
      },
      {
        kind: "numeric",
        decimal: "12",
        currency: null,
        sourceScale: "count",
        normalizedUnit: "COUNT",
      },
      { kind: "date", date: "2026-03-31", sourceText: "31-Mar-26", normalizedUnit: "DATE" },
      { kind: "text", text: "Audited", normalizedUnit: "TEXT" },
      { kind: "boolean", boolean: true, sourceText: "Yes", normalizedUnit: "BOOLEAN" },
    ];

    for (const [index, value] of values.entries()) {
      expect(
        validateCanonicalFact(
          reportedFact({
            factId: `fact-value-${index}`,
            conceptId: `value-${index}`,
            value,
          }),
        ).ok,
      ).toBe(true);
    }
  });

  it("fails closed when numeric source scale, unit, or currency disagree", () => {
    const wrongScale = reportedFact({
      value: {
        kind: "numeric",
        decimal: "1250.50",
        currency: "INR",
        sourceScale: "ratio",
        normalizedUnit: "INR_CRORE",
      },
    });
    const wrongCurrency = reportedFact({
      value: {
        kind: "numeric",
        decimal: "10",
        currency: "INR",
        sourceScale: "crore",
        normalizedUnit: "CRORE_SHARES",
      },
    });

    expect(errorCodes(validateCanonicalFact(wrongScale))).toContain("invalid-unit");
    expect(errorCodes(validateCanonicalFact(wrongCurrency))).toContain("invalid-currency");
  });

  it("fails closed when provenance is missing", () => {
    const withoutOrigin: Record<string, unknown> = { ...reportedFact() };
    delete withoutOrigin.origin;

    const result = validateCanonicalFact(withoutOrigin);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.errors.some((error) => error.code === "missing-field" && error.path === "$.origin")).toBe(true);
    }
  });

  it("preserves absent coordinates as null and rejects invented locators", () => {
    const nativeAbsence = reportedFact({
      origin: {
        kind: "reported",
        artifactId: hash("a"),
        sheet: null,
        row: null,
        column: null,
        cellRange: null,
        xbrlContextId: null,
        parserMethod: "json-grid-v1",
      },
    });
    const valid = validateCanonicalFact(nativeAbsence);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.origin.sheet).toBeNull();
      expect(valid.value.origin.row).toBeNull();
      expect(valid.value.origin.xbrlContextId).toBeNull();
    }

    const invented = {
      ...nativeAbsence,
      origin: { ...nativeAbsence.origin, sheet: "unknown", row: 0 },
    };
    const invalid = validateCanonicalFact(invented);
    expect(invalid.ok).toBe(false);
    if (invalid.ok === false) {
      expect(invalid.errors.filter((error) => error.code === "invalid-locator")).toHaveLength(2);
    }
  });
});

describe("FactSet provenance and identity", () => {
  it("accepts reported, manual, and derived facts with explicit provenance", () => {
    const manualArtifact = artifact("b", {
      fileName: "analyst-entry.json",
      sourceMode: "manual",
      parserVersion: "manual-entry-v1",
      contentClass: "analyst-input",
    });
    const manual: ManualCanonicalFact = {
      ...reportedFact(),
      factId: "fact-guidance-2026",
      conceptId: "management-guidance-present",
      rawLabel: "Management guidance present",
      value: { kind: "boolean", boolean: true, sourceText: "Yes", normalizedUnit: "BOOLEAN" },
      factKind: "manual",
      confidence: "manual",
      origin: {
        kind: "manual",
        artifactId: manualArtifact.artifactId,
        sheet: null,
        row: null,
        column: null,
        cellRange: null,
        xbrlContextId: null,
        parserMethod: "manual",
        entryRef: "entry-17",
        enteredBy: "analyst-1",
      },
    };
    const derived = {
      ...reportedFact(),
      factId: "fact-revenue-plus-guidance-2026",
      conceptId: "revenue-guidance-flag",
      rawLabel: "Derived revenue guidance flag",
      factKind: "derived" as const,
      confidence: "derived" as const,
      origin: {
        kind: "derived" as const,
        sourceArtifactIds: [artifact().artifactId, manualArtifact.artifactId],
        sheet: null,
        row: null,
        column: null,
        cellRange: null,
        xbrlContextId: null,
        parserMethod: "derived" as const,
        transformationId: "tx-revenue-guidance-v1",
        formulaVersion: "formula-v1",
        inputFactIds: ["fact-revenue-2026", "fact-guidance-2026"],
      },
    };

    const result = validateFactSetContent({
      schemaVersion: FACT_SET_SCHEMA_VERSION,
      issuerId: "issuer-1",
      sourceArtifacts: [artifact(), manualArtifact],
      facts: [reportedFact(), manual, derived],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a fact whose source artifact is absent", () => {
    const result = validateFactSetContent(factSetContent([reportedFact()], [artifact("b")]));
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.errors.map((error) => error.code)).toContain("missing-artifact");
  });

  it("distinguishes duplicate identities from conflicting observations", () => {
    const duplicate = reportedFact({ factId: "fact-revenue-copy" });
    const duplicateResult = validateFactSetContent(factSetContent([reportedFact(), duplicate]));
    expect(duplicateResult.ok).toBe(false);
    if (duplicateResult.ok === false) {
      expect(duplicateResult.errors.map((error) => error.code)).toContain("duplicate-fact-identity");
    }

    const conflict = reportedFact({
      factId: "fact-revenue-conflict",
      value: {
        kind: "numeric",
        decimal: "1400",
        currency: "INR",
        sourceScale: "crore",
        normalizedUnit: "INR_CRORE",
      },
    });
    const conflictResult = validateFactSetContent(factSetContent([reportedFact(), conflict]));
    expect(conflictResult.ok).toBe(false);
    if (conflictResult.ok === false) {
      expect(conflictResult.errors.map((error) => error.code)).toContain("conflicting-fact-identity");
    }
  });

  it("keeps amended filings distinct through filing and artifact identity", () => {
    const amendedArtifact = artifact("b", { fileName: "issuer-1-fy2026-amended.json" });
    const amended = reportedFact({
      factId: "fact-revenue-2026-amended",
      filingVersion: "filing-2026-amendment-1",
      value: {
        kind: "numeric",
        decimal: "1275",
        currency: "INR",
        sourceScale: "crore",
        normalizedUnit: "INR_CRORE",
      },
      origin: { ...reportedFact().origin, artifactId: amendedArtifact.artifactId },
    });

    expect(
      validateFactSetContent(factSetContent([reportedFact(), amended], [artifact(), amendedArtifact])).ok,
    ).toBe(true);
  });
});

describe("FactSet canonical serialization", () => {
  it("is deterministic across object-key and set-array insertion order", async () => {
    const secondArtifact = artifact("b", { fileName: "issuer-1-notes.json" });
    const first = reportedFact({ dimensions: { geography: "India", segment: "Consumer" } });
    const second = reportedFact({
      factId: "fact-assets-2026",
      conceptId: "total-assets",
      rawLabel: "Total assets",
      statement: "BS",
      period: { start: null, end: "2026-03-31", kind: "instant", frequency: "annual" },
      dimensions: {},
    });
    const normal: FactSetContent = {
      schemaVersion: FACT_SET_SCHEMA_VERSION,
      issuerId: "issuer-1",
      sourceArtifacts: [artifact(), secondArtifact],
      facts: [first, second],
    };
    const reordered: FactSetContent = {
      facts: [{ ...first, dimensions: { segment: "Consumer", geography: "India" } }, second].reverse(),
      sourceArtifacts: [secondArtifact, artifact()],
      issuerId: "issuer-1",
      schemaVersion: FACT_SET_SCHEMA_VERSION,
    };

    expect(canonicalizeFactSetContent(normal)).toBe(canonicalizeFactSetContent(reordered));
    expect(await hashFactSetContent(normal)).toBe(await hashFactSetContent(reordered));
  });

  it("creates an immutable AnalysisRun-compatible content reference and detects tampering", async () => {
    const created = await createFactSet(factSetContent());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value.factSetId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(created.value)).toBe(true);
    expect(Object.isFrozen(created.value.facts)).toBe(true);
    expect(factSetContentRef(created.value)).toMatchObject({
      kind: "fact-set",
      contentHash: created.value.factSetId,
      schemaVersion: FACT_SET_SCHEMA_VERSION,
    });
    expect((await validateAndVerifyFactSet(created.value)).ok).toBe(true);

    const tampered = {
      ...created.value,
      facts: [
        {
          ...created.value.facts[0],
          rawLabel: "Changed after hashing",
        },
      ],
    };
    const verification = await validateAndVerifyFactSet(tampered);
    expect(verification.ok).toBe(false);
    if (verification.ok === false) expect(verification.errors[0].code).toBe("invalid-hash");
  });
});
