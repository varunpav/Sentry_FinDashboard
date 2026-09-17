import { Icon } from "./Icons";

export function EmptyState({
  icon = "list",
  title,
  description,
  action,
}: {
  icon?: keyof typeof Icon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const IconCmp = Icon[icon];
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-text-muted">
        {IconCmp({ size: 20 })}
      </div>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description && <p className="max-w-xs text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-status-critical-bg text-status-critical">
        {Icon.alertTriangle({ size: 20 })}
      </div>
      <p className="text-sm font-medium text-text-primary">{message}</p>
      <p className="max-w-xs text-sm text-text-muted">
        Couldn&apos;t reach the server. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2"
      >
        Retry
      </button>
    </div>
  );
}
