/**
 * EmptyState — standard no-data placeholder for every view.
 * Replaces hand-rolled `card-base p-12 text-center` + emoji blocks.
 */
import { Icon, type IconName } from "./Icon";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string | undefined;
  /** Optional call-to-action */
  action?: { label: string; onClick: () => void } | undefined;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="wb-surface rounded-xl border p-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl wb-accent-bg flex items-center justify-center mb-4">
        <Icon name={icon} size={24} className="wb-accent" />
      </div>
      <p className="text-lg font-semibold wb-text-2">{title}</p>
      {body && <p className="text-sm wb-text-3 mt-2 max-w-md mx-auto">{body}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
