/* ── Pure formatters / async crypto helpers for DebugPanel ──────────
   Extracted verbatim from DebugPanel.tsx. No logic changes. */

import type { RecastPeriod } from "../../engine/types";

export async function sha256HexString(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function escapeCsvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function PBTStr(is: RecastPeriod["is"]): string {
  const pbt = is.PAT + is.TaxExpense;
  if (pbt > 0 && is.TaxExpense > 0) {
    return `${is.TaxExpense.toLocaleString("en-IN", { maximumFractionDigits: 2 })} / PBT ≈ ${((is.TaxExpense / pbt) * 100).toFixed(1)}%`;
  }
  return "N/A";
}
