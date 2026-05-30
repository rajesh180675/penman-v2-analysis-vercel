export const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: d });

export function cagr(first: number, last: number, years: number): number | null {
  if (first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

export async function sha256Hex(input: string | Blob): Promise<string> {
  const buffer = typeof input === "string" ? new TextEncoder().encode(input).buffer : await input.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
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

export async function bytesLength(input: string | Blob): Promise<number> {
  if (typeof input === "string") return new TextEncoder().encode(input).length;
  return input.size;
}

export function avg(vals: Array<number | null | undefined>): number | null {
  const f = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!f.length) return null;
  return f.reduce((s, v) => s + v, 0) / f.length;
}

export function median(vals: Array<number | null | undefined>): number | null {
  const f = vals.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!f.length) return null;
  const m = Math.floor(f.length / 2);
  return f.length % 2 === 0 ? (f[m - 1]! + f[m]!) / 2 : f[m]!;
}

export function madSigma(vals: number[]): number {
  if (vals.length < 2) return 0;
  const med = median(vals);
  if (med == null) return 0;
  const deviations = vals.map((v) => Math.abs(v - med));
  const mad = median(deviations);
  return (mad ?? 0) * 1.4826;
}

export const escapeCsvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
