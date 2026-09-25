/**
 * ChartCard — Panel specialization for charts: consistent header (title,
 * subtitle, optional status dot, header-right controls) wrapping a chart body.
 * Absorbs the wb-chart-card CSS classes into the Panel family.
 */
import { type ReactNode } from "react";
import { Panel, type PanelStatus } from "../shared/Panel";

interface ChartCardProps {
  title: string;
  subtitle?: string | undefined;
  status?: PanelStatus | undefined;
  /** Right-aligned header controls (toggle buttons, legend switches) */
  controls?: ReactNode;
  /** Footer note (source, methodology) */
  footnote?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, status, controls, footnote, className = "", children }: ChartCardProps) {
  return (
    <Panel title={title} subtitle={subtitle} status={status} actions={controls} flush className={className}>
      <div className="px-5 pb-4 pt-3">{children}</div>
      {footnote != null && (
        <div className="px-5 pb-3 -mt-1">
          <p className="text-[11px] wb-text-3">{footnote}</p>
        </div>
      )}
    </Panel>
  );
}
