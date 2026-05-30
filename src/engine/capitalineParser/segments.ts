import { parseSegmentFinanceHTML, SegmentData, AllSegmentData } from "../segmentParser";
import { stmtFromFilename } from "./cells";

export function segmentTypeFromCapitalineFilename(filename: string): SegmentData["segmentationType"] | null {
  const base = filename.split("/").pop() ?? filename;
  const normalized = base.replace(/\s+/g, " ").trim().toLowerCase();

  // Capitaline convention:
  //   SegmentFinance_.xls     = Product / Business
  //   SegmentFinance_ (1).xls = Geographic
  //   SegmentFinance_ (2).xls = Mixed / Total
  if (/^segmentfinance_\.(xls|html?)$/i.test(normalized)) return "business";
  if (/^segmentfinance_\s*\(1\)\.(xls|html?)$/i.test(normalized)) return "geographic";
  if (/^segmentfinance_\s*\(2\)\.(xls|html?)$/i.test(normalized)) return "total";
  return null;
}

/** Phase C5: parse ALL SegmentFinance files from the ZIP into AllSegmentData. */
export async function parseSegmentFilesFromZip(fileEntries: Array<{ name: string; async(type: "arraybuffer"): Promise<ArrayBuffer>; async(type: "text"): Promise<string> } & Record<string, unknown>>): Promise<AllSegmentData | null> {
  const segmentEntries = fileEntries.filter(f => {
    const name = (f.name as string).split("/").pop() || (f.name as string);
    return stmtFromFilename(name) === "Segment";
  });
  if (segmentEntries.length === 0) return null;

  // Parse ALL segment files and collect by deterministic Capitaline filename convention.
  // Do not infer product/geographic/mixed from labels: labels like "MOBILE SERVICES INDIA"
  // are business segments even though they contain geographic words.
  let business: SegmentData | null = null;
  let geographic: SegmentData | null = null;
  let mixed: SegmentData | null = null;

  for (const entry of segmentEntries) {
    try {
      const name = entry.name as string;
      const fileType = segmentTypeFromCapitalineFilename(name);
      const text = await entry.async("text");
      const parsed = parseSegmentFinanceHTML(text);
      if (!parsed || !fileType) continue;

      const typedParsed: SegmentData = { ...parsed, segmentationType: fileType };
      if (fileType === "business") {
        if (!business) business = typedParsed;
      } else if (fileType === "geographic") {
        if (!geographic) geographic = typedParsed;
      } else if (fileType === "total") {
        if (!mixed) mixed = typedParsed;
      }
    } catch {
      // skip unparseable segment files
    }
  }

  if (!business && !geographic && !mixed) return null;
  return { business, geographic, mixed };
}
