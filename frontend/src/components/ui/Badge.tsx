const STATUS_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  pending: { color: "var(--status-warning)", icon: "⚠", label: "Pending review" },
  confirmed: { color: "var(--status-critical)", icon: "✕", label: "Confirmed fraud" },
  dismissed: { color: "var(--status-good-text)", icon: "✓", label: "Dismissed" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { color: "var(--text-muted)", icon: "•", label: status };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color: config.color, background: "var(--surface-2)", border: `1px solid ${config.color}` }}
    >
      <span aria-hidden>{config.icon}</span>
      {config.label}
    </span>
  );
}
