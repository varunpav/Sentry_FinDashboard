import { Icon } from "./Icons";
import { Sparkline } from "../charts/Sparkline";

type Tone = "good" | "warning" | "critical";

const TONE_CLASS: Record<Tone, string> = {
  critical: "text-status-critical",
  warning: "text-status-warning",
  good: "text-status-good-text",
};

export interface StatDelta {
  value: string;
  direction: "up" | "down" | "flat";
  /** Whether "up" is good news for this metric (spend vs. net worth read oppositely). */
  positiveDirection?: "up" | "down";
}

export function StatTile({
  label,
  value,
  tone,
  delta,
  sparkline,
}: {
  label: string;
  value: string;
  tone?: Tone;
  delta?: StatDelta;
  sparkline?: number[];
}) {
  const toneClass = tone ? TONE_CLASS[tone] : "text-text-primary";

  let deltaClass = "text-text-secondary";
  if (delta && delta.direction !== "flat") {
    const isPositive = delta.direction === (delta.positiveDirection ?? "up");
    deltaClass = isPositive ? "text-status-good-text" : "text-status-critical";
  }

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-text-secondary">{label}</p>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} className="h-6 w-16 shrink-0 text-series-1" />
        )}
      </div>
      <p className={`tabular mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {delta && (
        <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${deltaClass}`}>
          {delta.direction === "up" && Icon.arrowUp({ size: 12 })}
          {delta.direction === "down" && Icon.arrowDown({ size: 12 })}
          {delta.value}
        </p>
      )}
    </div>
  );
}
