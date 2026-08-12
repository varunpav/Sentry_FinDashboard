"use client";

const STOPS = [1, 3, 6, 12, 24, 48];
const LABELS = ["1h", "3h", "6h", "12h", "Daily", "2 days"];

export function IntervalSlider({
  hours,
  onChange,
}: {
  hours: number;
  onChange: (hours: number) => void;
}) {
  const index = Math.max(STOPS.indexOf(hours), 0);

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <input
        type="range"
        min={0}
        max={STOPS.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(STOPS[Number(e.target.value)])}
        className="w-full"
        style={{ accentColor: "var(--series-1)" }}
      />
      <div className="flex justify-between text-xs">
        {LABELS.map((label, i) => (
          <span
            key={label}
            style={{
              color: i === index ? "var(--series-1)" : "var(--text-muted)",
              fontWeight: i === index ? 600 : 400,
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
