import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readZipEntryBounded } from "../capitalineParser";

/** Rewrite every uncompressed-size field so the archive under-declares its content. */
function understateSizes(zip: Uint8Array, declared: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) view.setUint32(i + 22, declared, true); // local file header
    if (sig === 0x02014b50) view.setUint32(i + 24, declared, true); // central directory
  }
  return out;
}

describe("ZIP entry inflation is bounded by what actually comes out", () => {
  it("rejects an entry that inflates past the limit even when its header claims otherwise", async () => {
    const source = new JSZip();
    source.file("BalanceSheet.xls", "a".repeat(4 * 1024 * 1024));
    const honest = await source.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const lying = await JSZip.loadAsync(understateSizes(honest, 100));
    const entry = lying.file("BalanceSheet.xls")!;
    // The header now says 100 bytes, so a header-only check would pass it.
    expect((entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize).toBe(100);

    await expect(readZipEntryBounded(entry, 1024 * 1024, "BalanceSheet.xls")).rejects.toThrow(/inflates past/);
  });

  it("returns the full content of an entry within the limit", async () => {
    const source = new JSZip();
    source.file("ProfitLoss.xls", "row,value\nSales,100\n");
    const zip = await JSZip.loadAsync(await source.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
    const buffer = await readZipEntryBounded(zip.file("ProfitLoss.xls")!, 1024, "ProfitLoss.xls");
    expect(new TextDecoder().decode(buffer)).toBe("row,value\nSales,100\n");
  });
});
