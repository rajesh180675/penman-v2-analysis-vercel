/**
 * EvidenceRail — 3-zone canvas "Zone C": collapsible evidence sections, each
 * with a one-line summary visible while closed. (Moved out of the deleted
 * Primitives.tsx; built on the standalone Panel + Icon.)
 */
import { ReactNode, useState } from "react";
import { Panel } from "./Panel";
import { Icon } from "./Icon";

interface EvidenceItemProps {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function EvidenceItem({ summary, children, defaultOpen = false }: EvidenceItemProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="wb-evidence-item w-full text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="wb-evidence-summary">{summary}</span>
        <Icon
          name="chevron-right"
          size={14}
          className={`wb-evidence-chevron ${open ? "wb-evidence-chevron-open" : ""}`}
        />
      </button>
      {open && <div className="px-4 py-3 border-b wb-divider">{children}</div>}
    </div>
  );
}

interface EvidenceRailProps {
  children: ReactNode;
  title?: string;
}

export function EvidenceRail({ children, title = "Evidence" }: EvidenceRailProps) {
  return (
    <Panel title={title} className="mt-6">
      <div className="divide-y wb-divider">{children}</div>
    </Panel>
  );
}
