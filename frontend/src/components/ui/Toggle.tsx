export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {label}
        </p>
        {description && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60"
        style={{ background: checked ? "var(--series-1)" : "var(--gridline)" }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
        />
      </button>
    </label>
  );
}
