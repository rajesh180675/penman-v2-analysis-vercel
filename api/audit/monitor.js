import {
  getMonitorReport,
  listMonitorReports,
  requireMonitorAuth,
  runAuditMonitor,
} from "./monitor-lib.js";
import { assertContentLength, readJsonBody, respondJsonBodyError } from "./_lib.js";

export default async function handler(request, response) {
  const start = Date.now();

  try {
    if (!requireMonitorAuth(request, response)) return;

    if (request.method === "GET") {
      const runId = typeof request.query?.runId === "string" ? request.query.runId : null;
      console.log(JSON.stringify({ level: "info", msg: "monitor.get.start", route: "/api/audit/monitor", runId }));

      const payload = runId
        ? await getMonitorReport(runId)
        : await listMonitorReports(
            typeof request.query?.limit === "string" ? Number(request.query.limit) : 25
          );

      response.status(200).json(payload ?? { error: "Monitor report not found." });
      console.log(JSON.stringify({ level: "info", msg: "monitor.get.done", route: "/api/audit/monitor", ms: Date.now() - start }));
      return;
    }

    if (request.method === "POST") {
      console.log(JSON.stringify({ level: "info", msg: "monitor.post.start", route: "/api/audit/monitor" }));
      const maxBodyBytes = 64 * 1024;
      if (!assertContentLength(request, response, maxBodyBytes)) return;
      let body;
      try {
        body = await readJsonBody(request, maxBodyBytes);
      } catch (error) {
        if (respondJsonBodyError(response, error)) return;
        throw error;
      }
      const payload = await runAuditMonitor({
        runId: body?.runId,
        limit: body?.limit,
      });
      response.status(200).json(payload);
      console.log(JSON.stringify({ level: "info", msg: "monitor.post.done", route: "/api/audit/monitor", ms: Date.now() - start }));
      return;
    }

    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      msg: "monitor.failed",
      route: "/api/audit/monitor",
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - start,
    }));
    response.status(500).json({
      error: error instanceof Error ? error.message : "Monitor failed.",
    });
  }
}
