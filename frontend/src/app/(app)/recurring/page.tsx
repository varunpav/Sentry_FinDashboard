"use client";

import { useCallback, useEffect, useState } from "react";
import { type RecurringSeries, recurringApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";

const CADENCE_LABEL: Record<RecurringSeries["cadence"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annually",
};

function CadenceBadge({ cadence }: { cadence: RecurringSeries["cadence"] }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        color: "var(--series-1)",
        background: "var(--surface-2)",
        border: "1px solid var(--series-1)",
      }}
    >
      {CADENCE_LABEL[cadence]}
    </span>
  );
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function DueLabel({ dateStr }: { dateStr: string }) {
  const days = daysUntil(dateStr);
  let text = formatDate(dateStr);
  let tone = "var(--text-secondary)";
  if (days < 0) {
    text = `${formatDate(dateStr)} (overdue)`;
    tone = "var(--status-critical)";
  } else if (days === 0) {
    text = "Due today";
    tone = "var(--status-warning)";
  } else if (days <= 7) {
    text = `${formatDate(dateStr)} (in ${days}d)`;
    tone = "var(--status-warning)";
  }
  return <span style={{ color: tone }}>{text}</span>;
}

function SeriesRow({
  series,
  onToggleMute,
  busy,
}: {
  series: RecurringSeries;
  onToggleMute: (series: RecurringSeries) => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3" style={{ borderTop: "1px solid var(--gridline)" }}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium" style={{ color: "var(--text-primary)" }}>
            {series.display_name}
          </p>
          <CadenceBadge cadence={series.cadence} />
        </div>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Next due: <DueLabel dateStr={series.next_due_date} />
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {formatCurrency(series.expected_amount)}
        </span>
        <button
          onClick={() => onToggleMute(series)}
          disabled={busy}
          className="rounded-md px-3 py-1 text-xs font-medium disabled:opacity-60"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {series.is_muted ? "Unmute" : "Mute"}
        </button>
      </div>
    </div>
  );
}

export default function RecurringPage() {
  const [allSeries, setAllSeries] = useState<RecurringSeries[]>([]);
  const [totalMonthlyCost, setTotalMonthlyCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recurringApi.list();
      setAllSeries(res.series);
      setTotalMonthlyCost(res.total_monthly_cost);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await recurringApi.refresh();
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleToggleMute(series: RecurringSeries) {
    setBusyId(series.id);
    try {
      await recurringApi.setMuted(series.id, !series.is_muted);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const active = allSeries.filter((s) => s.status === "active" && !s.is_muted);
  const muted = allSeries.filter((s) => s.is_muted);
  const inactive = allSeries.filter((s) => s.status === "inactive" && !s.is_muted);
  const upcoming = [...active].sort(
    (a, b) => new Date(a.next_due_date).getTime() - new Date(b.next_due_date).getTime()
  );

  if (loading) {
    return <p style={{ color: "var(--text-muted)" }}>Loading recurring charges…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Recurring charges
        </h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {refreshing ? "Refreshing…" : "Re-scan transactions"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile label="Active subscriptions & bills" value={String(active.length)} />
        <StatTile label="Total monthly cost" value={formatCurrency(totalMonthlyCost)} />
      </div>

      <Card title="Upcoming, soonest first">
        {upcoming.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing detected yet. Sync transactions or run the seed script, then re-scan.
          </p>
        ) : (
          <div className="flex flex-col">
            {upcoming.map((s) => (
              <SeriesRow key={s.id} series={s} onToggleMute={handleToggleMute} busy={busyId === s.id} />
            ))}
          </div>
        )}
      </Card>

      {(muted.length > 0 || inactive.length > 0) && (
        <Card title="Muted & inactive">
          <div className="flex flex-col">
            {[...muted, ...inactive].map((s) => (
              <SeriesRow key={s.id} series={s} onToggleMute={handleToggleMute} busy={busyId === s.id} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
