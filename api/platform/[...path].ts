import type { Request, Response } from "express";
import platformHealthHandler from "../../server/platform/healthHandler";
import platformVercelHandler from "../../server/platform/vercelHandler";

export function resolvePlatformPath(request: Request): string {
  const parameter = request.query?.path;
  if (Array.isArray(parameter)) return parameter.join("/");
  if (typeof parameter === "string") return parameter.replace(/^\/+|\/+$/g, "");
  const pathname = new URL(request.url ?? "/", "https://platform.local").pathname;
  return pathname.replace(/^\/api\/platform\/?/, "").replace(/^\/+|\/+$/g, "");
}

/** Consolidate public deployment health and authenticated platform APIs into one Vercel function. */
export default async function handler(request: Request, response: Response): Promise<void> {
  if (resolvePlatformPath(request) === "health") {
    await platformHealthHandler(request, response);
    return;
  }
  platformVercelHandler(request, response);
}
