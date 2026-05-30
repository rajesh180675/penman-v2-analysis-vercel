export type CVMethod = "CV1" | "CV2" | "CV3";

export const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const fmtPerShare = (n: number | null | undefined) => n == null ? "—" : `₹${n.toFixed(2)}`;

export function makeCvSel(cv: CVMethod) {
  return <T,>(v1: T, v2: T, v3: T): T => cv === "CV1" ? v1 : cv === "CV2" ? v2 : v3;
}
