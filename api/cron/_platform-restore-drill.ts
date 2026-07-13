import { createPlatformRuntime } from "../../server/platform/defaultRuntime";
import { cronAuthorizationMatches, runScheduledRestoreDrills } from "../../server/platform/scheduledOperations";

export default async function handler(request: any, response: any) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.status(405).json({ error: "Method not allowed." }); return; }
  if (!cronAuthorizationMatches(request.headers?.authorization, process.env.CRON_SECRET)) { response.status(401).json({ error: "Unauthorized." }); return; }
  try {
    const adapters = createPlatformRuntime();
    const results = await runScheduledRestoreDrills({ ...adapters, now: new Date().toISOString(), limit: Number(process.env.PLATFORM_RESTORE_DRILL_WORKSPACE_LIMIT ?? 5) });
    const blocked = results.filter((result) => result.status !== "restored").length;
    response.status(blocked ? 503 : 200).json({ ok: blocked === 0, restored: results.length - blocked, blocked, results });
  } catch (error) {
    console.error("Scheduled platform restore drill failed", error instanceof Error ? error.name : "UnknownError");
    response.status(503).json({ ok: false, error: "PLATFORM_RESTORE_DRILL_UNAVAILABLE" });
  }
}
