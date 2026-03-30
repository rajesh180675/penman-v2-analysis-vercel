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
    const result = await list({
      prefix: researchPath("companies"),
      limit: 300,
      mode: "expanded",
    });
    const rows = [];
    for (const blob of result.blobs) {
      if (!blob.pathname.endsWith("/profile.json")) continue;
      const profile = await readJsonBlob(blob.pathname).catch(() => null);
      if (profile) rows.push(profile);
    }
    response.status(200).json({ watchlist: rows });
    return;
  }

  if (request.method === "POST") {
    const body = await readResearchBody(request, response);
    if (!body) return;
    const companyId = sanitizePathSegment(body.companyId);
    const pathname = researchPath("companies", companyId, "profile.json");
    const existing = await readJsonBlob(pathname).catch(() => null);
    await writeJsonBlob(pathname, {
      ...(existing ?? {}),
      companyId,
      updatedAt: new Date().toISOString(),
      portfolio: body.portfolio ?? existing?.portfolio ?? null,
      notebook: body.notebook ?? existing?.notebook ?? null,
      issuer: body.issuer ?? existing?.issuer ?? null,
    });
    response.status(200).json({ ok: true, companyId, pathname });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  response.status(405).json({ error: "Method not allowed." });
}
