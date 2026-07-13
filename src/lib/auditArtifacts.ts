export interface AuditArtifactVerification {
  status: "verified" | "mismatch" | "unverifiable" | "invalid-compression";
  expectedHash: string | null;
  actualHash: string | null;
  algorithm?: string | undefined;
  decodedBytes?: number | undefined;
  parsed?: boolean | undefined;
}

export interface AuditArtifactInspection {
  ok: boolean;
  artifact: {
    pathname: string;
    filename: string;
    contentType: string;
    contentEncoding: string | null;
    storedBytes: number;
    uploadedAt: string | null;
  };
  verification: AuditArtifactVerification;
  snapshotSummary: Record<string, unknown> | null;
}

function auditHeaders(runAccessToken: string): Record<string, string> {
  return { "x-audit-run-token": runAccessToken, "x-penman-local": "1" };
}

export async function inspectAuditArtifact(input: {
  runId: string;
  pathname: string;
  runAccessToken: string;
}): Promise<AuditArtifactInspection> {
  const params = new URLSearchParams({ runId: input.runId, pathname: input.pathname });
  const response = await fetch(`/api/audit/artifacts?${params.toString()}`, {
    headers: auditHeaders(input.runAccessToken),
  });
  if (!response.ok) throw new Error(`Artifact verification failed with ${response.status}`);
  return await response.json() as AuditArtifactInspection;
}

export async function fetchAuditArtifactDownload(input: {
  runId: string;
  pathname: string;
  runAccessToken: string;
}): Promise<{ blob: Blob; filename: string }> {
  const params = new URLSearchParams({ runId: input.runId, pathname: input.pathname, download: "1" });
  const response = await fetch(`/api/audit/artifacts?${params.toString()}`, {
    headers: auditHeaders(input.runAccessToken),
  });
  if (!response.ok) throw new Error(`Artifact download failed with ${response.status}`);
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1]
    ?? input.pathname.split("/").pop()
    ?? "audit-artifact.bin";
  return { blob: await response.blob(), filename };
}
