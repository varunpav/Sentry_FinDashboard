import { formatCurrency } from "@/lib/format";

export function Meter({
  spent,
  limit,
  projected,
}: {
  spent: number;
  limit: number;
  /** Projected end-of-period spend, shown as a marker on the track (burn-rate). */
  projected?: number;
}) {
  const ratio = limit > 0 ? spent / limit : 0;
  const pct = Math.min(ratio, 1) * 100;

  const fillColorClass = ratio > 1 ? "bg-status-critical" : ratio >= 0.8 ? "bg-status-warning" : "bg-series-1";

  const statusText =
    ratio > 1
      ? `Over budget by ${formatCurrency(spent - limit)}`
      : `${formatCurrency(Math.max(limit - spent, 0))} remaining`;

  const projectedPct = projected != null && limit > 0 ? Math.min((projected / limit) * 100, 100) : null;
  const projectedOver = projected != null && limit > 0 && projected > limit;

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="tabular text-text-primary">
          {formatCurrency(spent)} <span className="text-text-muted">/ {formatCurrency(limit)}</span>
        </span>
        <span className={ratio > 1 ? "text-status-critical" : "text-text-secondary"}>{statusText}</span>
      </div>
      <div className="relative mt-2 h-2.5 w-full overflow-visible rounded-full bg-gridline">
        <div className={`h-full rounded-full transition-all ${fillColorClass}`} style={{ width: `${pct}%` }} />
        {projectedPct !== null && (
          <div
            className={`absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full ${
              projectedOver ? "bg-status-critical" : "bg-text-muted"
            }`}
            style={{ left: `calc(${projectedPct}% - 1px)` }}
            title={`Projected: ${formatCurrency(projected!)}`}
          />
        )}
      </div>
      {projected != null && (
        <p className="mt-1 text-xs text-text-muted">
          On pace for {formatCurrency(projected)}
          {projectedOver ? " — projected to go over" : ""} by month end
        </p>
      )}
    </div>
  );
}
