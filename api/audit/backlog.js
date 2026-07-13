import { get, list } from "@vercel/blob";
import fs from "node:fs";
import { extractRunIdFromPath, isAuditConfigured, requireAuditReadAuth, sanitizePathSegment } from "./_lib.js";

async function readBlobJson(pathname) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return JSON.parse(text);
}

function loadKnownMappingKeys() {
  const yamlPath = new URL("../../CapitalineIndASDetailedMappingSpec.yaml", import.meta.url);
  const specPath = new URL("../../src/engine/mappingSpec.ts", import.meta.url);
  const texts = [
    fs.readFileSync(yamlPath, "utf8"),
    fs.readFileSync(specPath, "utf8"),
  ];
  const keys = new Set();
  for (const text of texts) {
    const quoted = text.match(/"([^"]+)"/g) ?? [];
    for (const entry of quoted) {
      keys.add(entry.slice(1, -1));
    }
  }
  return keys;
}

const KNOWN_MAPPING_KEYS = loadKnownMappingKeys();

function fallbackOutOfSpecLabels(rawData) {
  const counts = new Map();
  for (const period of rawData ?? []) {
    for (const compositeKey of Object.keys(period.raw_metric_values ?? {})) {
      const idx = compositeKey.lastIndexOf("__");
      if (idx < 0) continue;
      const key = compositeKey.slice(0, idx);
      const statement = compositeKey.slice(idx + 2) || "Unknown";
      if (KNOWN_MAPPING_KEYS.has(key)) continue;
      const scoped = `${statement}||${key}`;
      counts.set(scoped, (counts.get(scoped) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([scoped, periodsObserved]) => {
    const [statement, key] = scoped.split("||");
    return { statement, key, periodsObserved };
  });
}

function fallbackOutOfSpecMetricKeys(rawMetricKeyIndex) {
  if (!Array.isArray(rawMetricKeyIndex)) return null;
  const counts = new Map();
  for (const compositeKey of rawMetricKeyIndex) {
    if (typeof compositeKey !== "string") continue;
    const idx = compositeKey.lastIndexOf("__");
    if (idx < 0) continue;
    const key = compositeKey.slice(0, idx);
    const statement = compositeKey.slice(idx + 2) || "Unknown";
    if (KNOWN_MAPPING_KEYS.has(key)) continue;
    counts.set(`${statement}||${key}`, 1);
  }
  return Array.from(counts.keys()).map((scoped) => {
    const [statement, key] = scoped.split("||");
    return { statement, key, periodsObserved: 1 };
  });
}

function classifyCandidate(statement, key) {
  const label = String(key || "").toLowerCase();
  if (statement === "ProfitLoss") {
    if (/(revenue|sales|profit|tax|finance|interest)/.test(label)) {
      return { businessImpact: "valuation-critical", suggestedTier: "Tier A", impactScore: 5 };
    }
    if (/(depreciation|employee|expense|cost|inventory)/.test(label)) {
      return { businessImpact: "quality-and-forecast", suggestedTier: "Tier C", impactScore: 3 };
    }
  }

  if (statement === "BalanceSheet") {
    if (/(asset|equity|borrow|cash|investment|liabilit|debt)/.test(label)) {
      return { businessImpact: "valuation-critical", suggestedTier: "Tier A", impactScore: 5 };
    }
    if (/(receivable|payable|inventory|ppe|property|plant)/.test(label)) {
      return { businessImpact: "ratio-critical", suggestedTier: "Tier B", impactScore: 4 };
    }
  }

  if (statement === "CashFlow") {
    if (/(operating|fixed assets|capital expenditure|capex)/.test(label)) {
      return { businessImpact: "valuation-critical", suggestedTier: "Tier A", impactScore: 5 };
    }
    if (/(dividend|borrow|issue|investment|sale)/.test(label)) {
      return { businessImpact: "ratio-critical", suggestedTier: "Tier B", impactScore: 4 };
    }
  }

  return { businessImpact: "optional-detail", suggestedTier: "Tier D", impactScore: 1 };
}

function classifyLegacyAction(entry) {
  if (entry?.triage?.action) return entry.triage.action;
  return "review";
}

async function listSnapshotBlobs(limit, runId = null) {
  const result = await list({
    prefix: runId ? `audit-runs/${runId}/events/` : "audit-runs/",
    limit: Math.max(limit * 20, 100),
    mode: "expanded",
  });

  const latestByRun = new Map();
  for (const blob of result.blobs) {
    if (!blob.pathname.endsWith(".json") || !blob.pathname.includes("analysis-snapshot")) continue;
    const blobRunId = extractRunIdFromPath(blob.pathname);
    if (!blobRunId) continue;
    const existing = latestByRun.get(blobRunId);
    if (!existing || new Date(blob.uploadedAt).getTime() > new Date(existing.uploadedAt).getTime()) {
      latestByRun.set(blobRunId, blob);
    }
  }

  return Array.from(latestByRun.values())
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, limit);
}

export default async function handler(request, response) {
  if (!isAuditConfigured()) {
    response.status(503).json({
      error: "Audit storage is not configured. Set BLOB_READ_WRITE_TOKEN on Vercel.",
    });
    return;
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!requireAuditReadAuth(request, response)) return;

  const query = request.query ?? {};
  const runId = typeof query.runId === "string" ? sanitizePathSegment(query.runId) : null;
  const limit =
    typeof query.limit === "string" && Number.isFinite(Number(query.limit))
      ? Math.min(Math.max(Number(query.limit), 1), 100)
      : 25;
  const includeIgnored = query.includeIgnored === "1" || query.includeIgnored === "true" || query.includeIgnored === "yes";

  const snapshotBlobs = await listSnapshotBlobs(limit, runId);
  const aggregated = new Map();
  let policyVersions = null;
  const totalsByAction = {
    "add-to-spec": 0,
    "group-to-existing": 0,
    "ignore-non-core": 0,
    review: 0,
  };

  for (const blob of snapshotBlobs) {
    const parsed = await readBlobJson(blob.pathname);
    const payload = parsed?.payload ?? {};
    const companyId = parsed?.companyId ?? payload.companyId ?? null;
    policyVersions = policyVersions ?? payload.policyVersions ?? null;
    const labels = payload.mappingAudit?.outOfSpecLabels
      ?? fallbackOutOfSpecMetricKeys(payload.rawMetricKeyIndex)
      ?? fallbackOutOfSpecLabels(payload.rawData);

    for (const label of labels) {
      const statement = label.statement ?? "Unknown";
      const key = label.key ?? "";
      const classification = classifyCandidate(statement, key);
      const action = classifyLegacyAction(label);
      totalsByAction[action] += 1;
      const id = `${statement}||${key}`;
      const existing = aggregated.get(id) ?? {
        statement,
        key,
        action,
        priority: label?.triage?.priority ?? "optional",
        rationale: label?.triage?.rationale ?? classification.businessImpact,
        targetLine: label?.triage?.targetLine ?? null,
        suggestedSpecPath: label?.triage?.suggestedSpecPath ?? null,
        businessImpact: classification.businessImpact,
        suggestedTier: classification.suggestedTier,
        impactScore: classification.impactScore,
        runCount: 0,
        companyCount: 0,
        periodsObserved: 0,
        sampleCompanies: [],
        sampleRunIds: [],
      };

      existing.runCount += 1;
      existing.periodsObserved += Number(label.periodsObserved) || 0;
      if (companyId && !existing.sampleCompanies.includes(companyId)) {
        existing.sampleCompanies.push(companyId);
        existing.companyCount += 1;
      }
      if (parsed?.runId && !existing.sampleRunIds.includes(parsed.runId)) {
        existing.sampleRunIds.push(parsed.runId);
      }
      const actionWeight = action === "review" ? 15 : action === "add-to-spec" ? 12 : action === "group-to-existing" ? 6 : 0;
      existing.rankScore = existing.runCount * 8 + existing.companyCount * 10 + existing.periodsObserved + existing.impactScore * 5 + actionWeight;
      aggregated.set(id, existing);
    }
  }

  const entries = Array.from(aggregated.values())
    .filter((entry) => includeIgnored || entry.action !== "ignore-non-core")
    .sort((a, b) => b.rankScore - a.rankScore || b.periodsObserved - a.periodsObserved || a.statement.localeCompare(b.statement) || a.key.localeCompare(b.key))
    .map((entry) => ({
      ...entry,
      sampleCompanies: entry.sampleCompanies.slice(0, 5),
      sampleRunIds: entry.sampleRunIds.slice(0, 5),
    }));

  response.status(200).json({
    generatedAt: new Date().toISOString(),
    scannedRuns: snapshotBlobs.length,
    runId: runId ?? null,
    policyVersions,
    totalsByAction,
    entries,
  });
}
