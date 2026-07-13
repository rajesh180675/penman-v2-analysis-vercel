import type { CompanyType } from "../types";
import type { SectorCaseType } from "./contracts";
import type { SectorCaseInput } from "./contracts";
import { CURRENT_SECTOR_CASE_REGISTRY } from "./registry";

export const SECTOR_ONBOARDING_SCHEMA_VERSION = "2026-07-sector-onboarding-v1" as const;

export interface SectorOnboardingCompany {
  readonly ticker: string;
  readonly name: string;
  readonly folder: string;
  readonly sector: string;
  readonly type: Exclude<CompanyType, "auto">;
}

export interface GovernedSectorSidecarApproval {
  readonly sidecarId: string;
  readonly issuerId: string;
  readonly caseType: SectorCaseType;
  readonly schemaVersion: string;
  readonly reviewedAt: string;
  readonly reviewerPrincipalId: string;
  readonly status: "approved" | "rejected" | "draft";
  readonly evidence: Readonly<Record<string, readonly string[]>>;
  readonly caseInput: SectorCaseInput;
}

export interface SectorOnboardingRow {
  readonly issuerId: string;
  readonly companyType: Exclude<CompanyType, "auto">;
  readonly inferredCaseType: SectorCaseType | null;
  readonly inferenceBasis: string;
  readonly status: "not-applicable" | "requires-sidecar" | "ready" | "blocked";
  readonly requiredEvidenceIds: readonly string[];
  readonly missingEvidenceIds: readonly string[];
  readonly sidecarId: string | null;
  readonly reasonCodes: readonly string[];
}

function inferCase(company: SectorOnboardingCompany): { caseType: SectorCaseType | null; basis: string } {
  switch (company.type) {
    case "utility": return { caseType: "utility-rab", basis: "registry-company-type:utility" };
    case "telecom": return { caseType: "telecom-network", basis: "registry-company-type:telecom" };
    case "bank": return { caseType: "bank-equity", basis: "registry-company-type:bank" };
    case "nbfc": return { caseType: "nbfc-funding", basis: "registry-company-type:nbfc" };
    case "insurance": return { caseType: "insurance-embedded-value", basis: "registry-company-type:insurance" };
    case "conglomerate": return { caseType: "conglomerate-sotp", basis: "registry-company-type:conglomerate" };
    case "cyclical": return { caseType: "cyclical-mid-cycle", basis: "registry-company-type:cyclical" };
    case "consumer": return /retail/i.test(company.sector)
      ? { caseType: "retail-unit-economics", basis: "registry-sector:retail" }
      : { caseType: null, basis: "consumer-without-governed-unit-economics-case" };
    default: return { caseType: null, basis: `no-native-case-for:${company.type}` };
  }
}

export function buildSectorOnboardingManifest(
  companies: readonly SectorOnboardingCompany[],
  approvals: readonly GovernedSectorSidecarApproval[] = [],
  evaluationAt = new Date().toISOString(),
): readonly SectorOnboardingRow[] {
  const evaluationTime = Date.parse(evaluationAt);
  const approvalsByIssuer = new Map<string, GovernedSectorSidecarApproval[]>();
  const sidecarIdCounts = new Map<string, number>();
  for (const approval of approvals) {
    approvalsByIssuer.set(approval.issuerId, [...(approvalsByIssuer.get(approval.issuerId) ?? []), approval]);
    sidecarIdCounts.set(approval.sidecarId, (sidecarIdCounts.get(approval.sidecarId) ?? 0) + 1);
  }
  return Object.freeze(companies.map((company): SectorOnboardingRow => {
    const inferred = inferCase(company);
    if (!inferred.caseType) return Object.freeze({
      issuerId: company.ticker, companyType: company.type, inferredCaseType: null, inferenceBasis: inferred.basis,
      status: "not-applicable", requiredEvidenceIds: [], missingEvidenceIds: [], sidecarId: null,
      reasonCodes: ["NO_APPLICABLE_NATIVE_SECTOR_CASE"],
    });
    const definition = CURRENT_SECTOR_CASE_REGISTRY.require(inferred.caseType);
    const issuerApprovals = approvalsByIssuer.get(company.ticker) ?? [];
    const orderedApprovals = [...issuerApprovals].sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt) || right.sidecarId.localeCompare(left.sidecarId));
    const approval = orderedApprovals[0];
    if (!approval) return Object.freeze({
      issuerId: company.ticker, companyType: company.type, inferredCaseType: inferred.caseType, inferenceBasis: inferred.basis,
      status: "requires-sidecar", requiredEvidenceIds: definition.requiredEvidenceIds,
      missingEvidenceIds: definition.requiredEvidenceIds, sidecarId: null, reasonCodes: ["GOVERNED_SIDECAR_REQUIRED"],
    });
    const missingEvidenceIds = definition.requiredEvidenceIds.filter((id) => !(approval.evidence[id]?.length));
    const reasonCodes: string[] = [];
    if (orderedApprovals.length > 1 && Date.parse(orderedApprovals[0]!.reviewedAt) === Date.parse(orderedApprovals[1]!.reviewedAt)) reasonCodes.push("SIDECAR_REVISION_ORDER_AMBIGUOUS");
    if ((sidecarIdCounts.get(approval.sidecarId) ?? 0) > 1) reasonCodes.push("DUPLICATE_SIDECAR_ID");
    if (approval.caseType !== inferred.caseType) reasonCodes.push("SIDECAR_CASE_TYPE_MISMATCH");
    if (approval.issuerId !== company.ticker) reasonCodes.push("SIDECAR_ISSUER_MISMATCH");
    if (approval.schemaVersion !== definition.inputContract) reasonCodes.push("SIDECAR_SCHEMA_MISMATCH");
    if (approval.status !== "approved") reasonCodes.push("SIDECAR_NOT_APPROVED");
    if (!approval.sidecarId.trim()) reasonCodes.push("SIDECAR_ID_REQUIRED");
    if (!approval.reviewerPrincipalId.trim()) reasonCodes.push("SIDECAR_REVIEWER_REQUIRED");
    const reviewedTime = Date.parse(approval.reviewedAt);
    if (!Number.isFinite(evaluationTime) || !Number.isFinite(reviewedTime) || reviewedTime > evaluationTime) reasonCodes.push("SIDECAR_REVIEW_TIMESTAMP_INVALID");
    if (definition.requiredEvidenceIds.some((id) => approval.evidence[id]?.some((ref) => !ref.trim()))) reasonCodes.push("SIDECAR_EVIDENCE_INVALID");
    if (approval.caseInput.caseType !== approval.caseType || approval.caseInput.issuerId !== approval.issuerId) reasonCodes.push("SIDECAR_CASE_INPUT_MISMATCH");
    const caseAsOfTime = Date.parse(`${approval.caseInput.asOf}T23:59:59.999Z`);
    if (!Number.isFinite(caseAsOfTime) || caseAsOfTime > evaluationTime) reasonCodes.push("SIDECAR_CASE_INPUT_AFTER_EVALUATION");
    if (definition.requiredEvidenceIds.some((id) => JSON.stringify(approval.caseInput.evidence[id] ?? []) !== JSON.stringify(approval.evidence[id] ?? []))) reasonCodes.push("SIDECAR_CASE_INPUT_EVIDENCE_MISMATCH");
    if (missingEvidenceIds.length) reasonCodes.push("SIDECAR_EVIDENCE_INCOMPLETE");
    return Object.freeze({
      issuerId: company.ticker, companyType: company.type, inferredCaseType: inferred.caseType, inferenceBasis: inferred.basis,
      status: reasonCodes.length ? "blocked" : "ready", requiredEvidenceIds: definition.requiredEvidenceIds,
      missingEvidenceIds, sidecarId: approval.sidecarId, reasonCodes,
    });
  }).sort((left, right) => left.issuerId.localeCompare(right.issuerId)));
}

export function selectGovernedSectorCase(row: SectorOnboardingRow): SectorCaseType | null {
  return row.status === "ready" ? row.inferredCaseType : null;
}
