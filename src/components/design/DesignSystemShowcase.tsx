/**
 * Design System Showcase — renders every Workbench primitive in one place so
 * light/dark contrast and component regressions can be eyeballed at a glance.
 * Dev-only surface (see docs/greenfield-ui-redesign.md §2.7 "design checklist").
 * Toggle dark mode from the header to compare both token sets.
 */
import { Panel } from "../shared/Panel";
import { Metric } from "../shared/Metric";
import { EmptyState } from "../shared/EmptyState";
import { RigorStepper, type RigorCheckpointLike } from "../shared/RigorStepper";
import { Icon, type IconName } from "../shared/Icon";
import { SectionHeader } from "../shared/DesignSystem";

const ICONS: IconName[] = [
  "trend-up", "trend-down", "trend-flat", "shield-check", "shield-warning",
  "shield-x", "shield", "doc", "chart", "table", "flask", "bank", "users",
  "book", "gear", "search", "moon", "sun", "link", "chevron-right",
  "chevron-down", "alert-triangle", "info", "download", "printer", "filter",
  "x", "folder", "gauge", "compass", "satellite", "layers", "scale", "target",
  "microscope", "wrench", "database", "calculator", "trending-up", "currency",
  "mirror", "building", "keyboard", "command", "upload", "document", "refresh",
  "zap", "droplet", "anchor", "flag", "bell",
];

const RIGOR: RigorCheckpointLike[] = [
  { level: "syntactically-valid", label: "Syntactically valid", achieved: true },
  { level: "structurally-reconciled", label: "Structurally reconciled", achieved: true },
  { level: "economically-plausible", label: "Economically plausible", achieved: false, detail: "Anchor missing" },
  { level: "valuation-eligible", label: "Valuation eligible", achieved: false },
  { level: "production-ready", label: "Production-ready", achieved: false },
];

export default function DesignSystemShowcase() {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Design System"
        subtitle="Workbench primitives — toggle dark mode to verify both token sets"
        icon="layers"
      />

      <Panel title="Panel" subtitle="The one card surface — default, advanced (teal), with status dot">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Panel title="Default panel"><p className="text-sm wb-text-2">Standard content card.</p></Panel>
          <Panel title="Advanced panel" variant="advanced"><p className="text-sm wb-text-2">Teal advanced-model variant.</p></Panel>
          <Panel title="With status" status="guarded" subtitle="blocked gate"><p className="text-sm wb-text-2">Trust dot in header.</p></Panel>
        </div>
      </Panel>

      <Panel title="Metric" subtitle="KPI tiles — value, trend, context">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric label="ROCE" value={0.185} format="pct" trend={0.021} context="5Y avg" />
          <Metric label="Asset Turnover" value={1.42} format="mult" trend={-0.01} />
          <Metric label="Intrinsic Value" value={1234} format="currency" context="₹1100–1380" />
          <Metric label="Earnings Quality" value="84/100" context="4 of 4 dimensions measured" />
        </div>
      </Panel>

      <Panel title="Rigor stepper" subtitle="The 5-gate trust ladder">
        <RigorStepper checkpoints={RIGOR} />
      </Panel>

      <Panel title="Empty state">
        <EmptyState
          icon="chart"
          title="No data loaded"
          body="Upload a Capitaline ZIP or pick a company from the library to begin."
          action={{ label: "Load data", onClick: () => {} }}
        />
      </Panel>

      <Panel title="Status badges" subtitle="Financial semantics">
        <div className="flex flex-wrap gap-2">
          <span className="badge-positive">positive</span>
          <span className="badge-negative">negative</span>
          <span className="badge-caution">caution</span>
          <span className="badge-neutral">neutral</span>
        </div>
      </Panel>

      <Panel title="Icon set" subtitle={`${ICONS.length} inline SVG glyphs — replace all emoji`}>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
          {ICONS.map((name) => (
            <div key={name} className="flex flex-col items-center gap-1 py-2 rounded-lg wb-surface-inset">
              <span className="wb-text-2"><Icon name={name} size={18} /></span>
              <span className="text-[9px] wb-text-3 font-mono">{name}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
