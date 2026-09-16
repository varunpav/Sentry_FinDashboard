"use client";

import { useCallback, useEffect, useState } from "react";
import { type RecurringSeries, recurringApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Button } from "@/components/ui/Button";
import { CadenceBadge, ConfidenceDots, StabilityBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { CardSkeleton, StatTileSkeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function DueLabel({ dateStr }: { dateStr: string }) {
  const days = daysUntil(dateStr);
  let text = formatDate(dateStr);
  let className = "text-text-secondary";
  if (days < 0) {
    text = `${formatDate(dateStr)} (overdue)`;
    className = "text-status-critical";
  } else if (days === 0) {
    text = "Due today";
    className = "text-status-warning";
  } else if (days <= 7) {
    text = `${formatDate(dateStr)} (in ${days}d)`;
    className = "text-status-warning";
  }
  return <span className={className}>{text}</span>;
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
    <div className="flex items-center justify-between gap-4 border-t border-gridline py-3 first:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-text-primary">{series.display_name}</p>
          <CadenceBadge cadence={series.cadence} />
          <StabilityBadge stability={series.amount_stability} />
          <ConfidenceDots confidence={series.confidence} />
        </div>
        <p className="text-sm text-text-muted">
          Next due: <DueLabel dateStr={series.next_due_date} /> · {series.occurrences} charge
          {series.occurrences === 1 ? "" : "s"} since {formatDate(series.first_seen)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="tabular text-sm font-semibold text-text-primary">{formatCurrency(series.expected_amount)}</span>
        <Button size="sm" onClick={() => onToggleMute(series)} disabled={busy}>
          {series.is_muted ? "Unmute" : "Mute"}
        </Button>
      </div>
    </div>
  );
}

export default function RecurringPage() {
  const [allSeries, setAllSeries] = useState<RecurringSeries[]>([]);
  const [totalMonthlyCost, setTotalMonthlyCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await recurringApi.list();
      setAllSeries(res.series);
      setTotalMonthlyCost(res.total_monthly_cost);
    } catch {
      setError(true);
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
      const res = await recurringApi.refresh();
      showToast(`Re-scanned: ${res.active} active, ${res.inactive} inactive.`, "success");
      await load();
    } catch {
      showToast("Refresh failed.", "error");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleToggleMute(series: RecurringSeries) {
    setBusyId(series.id);
    try {
      await recurringApi.setMuted(series.id, !series.is_muted);
      await load();
    } catch {
      showToast("Failed to update mute state.", "error");
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Recurring charges</h1>
        <Button onClick={handleRefresh} loading={refreshing}>
          {!refreshing && Icon.refresh({ size: 14 })}
          Re-scan transactions
        </Button>
      </div>

      {loading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatTileSkeleton />
            <StatTileSkeleton />
          </div>
          <CardSkeleton lines={5} />
        </>
      ) : error ? (
        <Card>
          <ErrorState onRetry={load} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatTile label="Active subscriptions & bills" value={String(active.length)} />
            <StatTile label="Total monthly cost" value={formatCurrency(totalMonthlyCost)} />
          </div>

          <Card title="Upcoming, soonest first">
            {upcoming.length === 0 ? (
              <EmptyState
                icon="repeat"
                title="Nothing detected yet"
                description="Sync transactions or run the seed script, then re-scan."
              />
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
        </>
      )}
    </div>
  );
}
