import { buildTimestampedPath, isResearchConfigured, listJsonBlobs, maybeRequireResearchReadAuth, readJsonBlob, readResearchBody, researchPath, writeJsonBlob } from "./_store.js";
import { sanitizePathSegment } from "../audit/_lib.js";

export default async function handler(request, response) {
  if (!isResearchConfigured()) {
    response.status(503).json({ error: "Research storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel." });
    return;
  }

  if (request.method === "GET") {
    if (!maybeRequireResearchReadAuth(request, response)) return;
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
    const body = await readResearchBody(request, response, 2 * 1024 * 1024);
    if (!body) return;
    const companyId = sanitizePathSegment(body.companyId);
    const kind = typeof body.kind === "string" ? body.kind : (
      body.profile ? "profile"
      : body.filing ? "filing"
      : body.valuation ? "valuation"
      : body.portfolio ? "portfolio"
      : body.alert ? "alert"
      : body.analysis ? "analysis"
      : body.journal ? "journal"
      : null
    );
    if (!kind) {
      response.status(400).json({ error: "Research write kind is required." });
      return;
    }
    const writes = [];
    if (kind === "profile") {
      writes.push(writeJsonBlob(researchPath("companies", companyId, "profile.json"), {
        companyId,
        issuer: body.issuer ?? body.profile?.issuer ?? null,
        notebook: body.notebook ?? body.profile?.notebook ?? null,
        portfolio: body.portfolio ?? body.profile?.portfolio ?? body.portfolio ?? null,
        updatedAt: new Date().toISOString(),
      }));
    }
    if (kind === "analysis" && body.analysis) {
      writes.push(writeJsonBlob(buildTimestampedPath(companyId, "analysis", body.analysis.id ?? `${Date.now()}`), {
        companyId,
        ...body.analysis,
        storedAt: new Date().toISOString(),
      }));
    }
    if (kind === "journal" && body.journal) {
      writes.push(writeJsonBlob(buildTimestampedPath(companyId, "journal", body.journal.id ?? `${Date.now()}`), {
        companyId,
        ...body.journal,
        storedAt: new Date().toISOString(),
      }));
    }
    if (kind === "filing" && body.filing) {
      writes.push(writeJsonBlob(buildTimestampedPath(companyId, "filings", body.filing.filingId ?? `${Date.now()}`), {
        companyId,
        ...body.filing,
        storedAt: new Date().toISOString(),
      }));
    }
    if (kind === "valuation" && body.valuation) {
      writes.push(writeJsonBlob(buildTimestampedPath(companyId, "valuations", body.valuation.id ?? `${Date.now()}`), {
        companyId,
        ...body.valuation,
        storedAt: new Date().toISOString(),
      }));
    }
    if (kind === "alert" && body.alert) {
      writes.push(writeJsonBlob(buildTimestampedPath(companyId, "alerts", body.alert.id ?? `${Date.now()}`), {
        companyId,
        ...body.alert,
        storedAt: new Date().toISOString(),
      }));
    }
    if (kind === "portfolio" && body.portfolio) {
      const existingProfile = await readJsonBlob(researchPath("companies", companyId, "profile.json")).catch(() => null);
      writes.push(writeJsonBlob(researchPath("companies", companyId, "profile.json"), {
        companyId,
        issuer: existingProfile?.issuer ?? null,
        notebook: existingProfile?.notebook ?? null,
        portfolio: body.portfolio,
        updatedAt: new Date().toISOString(),
      }));
    }
    await Promise.all(writes);
    response.status(200).json({ ok: true, companyId, kind });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
