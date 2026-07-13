import type { SourceArtifactHash } from "../../engine/capitalineParser";
import { Card } from "./debugUi";

interface Props {
  hashes?: SourceArtifactHash[] | null | undefined;
}

export function SourceLineageCard({ hashes }: Props) {
  if (!hashes?.length) return null;

  return (
    <Card title="Source Lineage — SHA-256">
      <div className="space-y-2">
        <p className="text-xs text-slate-500">
          Per-file hash of uncompressed source artifacts inside the ZIP. These flow into the
          traceability envelope for reviewer provenance.
        </p>
        {hashes.map((h) => (
          <div key={h.fileName} className="flex items-center gap-2 text-xs font-mono">
            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 shrink-0">{h.fileName}</span>
            <span className="text-slate-400">{(h.byteLength / 1024).toFixed(1)} KB</span>
            <span className="text-slate-600 truncate" title={h.sha256}>{h.sha256.slice(0, 16)}…{h.sha256.slice(-8)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
