import type { OidcSessionVerifierOptions } from "./sessionVerifier";
import { OidcJwksSessionVerifier } from "./sessionVerifier";
import { PostgresPoolDriver, type PostgresPoolLike } from "./postgresDriver";
import { VercelBlobObjectStore } from "./vercelBlobObjectStore";
import { createPlatformRouter } from "../routes/platform";
import { AnalysisPlatformServiceV1 } from "../../src/platform/analysisPlatformService";
import { DistributedRateLimiter } from "../../src/platform/security/distributedRateLimit";
import { WorkspacePlatformSecurityBoundary } from "../../src/platform/security/boundary";
import { WorkspaceMembershipAdministrationService } from "../../src/platform/security/membershipAdmin";
import { SqlAnalysisRunRepository } from "../../src/platform/durablePersistence/sqlAnalysisRunRepository";
import { SqlArtifactRepository } from "../../src/platform/durablePersistence/sqlArtifactRepository";
import { SqlAtomicRateLimitStore, SqlWorkspaceMembershipStore } from "../../src/platform/durablePersistence/sqlSecurityAdapters";
import { SqlAtomicRunLifecycleCoordinator } from "../../src/platform/durablePersistence/sqlAtomicLifecycleCoordinator";
import { SqlRunOperationsRepository } from "../../src/platform/durablePersistence/sqlRunOperationsRepository";
import { GovernanceEvidenceService } from "../../src/platform/governanceEvidence/service";
import { SqlGovernanceEvidenceRepository } from "../../src/platform/governanceEvidence/sqlRepository";
import { GovernedRunAdmissionVerifier } from "../../src/platform/governanceEvidence/runAdmission";
import { ProductionPlatformProbe } from "../../src/platform/operations/productionProbe";

export function createProductionPlatformRuntime(input: {
  readonly pool: PostgresPoolLike;
  readonly blobToken?: string;
  readonly oidc: OidcSessionVerifierOptions;
}) {
  const sql = new PostgresPoolDriver(input.pool);
  const objects = new VercelBlobObjectStore(input.blobToken);
  const memberships = new SqlWorkspaceMembershipStore(sql);
  const rateLimits = new SqlAtomicRateLimitStore(sql);
  const security = new WorkspacePlatformSecurityBoundary(memberships, new DistributedRateLimiter(rateLimits), { windowSeconds: 60 });
  const runs = new SqlAnalysisRunRepository(sql);
  const artifacts = new SqlArtifactRepository(sql, objects);
  const operations = new SqlRunOperationsRepository(sql);
  const atomicLifecycle = new SqlAtomicRunLifecycleCoordinator(sql, objects);
  const governanceRepository = new SqlGovernanceEvidenceRepository(sql);
  const governanceAdmission = new GovernedRunAdmissionVerifier(governanceRepository);
  const service = new AnalysisPlatformServiceV1(runs, artifacts, operations, security, atomicLifecycle, governanceAdmission);
  const governance = new GovernanceEvidenceService(governanceRepository, security);
  const membershipAdmin = new WorkspaceMembershipAdministrationService(memberships, security);
  const probe = new ProductionPlatformProbe(sql, objects);
  const sessions = new OidcJwksSessionVerifier(input.oidc);
  return Object.freeze({ sql, objects, runs, artifacts, operations, governanceRepository, governanceAdmission, service, governance, membershipAdmin, probe, sessions, router: createPlatformRouter({ service, governance, membershipAdmin, probe, sessions }) });
}
