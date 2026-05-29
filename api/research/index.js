import { BlobVersionMismatchError, buildTimestampedPath, isResearchConfigured, listJsonBlobs, maybeRequireResearchReadAuth, maybeRequireResearchWriteAuth, readJsonBlob, readResearchBody, researchPath, writeJsonBlob } from "./_store.js";
import { sanitizePathSegment } from "../audit/_lib.js";

const COMPARISON_REGISTRY_SCHEMA_VERSION = "2026-04-comparison-registry-v1";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireCompanyId(body, response) {
  if (typeof body.companyId !== "string" || !body.companyId.trim()) {
    response.status(400).json({ error: "companyId is required." });
    return null;
  }
  return sanitizePathSegment(body.companyId);
}

/**
 * Read the persisted JSON at `pathname` and return its `version` field
 * (defaulting to 0 when missing). Used by optimistic-concurrency writes.
 */
async function readVersion(pathname) {
  const existing = await readJsonBlob(pathname).catch(() => null);
  if (existing && typeof existing.version === "number" && Number.isFinite(existing.version)) {
    return { existing, version: existing.version };
  }
  return { existing, version: 0 };
}

function respondVersionConflict(response, error, kind) {
  response.status(409).json({
    error: "Blob version conflict — another writer updated this resource. Re-read and retry.",
    kind,
    expectedVersion: error.expectedVersion,
    actualVersion: error.actualVersion,
  });
}

export default async function handler(request, response) {
  if (!isResearchConfigured()) {
    response.status(503).json({ error: "Research storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel." });
    return;
  }

  if (request.method === "GET") {
    if (!maybeRequireResearchReadAuth(request, response)) return;
    const kind = typeof request.query?.kind === "string" ? request.query.kind : null;
    if (kind === "comparison-registry") {
      const comparisonRegistry = await readJsonBlob(researchPath("comparison-registry", "latest.json"));
      response.status(200).json(comparisonRegistry ?? {
        schemaVersion: COMPARISON_REGISTRY_SCHEMA_VERSION,
        storedAt: null,
        companies: {},
      });
      return;
    }
    const companyId = typeof request.query?.companyId === "string" ? sanitizePathSegment(request.query.companyId) : null;
    if (!companyId) {
      response.status(400).json({ error: "companyId is required." });
      return;
    }

    const [profile, filings, valuations, journal, alerts, analyses] = await Promise.all([
      readJsonBlob(researchPath("companies", companyId, "profile.json")),
      listJsonBlobs(`research-store/companies/${companyId}/filings`, 80),
      listJsonBlobs(`research-store/companies/${companyId}/valuations`, 80),
      listJsonBlobs(`research-store/companies/${companyId}/journal`, 80),
      listJsonBlobs(`research-store/companies/${companyId}/alerts`, 80),
      listJsonBlobs(`research-store/companies/${companyId}/analysis`, 80),
    ]);

    response.status(200).json({
      companyId,
      profile,
      filings: filings.map((item) => item.payload).filter(Boolean),
      valuations: valuations.map((item) => item.payload).filter(Boolean),
      journal: journal.map((item) => item.payload).filter(Boolean),
      alerts: alerts.map((item) => item.payload).filter(Boolean),
      analysis: analyses.map((item) => item.payload).filter(Boolean),
    });
    return;
  }

  if (request.method === "POST") {
    if (!maybeRequireResearchWriteAuth(request, response)) return;
    const body = await readResearchBody(request, response, 2 * 1024 * 1024);
    if (!body) return;
    const kind = typeof body.kind === "string" ? body.kind : null;
    if (!kind) {
      response.status(400).json({ error: "Research write kind is required." });
      return;
    }
    if (kind === "comparison-registry") {
      const comparisonRegistry = isRecord(body.comparisonRegistry) ? body.comparisonRegistry : null;
      if (!comparisonRegistry || !isRecord(comparisonRegistry.companies)) {
        response.status(400).json({ error: "comparisonRegistry.companies is required." });
        return;
      }
      const pathname = researchPath("comparison-registry", "latest.json");
      const { version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          schemaVersion: comparisonRegistry.schemaVersion ?? COMPARISON_REGISTRY_SCHEMA_VERSION,
          storedAt: new Date().toISOString(),
          companies: comparisonRegistry.companies,
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, kind });
      return;
    }

    const companyId = requireCompanyId(body, response);
    if (!companyId) return;

    if (kind === "profile") {
      const issuer = body.issuer ?? body.profile?.issuer ?? null;
      const notebook = body.notebook ?? body.profile?.notebook ?? null;
      const portfolio = body.portfolio ?? body.profile?.portfolio ?? null;
      const pathname = researchPath("companies", companyId, "profile.json");
      const { version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          companyId,
          issuer,
          notebook,
          portfolio,
          updatedAt: new Date().toISOString(),
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, companyId, kind });
      return;
    }

    if (kind === "analysis") {
      if (!isRecord(body.analysis)) {
        response.status(400).json({ error: "analysis payload is required." });
        return;
      }
      const pathname = buildTimestampedPath(companyId, "analysis", body.analysis.id ?? `${Date.now()}`);
      const { version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          companyId,
          ...body.analysis,
          storedAt: new Date().toISOString(),
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, companyId, kind });
      return;
    }

    if (kind === "journal") {
      if (!isRecord(body.journal)) {
        response.status(400).json({ error: "journal payload is required." });
        return;
      }
      const pathname = buildTimestampedPath(companyId, "journal", body.journal.id ?? `${Date.now()}`);
      const { version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          companyId,
          ...body.journal,
          storedAt: new Date().toISOString(),
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, companyId, kind });
      return;
    }

    if (kind === "filing") {
      if (!isRecord(body.filing)) {
        response.status(400).json({ error: "filing payload is required." });
        return;
      }
      const pathname = buildTimestampedPath(companyId, "filings", body.filing.filingId ?? `${Date.now()}`);
      const { version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          companyId,
          ...body.filing,
          storedAt: new Date().toISOString(),
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, companyId, kind });
      return;
    }

    if (kind === "valuation") {
      if (!isRecord(body.valuation)) {
        response.status(400).json({ error: "valuation payload is required." });
        return;
      }
      const pathname = buildTimestampedPath(companyId, "valuations", body.valuation.id ?? `${Date.now()}`);
      const { version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          companyId,
          ...body.valuation,
          storedAt: new Date().toISOString(),
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, companyId, kind });
      return;
    }

    if (kind === "alert") {
      if (!isRecord(body.alert)) {
        response.status(400).json({ error: "alert payload is required." });
        return;
      }
      const pathname = buildTimestampedPath(companyId, "alerts", body.alert.id ?? `${Date.now()}`);
      const { version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          companyId,
          ...body.alert,
          storedAt: new Date().toISOString(),
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, companyId, kind });
      return;
    }

    if (kind === "portfolio") {
      if (!isRecord(body.portfolio)) {
        response.status(400).json({ error: "portfolio payload is required." });
        return;
      }
      const pathname = researchPath("companies", companyId, "profile.json");
      const { existing, version } = await readVersion(pathname);
      try {
        await writeJsonBlob(pathname, {
          companyId,
          issuer: existing?.issuer ?? null,
          notebook: existing?.notebook ?? null,
          portfolio: body.portfolio,
          updatedAt: new Date().toISOString(),
        }, { ifVersion: version });
      } catch (error) {
        if (error instanceof BlobVersionMismatchError) {
          respondVersionConflict(response, error, kind);
          return;
        }
        throw error;
      }
      response.status(200).json({ ok: true, companyId, kind });
      return;
    }

    response.status(400).json({ error: `Unsupported research write kind: ${kind}` });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
