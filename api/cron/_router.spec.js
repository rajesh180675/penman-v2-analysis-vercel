import { describe, expect, it } from "vitest";
import handler, { resolveCronPath } from "./[...path].js";

function responseHarness() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

describe("consolidated Vercel cron routing", () => {
  it("resolves catch-all parameters and URL fallbacks", () => {
    expect(resolveCronPath({ query: { path: ["platform-outbox"] } })).toBe("platform-outbox");
    expect(resolveCronPath({ query: { path: "prune-audit" } })).toBe("prune-audit");
    expect(resolveCronPath({ url: "/api/cron/monitor-audit?limit=10" })).toBe("monitor-audit");
  });

  it("fails closed for an unknown cron route", async () => {
    const response = responseHarness();
    await handler({ query: { path: ["unknown"] } }, response);
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: "Cron route not found." });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
