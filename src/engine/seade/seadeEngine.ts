/**
 * SEADE — main derivation engine.
 *
 * Routes a company to the correct sector derivation module based on its
 * company type, runs derivation, and returns a typed case input plus
 * provenance. Fail-closed: when company type has no derivation module or
 * derivation fails, returns not-applicable / insufficient-evidence.
 */
import { resolveShareBasis } from "../shareCountTools";
import { deriveTelecomCaseInput } from "./telecomDerivation";
import { deriveUtilityCaseInput } from "./utilityDerivation";
import { deriveCyclicalCaseInput } from "./cyclicalDerivation";
import type { DerivedSectorCaseInput, SeadeInput, SeadeResult, DerivationProvenance } from "./types";
import { SEADE_SCHEMA_VERSION } from "./types";
import { buildSectorOnboardingManifest, type SectorOnboardingCompany } from "../sectorCases/onboarding";
import type { SectorOnboardingRow } from "../sectorCases/onboarding";
import type { SectorCaseType } from "../sectorCases/contracts";
import type { RecastPeriod, EngineConfig } from "../types";

function toOnboardingCompany(input: SeadeInput): SectorOnboardingCompany {
  return {
    ticker: input.issuerId,
    name: input.issuerId,
    folder: input.issuerId,
    sector: input.companyType,
    type: input.companyType,
  };
}

function buildOnboardingRow(input: SeadeInput, derived: DerivedSectorCaseInput | null): SectorOnboardingRow {
  const manifest = buildSectorOnboardingManifest([toOnboardingCompany(input)], [], input.asOf ?? undefined);
  const row = manifest[0];
  if (!row) {
    throw new Error("SEADE: onboarding manifest produced no row for the input company.");
  }
  // When derivation succeeded, mark the row as ready (evidence is satisfied by
  // the derived inputs, not by a manually-reviewed sidecar).
  if (derived && derived.derivationStatus === "ready") {
    return {
      ...row,
      status: "ready",
      missingEvidenceIds: [],
      reasonCodes: [],
    };
  }
  // When derivation failed, mark as blocked with the missing evidence IDs.
  if (derived && derived.derivationStatus === "insufficient-evidence") {
    return {
      ...row,
      status: "blocked",
      missingEvidenceIds: [...derived.missingEvidence],
      reasonCodes: ["SEADE_INSUFFICIENT_EVIDENCE"],
    };
  }
  return row;
}

/** Generic derivation-module output shape shared by all sector modules. */
interface SectorDerivationModuleResult {
  readonly input: unknown | null;
  readonly provenance: Readonly<Record<string, DerivationProvenance>>;
  readonly missingEvidence: readonly string[];
  readonly reason: string;
}

type DerivationModule = (
  periods: readonly RecastPeriod[],
  config: EngineConfig,
  issuerId: string,
  asOf: string,
  sharesOutstandingCr: number | null,
) => SectorDerivationModuleResult;

/** Map company type → (case type, derivation module). Data-driven dispatch. */
const DERIVATION_MODULES: Readonly<Partial<Record<SeadeInput["companyType"], { caseType: SectorCaseType; run: DerivationModule }>>> = {
  telecom: { caseType: "telecom-network", run: deriveTelecomCaseInput },
  utility: { caseType: "utility-rab", run: deriveUtilityCaseInput },
  cyclical: { caseType: "cyclical-mid-cycle", run: deriveCyclicalCaseInput },
};

export function deriveSectorCase(input: SeadeInput): SeadeResult {
  const asOf = input.asOf ?? input.periods.at(-1)?.period_end ?? new Date().toISOString().slice(0, 10);
  const shares = input.sharesOutstandingCr ?? resolveShareBasis([...input.periods], input.config).sharesForPerShare ?? null;

  let derived: DerivedSectorCaseInput | null = null;
  const module = DERIVATION_MODULES[input.companyType];

  if (module) {
    const result = module.run(input.periods, input.config, input.issuerId, asOf, shares);
    if (result.input) {
      derived = {
        caseType: module.caseType,
        issuerId: input.issuerId,
        asOf,
        inputs: result.input as DerivedSectorCaseInput["inputs"],
        provenance: result.provenance,
        missingEvidence: result.missingEvidence,
        derivationStatus: "ready",
        reason: "",
      };
    } else {
      derived = {
        caseType: module.caseType,
        issuerId: input.issuerId,
        asOf,
        inputs: null as unknown as DerivedSectorCaseInput["inputs"],
        provenance: result.provenance,
        missingEvidence: result.missingEvidence,
        derivationStatus: "insufficient-evidence",
        reason: result.reason,
      };
    }
  }

  const onboardingRow = buildOnboardingRow(input, derived);

  return {
    schemaVersion: SEADE_SCHEMA_VERSION,
    derived,
    onboardingRow,
  };
}
