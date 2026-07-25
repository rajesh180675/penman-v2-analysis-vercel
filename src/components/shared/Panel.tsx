/**
 * Panel — the ONE card component for the Workbench UI.
 * Absorbs .card-base / .card-elevated / hand-rolled card variants.
 *
 * Design rules (see docs/greenfield-ui-redesign.md):
 * - Semantic wb-* token classes only — dark-mode contrast by construction.
 * - Optional trust status dot in the header.
 * - Collapsible sections render a one-line summary in the header row so
 *   users get the key fact without expanding.
 */
import { ReactNode, useState } from "react";
import { Icon } from "./Icon";

export type PanelStatus = "production" | "guarded" | "blocked" | "research" | "idle";

interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Trust status dot shown before the title */
  status?: PanelStatus | undefined;
  /** Teal advanced-model variant (user preference) */
  variant?: "default" | "advanced" | undefined;
  /** Right-aligned header actions (buttons, badges) */
  actions?: ReactNode;
  /** Collapsible — shows chevron + summary when closed */
  collapsible?: boolean | undefined;
  defaultCollapsed?: boolean | undefined;
  /** One-line fact visible even when collapsed (e.g. "Moat: 72/100 — Wide") */
  summary?: ReactNode;
  /** Remove default padding for tables/charts that manage their own */
  flush?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Panel({
  title,
  subtitle,
  status,
  variant = "default",
  actions,
  collapsible = false,
  defaultCollapsed = false,
  summary,
  flush = false,
  className = "",
  children,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const hasHeader = title != null || actions != null || collapsible;

  const surface = variant === "advanced"
    ? "wb-panel-advanced rounded-xl border shadow-sm"
    : "wb-surface rounded-xl border shadow-sm";

  const header = hasHeader && (
    <div
      className={`flex items-center justify-between gap-3 ${flush ? "px-5 pt-4" : "px-5 pt-4"} ${collapsible ? "cursor-pointer select-none" : ""}`}
      onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
      role={collapsible ? "button" : undefined}
      aria-expanded={collapsible ? !collapsed : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        {collapsible && (
          <Icon
            name="chevron-right"
            size={14}
            className={`wb-text-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        )}
        {status && <span className={`wb-status-dot wb-status-dot-${status}`} aria-label={`status: ${status}`} />}
        {title != null && (
          <span className="text-sm font-semibold wb-text-1 truncate">{title}</span>
        )}
        {subtitle != null && <span className="text-xs wb-text-3 truncate">{subtitle}</span>}
        {collapsible && collapsed && summary != null && (
          <span className="text-xs wb-text-2 truncate ml-1">— {summary}</span>
        )}
      </div>
      {actions != null && (
        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );

  return (
    <section className={`${surface} ${className}`}>
      {header}
      {!collapsed && (
        <div className={`${flush ? "" : "px-5 py-4"} ${hasHeader && !flush ? "pt-3" : ""}`}>
          {children}
        </div>
      )}
      {collapsed && <div className="pb-4" />}
    </section>
  );
}

/** StatusDot — standalone trust dot for nav items and inline use */
export function StatusDot({ status, title }: { status: PanelStatus; title?: string | undefined }) {
  return <span className={`wb-status-dot wb-status-dot-${status}`} title={title} />;
}
