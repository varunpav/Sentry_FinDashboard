"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type FraudFeedbackSummary, type FraudFlag, fraudApi } from "@/lib/api";
import { formatCategoryLabel, formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, SeverityBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

type TabKey = "pending" | "confirmed" | "dismissed" | undefined;

// The backend never exposes its scoring cutoff, so severity here is a relative
// ranking within whatever's currently on screen (lower/more-negative
// decision_function = more anomalous — see backend/app/services/fraud_service.py),
// not an absolute risk score. Good enough for "which of these needs my attention
// first," not meant to be precise for a list of one or two.
function computeSeverities(flags: FraudFlag[]): Map<number, "critical" | "serious" | "warning"> {
  const sorted = [...flags].sort((a, b) => a.anomaly_score - b.anomaly_score);
  const map = new Map<number, "critical" | "serious" | "warning">();
  sorted.forEach((f, i) => {
    const frac = sorted.length > 1 ? i / (sorted.length - 1) : 0;
    map.set(f.id, frac < 0.34 ? "critical" : frac < 0.67 ? "serious" : "warning");
  });
  return map;
}

export default function AlertsPage() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [feedback, setFeedback] = useState<FraudFeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async (status?: TabKey) => {
    setLoading(true);
    setError(false);
    try {
      setFlags(await fraudApi.listFlags(status));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFeedback = useCallback(async () => {
    fraudApi.feedback().then(setFeedback).catch(() => {});
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  async function handleUpdate(id: number, status: "confirmed" | "dismissed") {
    setUpdatingId(id);
    try {
      await fraudApi.updateStatus(id, status);
      showToast(status === "confirmed" ? "Marked as confirmed fraud." : "Dismissed.", "success");
      await load(tab);
      await loadFeedback();
    } catch {
      showToast("Failed to update alert.", "error");
    } finally {
      setUpdatingId(null);
    }
  }

  const severities = useMemo(() => computeSeverities(flags), [flags]);
  const sortedFlags = useMemo(
    () => [...flags].sort((a, b) => a.anomaly_score - b.anomaly_score),
    [flags]
  );

  const tabs: TabItem<TabKey>[] = [
    { key: "pending", label: "Pending", count: feedback?.pending_count },
    { key: "confirmed", label: "Confirmed", count: feedback?.confirmed_count },
    { key: "dismissed", label: "Dismissed", count: feedback?.dismissed_count },
    { key: undefined, label: "All" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Fraud alerts" />

      {feedback && (feedback.dismissed_count > 0 || feedback.confirmed_count > 0) && (
        <Card className="!py-3">
          <p className="text-sm text-text-secondary">
            Learned from {feedback.dismissed_count} dismissal{feedback.dismissed_count === 1 ? "" : "s"} ·{" "}
            {feedback.confirmed_count} confirmed
          </p>
          {feedback.suppressed_merchants.length > 0 && (
            <p className="mt-0.5 text-sm text-text-muted">
              Raised the bar for:{" "}
              {feedback.suppressed_merchants.map((m) => `${m.merchant} (${m.dismissals})`).join(", ")}
            </p>
          )}
        </Card>
      )}

      <Tabs items={tabs} active={tab} onChange={setTab} />

      {loading ? (
        <CardSkeleton lines={4} />
      ) : error ? (
        <Card>
          <ErrorState onRetry={() => load(tab)} />
        </Card>
      ) : sortedFlags.length === 0 ? (
        <Card>
          <EmptyState icon="shield" title="No alerts in this view" description="Nothing here needs your attention." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedFlags.map((f) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-text-primary">{f.merchant_name || "Unknown merchant"}</p>
                    {f.status === "pending" && <SeverityBadge severity={severities.get(f.id) ?? "warning"} />}
                    <StatusBadge status={f.status} />
                  </div>
                  <p className="text-sm text-text-muted">
                    {formatDate(f.date)} · {formatCategoryLabel(f.category_primary)}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-text-secondary">
                    {f.reasons.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                  <Link
                    href={`/transactions?flagged=1&search=${encodeURIComponent(f.merchant_name || "")}`}
                    className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-series-1"
                  >
                    View transaction {Icon.externalLink({ size: 12 })}
                  </Link>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="tabular text-lg font-semibold text-status-critical">
                    {formatCurrency(f.amount)}
                  </span>
                  {f.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleUpdate(f.id, "dismissed")} disabled={updatingId === f.id}>
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleUpdate(f.id, "confirmed")}
                        disabled={updatingId === f.id}
                      >
                        Confirm fraud
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
