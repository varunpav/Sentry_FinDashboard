import { Icon } from "./Icons";
import type { RecurringSeries } from "@/lib/api";

const STATUS_CONFIG: Record<string, { className: string; icon: keyof typeof Icon; label: string }> = {
  pending: { className: "text-status-warning border-status-warning", icon: "alertTriangle", label: "Pending review" },
  confirmed: { className: "text-status-critical border-status-critical", icon: "x", label: "Confirmed fraud" },
  dismissed: { className: "text-status-good-text border-status-good", icon: "check", label: "Dismissed" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { className: "text-text-muted border-border", icon: undefined, label: status };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface-2 px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      {config.icon && Icon[config.icon]({ size: 12 })}
      {config.label}
    </span>
  );
}

const CADENCE_LABEL: Record<RecurringSeries["cadence"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annually",
};

export function CadenceBadge({ cadence }: { cadence: RecurringSeries["cadence"] }) {
  return (
    <span className="inline-flex items-center rounded-full border border-series-1 bg-surface-2 px-2.5 py-1 text-xs font-medium text-series-1">
      {CADENCE_LABEL[cadence]}
    </span>
  );
}

export function StabilityBadge({ stability }: { stability: RecurringSeries["amount_stability"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border bg-surface-2 px-2 py-0.5 text-xs font-medium ${
        stability === "fixed"
          ? "border-border text-text-secondary"
          : "border-status-warning text-status-warning"
      }`}
    >
      {stability === "fixed" ? "Fixed amount" : "Variable amount"}
    </span>
  );
}

type Severity = "critical" | "serious" | "warning";

const SEVERITY_CONFIG: Record<Severity, { className: string; label: string }> = {
  critical: { className: "text-status-critical border-status-critical", label: "High risk" },
  serious: { className: "text-status-serious border-status-serious", label: "Elevated risk" },
  warning: { className: "text-status-warning border-status-warning", label: "Worth a look" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border bg-surface-2 px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {Icon.alertTriangle({ size: 11 })}
      {config.label}
    </span>
  );
}

// Recurring-series detection confidence (0-1) as three filled/unfilled dots — a
// quiet quality signal rather than a number that invites false precision.
export function ConfidenceDots({ confidence }: { confidence: number }) {
  const filled = confidence >= 0.85 ? 3 : confidence >= 0.6 ? 2 : 1;
  const label =
    filled === 3 ? "High confidence" : filled === 2 ? "Medium confidence" : "Low confidence";
  return (
    <span className="inline-flex items-center gap-1" title={`${label} (${Math.round(confidence * 100)}%)`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < filled ? "bg-series-1" : "bg-gridline"}`}
        />
      ))}
    </span>
  );
}
