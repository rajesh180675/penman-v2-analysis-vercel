import type { Request, Response } from "express";
import { createDefaultProductionPlatformRuntime } from "./defaultRuntime";

let runtime: ReturnType<typeof createDefaultProductionPlatformRuntime> | null = null;

function platformPath(url: string | undefined): string {
  const parsed = new URL(url ?? "/", "http://platform.local");
  const routed = parsed.pathname.replace(/^\/api\/platform(?:\/v1)?/, "") || "/";
  return `${routed}${parsed.search}`;
}

/** Vercel Node adapter for the Express platform router, with a warm runtime singleton. */
export default function platformVercelHandler(request: Request, response: Response): void {
  response.setHeader("Cache-Control", "no-store");
  try {
    runtime ??= createDefaultProductionPlatformRuntime();
    request.url = platformPath(request.url);
    runtime.router(request, response, (error?: unknown) => {
      if (response.headersSent) return;
      if (error) console.error("Platform request failed", error instanceof Error ? error.name : "UnknownError");
      response.status(error ? 500 : 404).json({ ok: false, error: error ? "PLATFORM_REQUEST_FAILED" : "PLATFORM_ROUTE_NOT_FOUND" });
    });
  } catch (error) {
    console.error("Platform runtime unavailable", error instanceof Error ? error.name : "UnknownError");
    response.status(503).json({ ok: false, error: "PLATFORM_RUNTIME_UNAVAILABLE" });
  }
}
