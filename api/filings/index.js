import { buildTimestampedPath, isResearchConfigured, listJsonBlobs, maybeRequireResearchReadAuth, readResearchBody, writeJsonBlob } from "../research/_store.js";
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
    const filings = await listJsonBlobs(`research-store/companies/${companyId}/filings`, 100);
    response.status(200).json({ companyId, filings: filings.map((item) => item.payload).filter(Boolean) });
    return;
  }

  if (request.method === "POST") {
    const body = await readResearchBody(request, response);
    if (!body) return;
    const companyId = sanitizePathSegment(body.companyId);
    const filingId = sanitizePathSegment(body.filing?.filingId ?? `${Date.now()}`);
    const pathname = buildTimestampedPath(companyId, "filings", filingId);
    await writeJsonBlob(pathname, {
      companyId,
      ...body.filing,
      storedAt: new Date().toISOString(),
    });
    response.status(200).json({ ok: true, companyId, pathname });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
