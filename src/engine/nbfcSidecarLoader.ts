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
  blobBaseUrl?: string | null | undefined,
): Promise<NbfcSidecarData> {
  const baseUrl = blobBaseUrl
    ? `${blobBaseUrl.replace(/\/$/, "")}/companies/${encodeURIComponent(companyFolder)}`
    : `/data/companies/${encodeURIComponent(companyFolder).replace(/%26/g, "&")}`;

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
  const url = `${baseUrl}/nbfc_sidecar.json`;
  trace("sidecar", "preParsedJson:attempt", { url });
  try {
    const res = await fetch(url);
    if (!res.ok) {
      trace("sidecar", "preParsedJson:httpMiss", { url, status: res.status }, null, { level: "warn" });
      return null;
    }
    // Detect Vite SPA fallback: when the file doesn't exist, dev server returns
    // 200 OK with the index.html shell. This is "expected absence" for any
    // non-NBFC company, not an error. Check Content-Type before parsing.
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      trace("sidecar", "preParsedJson:absent", { url, reason: "html-fallback" }, null, { level: "info" });
      return null;
    }
    const data = await res.json();
    // Validate structure
    if (!data || !Array.isArray(data.lgd) || !Array.isArray(data.rbi_nhb)) {
      trace("sidecar", "preParsedJson:invalidStructure", { url, hasLgd: Array.isArray(data?.lgd), hasRbiNhb: Array.isArray(data?.rbi_nhb) }, null, { level: "warn" });
      return null;
    }
    trace("sidecar", "preParsedJson:success", { url, lgdCount: data.lgd.length, rbiNhbCount: data.rbi_nhb.length });
    return {
      lgd: data.lgd as LgdMigrationMatrix[],
      rbiNhb: data.rbi_nhb as RbiNhbPeriod[],
    };
  } catch (err) {
    // SyntaxError on HTML response shouldn't reach here anymore (Content-Type
    // guard above). Anything else is a real error.
    const errStr = String(err);
    const isHtmlSyntaxError = errStr.includes("Unexpected token '<'") || errStr.includes("<!doctype");
    if (isHtmlSyntaxError) {
      trace("sidecar", "preParsedJson:absent", { url, reason: "html-syntax-fallback" }, null, { level: "info" });
    } else {
      trace("sidecar", "preParsedJson:error", { url, error: errStr, stack: (err as Error)?.stack }, null, { level: "error" });
    }
    return null;
  }
}

async function fetchLgdFiles(baseUrl: string): Promise<LgdMigrationMatrix[]> {
  // LGD files use the year-named convention: LossGivenDefault_YYYYMM.xls
  // (YYYYMM = fiscal year-end month, always 03 for Indian FYs).
  // The data-ingestion workflow (capitaline-download-workflow skill) renames
  // Capitaline's anonymous downloads before commit. Files that aren't renamed
  // never reach disk or blob, so the loader doesn't try legacy unnamed names.
  const folder = `${baseUrl}/Loss%20Given%20Default`;

  // Year-named files (FY2018-FY2025, March year-end). When new fiscal years
  // are added, append the corresponding YYYYMM here.
  const yearFilenames = [
    "LossGivenDefault_201803.xls",
    "LossGivenDefault_201903.xls",
    "LossGivenDefault_202003.xls",
    "LossGivenDefault_202103.xls",
    "LossGivenDefault_202203.xls",
    "LossGivenDefault_202303.xls",
    "LossGivenDefault_202403.xls",
    "LossGivenDefault_202503.xls",
  ];

  const fetches = yearFilenames.map(async (fname) => {
    try {
      const res = await fetch(`${folder}/${fname}`);
      if (!res.ok) return null;
      const html = await res.text();
      const isSpaFallback = html.includes("<!doctype html>") && !html.includes("Loss Given Default") && !html.includes("Gross Caring Amount");
      if (isSpaFallback) return null;
      if (!html.includes("Loss Given Default") && !html.includes("Gross Caring Amount")) return null;
      trace("sidecar", "lgdFile:fetchSuccess", { fname, htmlLength: html.length });
      return { filename: fname, html };
    } catch {
      return null;
    }
  });

  const settled = await Promise.all(fetches);
  const results: { filename: string; html: string }[] = [];
  for (const item of settled) {
    if (item) results.push(item);
  }

  trace("sidecar", "lgdFetchResults", {
    succeeded: results.length,
    attempted: yearFilenames.length,
    baseUrl,
  });

  if (results.length === 0) return [];
  try {
    const parsed = parseLgdFiles(results);
    trace("sidecar", "lgdParse:success", { inputFiles: results.length, periods: parsed.length });
    return parsed;
  } catch (err) {
    trace("sidecar", "lgdParse:error", { inputFiles: results.length, error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
    return [];
  }
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
    // Detect Vite SPA fallback (file doesn't exist on disk)
    const isSpaFallback = html.includes("<!doctype html>") && !html.includes("RBI NHB Banks") && !html.includes("Gross Non-Performing");
    if (isSpaFallback) {
      trace("sidecar", "rbiNhbFetch:absent", { url, htmlLength: html.length }, null, { level: "info" });
      return [];
    }
    if (!html.includes("RBI NHB Banks") && !html.includes("Gross Non-Performing")) {
      trace("sidecar", "rbiNhbFetch:validationFailed", { url, htmlLength: html.length, first100: html.slice(0, 100) }, null, { level: "warn" });
      return [];
    }
    const result = parseRbiNhbFile(html);
    trace("sidecar", "rbiNhbFetch:success", {
      url,
      periods: result.length,
      sampleFields: result.length > 0 ? Object.keys(result[0]!).filter(k => (result[0] as unknown as Record<string, unknown>)[k] != null).length : 0,
    });
    return result;
  } catch (err) {
    trace("sidecar", "rbiNhbFetch:error", { url, error: String(err), stack: (err as Error)?.stack }, null, { level: "error" });
    return [];
  }
}
