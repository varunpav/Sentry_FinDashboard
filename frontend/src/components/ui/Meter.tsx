import { formatCurrency } from "@/lib/format";

export function Meter({ spent, limit }: { spent: number; limit: number }) {
  const ratio = limit > 0 ? spent / limit : 0;
  const pct = Math.min(ratio, 1) * 100;

  const fillColor =
    ratio > 1 ? "var(--status-critical)" : ratio >= 0.8 ? "var(--status-warning)" : "var(--series-1)";

  const statusText =
    ratio > 1
      ? `Over budget by ${formatCurrency(spent - limit)}`
      : `${formatCurrency(Math.max(limit - spent, 0))} remaining`;

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span style={{ color: "var(--text-primary)" }}>
          {formatCurrency(spent)}{" "}
          <span style={{ color: "var(--text-muted)" }}>/ {formatCurrency(limit)}</span>
        </span>
        <span style={{ color: ratio > 1 ? "var(--status-critical)" : "var(--text-secondary)" }}>
          {statusText}
        </span>
      </div>
      <div
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--gridline)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: fillColor }}
        />
      </div>
    </div>
  );
}
