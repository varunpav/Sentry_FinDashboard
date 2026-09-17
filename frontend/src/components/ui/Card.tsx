export function Card({
  children,
  className = "",
  title,
  subtitle,
  action,
  footer,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  /** Set false for content that manages its own padding, e.g. a table. */
  padded?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface-1 ${padded ? "p-5" : ""} ${className}`}>
      {(title || action) && (
        <div className={`flex items-center justify-between ${padded ? "mb-4" : "p-5 pb-0"}`}>
          <div>
            {title && <h3 className="text-sm font-medium text-text-secondary">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
      {footer && (
        <div className={`border-t border-border ${padded ? "-mx-5 -mb-5 mt-4 px-5 py-3" : "mt-0 px-5 py-3"}`}>
          {footer}
        </div>
      )}
    </div>
  );
}
