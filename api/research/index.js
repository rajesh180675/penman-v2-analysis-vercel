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
    const writes = [];
    if (body.profile) {
      writes.push(writeJsonBlob(researchPath("companies", companyId, "profile.json"), {
        companyId,
        ...body.profile,
        updatedAt: new Date().toISOString(),
      }));
    }
    if (body.analysis) {
      writes.push(writeJsonBlob(buildTimestampedPath(companyId, "analysis", body.analysis.id ?? `${Date.now()}`), {
        companyId,
        ...body.analysis,
        storedAt: new Date().toISOString(),
      }));
    }
    if (body.journal) {
      writes.push(writeJsonBlob(buildTimestampedPath(companyId, "journal", body.journal.id ?? `${Date.now()}`), {
        companyId,
        ...body.journal,
        storedAt: new Date().toISOString(),
      }));
    }
    await Promise.all(writes);
    response.status(200).json({ ok: true, companyId });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
