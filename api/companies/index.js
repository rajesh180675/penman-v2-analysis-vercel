import { list } from "@vercel/blob";
import { isResearchConfigured, maybeRequireResearchReadAuth, readJsonBlob, readResearchBody, researchPath, writeJsonBlob } from "../research/_store.js";
import { sanitizePathSegment } from "../audit/_lib.js";

export default async function handler(request, response) {
  if (!isResearchConfigured()) {
    response.status(503).json({ error: "Research storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel." });
    return;
  }

  if (request.method === "GET") {
    if (!maybeRequireResearchReadAuth(request, response)) return;
    const companyId = typeof request.query?.companyId === "string" ? sanitizePathSegment(request.query.companyId) : null;

    if (companyId) {
      const profile = await readJsonBlob(researchPath("companies", companyId, "profile.json"));
      response.status(200).json({ companyId, profile });
      return;
    }

    const result = await list({
      prefix: researchPath("companies"),
      limit: 200,
      mode: "expanded",
    });
    const profiles = [];
    for (const blob of result.blobs) {
      if (!blob.pathname.endsWith("/profile.json")) continue;
      const profile = await readJsonBlob(blob.pathname).catch(() => null);
      if (profile) profiles.push(profile);
    }
    response.status(200).json({ companies: profiles });
    return;
  }

  if (request.method === "POST") {
    const body = await readResearchBody(request, response);
    if (!body) return;
    const companyId = sanitizePathSegment(body.companyId);
    const pathname = researchPath("companies", companyId, "profile.json");
    const payload = {
      companyId,
      updatedAt: new Date().toISOString(),
      issuer: body.issuer ?? null,
      notebook: body.notebook ?? null,
      portfolio: body.portfolio ?? null,
    };
    await writeJsonBlob(pathname, payload);
    response.status(200).json({ ok: true, companyId, pathname });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
