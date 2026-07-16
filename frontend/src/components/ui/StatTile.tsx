export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warning" | "critical";
}) {
  const toneColor =
    tone === "critical"
      ? "var(--status-critical)"
      : tone === "warning"
      ? "var(--status-warning)"
      : tone === "good"
      ? "var(--status-good-text)"
      : "var(--text-primary)";

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
    >
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold" style={{ color: toneColor }}>
        {value}
      </p>
    </div>
  );
}
