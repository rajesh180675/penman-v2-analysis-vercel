/**
 * Phase D4 — Client-side loader for NBFC sidecar XLS files.
 *
 * Fetches LGD and RBI NHB files from the company's public data folder,
 * parses them with nbfcSidecarParser, and returns structured data.
 * Graceful: returns null sections on 404 / network errors.
 */
import { parseLgdFiles, parseRbiNhbFile } from "./nbfcSidecarParser";
import { trace } from "../lib/traceLogger";
import type { NbfcSidecarData, LgdMigrationMatrix, RbiNhbPeriod } from "./nbfcSidecarParser";

export type { NbfcSidecarData, LgdMigrationMatrix, RbiNhbPeriod };

/**
 * Fetch and parse NBFC sidecar data from the company's public folder.
 * @param companyFolder - e.g. "Bajaj Finance" (matches public/data/companies/<folder>/)
 * @param blobBaseUrl - optional Vercel Blob base URL for production
 */
export async function fetchNbfcSidecarData(
  companyFolder: string,
  blobBaseUrl?: string | null,
): Promise<NbfcSidecarData> {
  const baseUrl = blobBaseUrl
    ? `${blobBaseUrl.replace(/\/$/, "")}/companies/${encodeURIComponent(companyFolder)}`
    : `/data/companies/${encodeURIComponent(companyFolder)}`;

  // Strategy: try pre-parsed JSON first (fast, reliable), fall back to XLS parsing
  const jsonResult = await fetchPreParsedJson(baseUrl);
  if (jsonResult) {
    trace("sidecar", "nbfcSidecar:jsonHit", {
      lgdPeriods: jsonResult.lgd.length,
      rbiNhbPeriods: jsonResult.rbiNhb.length,
    });
    return jsonResult;
  }

  // Fallback: parse XLS files at runtime
  trace("sidecar", "nbfcSidecar:jsonMiss", { baseUrl }, null, { level: "info", msg: "No pre-parsed JSON, falling back to XLS" });
  const [lgd, rbiNhb] = await Promise.all([
    fetchLgdFiles(baseUrl),
    fetchRbiNhbFile(baseUrl),
  ]);

  return { lgd, rbiNhb };
}

async function fetchPreParsedJson(baseUrl: string): Promise<NbfcSidecarData | null> {
  try {
    const res = await fetch(`${baseUrl}/nbfc_sidecar.json`);
    if (!res.ok) return null;
    const data = await res.json();
    // Validate structure
    if (!data || !Array.isArray(data.lgd) || !Array.isArray(data.rbi_nhb)) return null;
    return {
      lgd: data.lgd as LgdMigrationMatrix[],
      rbiNhb: data.rbi_nhb as RbiNhbPeriod[],
    };
  } catch {
    return null;
  }
}

async function fetchLgdFiles(baseUrl: string): Promise<LgdMigrationMatrix[]> {
  // Try fetching known LGD file pattern: Loss Given Default/LossGivenDefault_.xls
  // and numbered variants (1)-(6)
  const folder = `${baseUrl}/Loss%20Given%20Default`;
  const filenames = [
    "LossGivenDefault_.xls",
    "LossGivenDefault_%20(1).xls",
    "LossGivenDefault_%20(2).xls",
    "LossGivenDefault_%20(3).xls",
    "LossGivenDefault_%20(4).xls",
    "LossGivenDefault_%20(5).xls",
    "LossGivenDefault_%20(6).xls",
  ];

  const results: { filename: string; html: string }[] = [];
  const fetches = filenames.map(async (fname) => {
    try {
      const res = await fetch(`${folder}/${fname}`);
      if (!res.ok) {
        trace("sidecar", "lgdFile:httpError", { fname, status: res.status }, null, { level: "warn" });
        return null;
      }
      const html = await res.text();
      // Validate it's actually an HTML table (not a 404 page)
      if (!html.includes("Loss Given Default") && !html.includes("Gross Caring Amount")) {
        trace("sidecar", "lgdFile:validationFailed", { fname, htmlLength: html.length }, null, { level: "warn" });
        return null;
      }
      return { filename: fname, html };
    } catch (err) {
      trace("sidecar", "lgdFile:fetchError", { fname, error: String(err) }, null, { level: "error" });
      return null;
    }
  });

  const settled = await Promise.all(fetches);
  for (const item of settled) {
    if (item) results.push(item);
  }

  trace("sidecar", "lgdFetchResults", {
    attempted: filenames.length,
    succeeded: results.length,
    baseUrl,
  });

  if (results.length === 0) return [];
  return parseLgdFiles(results);
}

async function fetchRbiNhbFile(baseUrl: string): Promise<RbiNhbPeriod[]> {
  const url = `${baseUrl}/RBI%20NHB%20Banks/RBINHBBanks_.xls`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      trace("sidecar", "rbiNhbFetch:httpError", { url, status: res.status }, null, { level: "warn" });
      return [];
    }
    const html = await res.text();
    if (!html.includes("RBI NHB Banks") && !html.includes("Gross Non-Performing")) {
      trace("sidecar", "rbiNhbFetch:validationFailed", { url, htmlLength: html.length, first100: html.slice(0, 100) }, null, { level: "warn" });
      return [];
    }
    const result = parseRbiNhbFile(html);
    trace("sidecar", "rbiNhbFetch:success", { url, periods: result.length });
    return result;
  } catch (err) {
    trace("sidecar", "rbiNhbFetch:error", { url, error: String(err) }, null, { level: "error" });
    return [];
  }
}
