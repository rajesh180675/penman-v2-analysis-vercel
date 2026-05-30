import { buildForecastProvenance } from "../../engine/forecastPresentation";

export default function ProvenancePanel({
  provenance,
}: {
  provenance: ReturnType<typeof buildForecastProvenance>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
      <div className="font-semibold text-slate-800">Forecast provenance</div>
      <div>Engine version: <b>{provenance.engineVersion || "unversioned"}</b></div>
      <div>Valuation policy: <b>{provenance.valuationPolicyVersion || "unversioned"}</b></div>
      <div>Traceability schema: <b>{provenance.traceabilitySchemaVersion || "unversioned"}</b></div>
      <div>Latest period: <b>{provenance.latestPeriod ?? "—"}</b></div>
      <div>Anchor period: <b>{provenance.anchorPeriod ?? "—"}</b>{provenance.fallbackUsed ? " · fallback anchor in use" : ""}</div>
      {provenance.generatedAt && <div>Generated at: <b>{provenance.generatedAt}</b></div>}
      {provenance.hasIncompleteVersionMetadata && (
        <div className="mt-2 text-amber-700">
          Version metadata is incomplete; treat this forecast as unverified against the current valuation rule set.
        </div>
      )}
    </div>
  );
}
