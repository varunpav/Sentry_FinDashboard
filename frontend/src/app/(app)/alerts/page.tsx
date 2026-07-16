"use client";

import { useCallback, useEffect, useState } from "react";
import { type FraudFlag, fraudApi } from "@/lib/api";
import { formatCategoryLabel, formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";

const TABS: { key: string | undefined; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "dismissed", label: "Dismissed" },
  { key: undefined, label: "All" },
];

export default function AlertsPage() {
  const [tab, setTab] = useState<string | undefined>("pending");
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      setFlags(await fraudApi.listFlags(status));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function handleUpdate(id: number, status: "confirmed" | "dismissed") {
    setUpdatingId(id);
    try {
      await fraudApi.updateStatus(id, status);
      await load(tab);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        Fraud alerts
      </h1>

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.label}
            onClick={() => setTab(t.key)}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              color: tab === t.key ? "var(--series-1)" : "var(--text-secondary)",
              background: tab === t.key ? "var(--surface-1)" : "transparent",
              border: tab === t.key ? "1px solid var(--border)" : "1px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading…
        </p>
      ) : flags.length === 0 ? (
        <Card>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No alerts in this view.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {flags.map((f) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                      {f.merchant_name || "Unknown merchant"}
                    </p>
                    <StatusBadge status={f.status} />
                  </div>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {formatDate(f.date)} · {formatCategoryLabel(f.category_primary)}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                    {f.reasons.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-lg font-semibold" style={{ color: "var(--status-critical)" }}>
                    {formatCurrency(f.amount)}
                  </span>
                  {f.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdate(f.id, "dismissed")}
                        disabled={updatingId === f.id}
                        className="rounded-md px-3 py-1 text-xs font-medium disabled:opacity-60"
                        style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => handleUpdate(f.id, "confirmed")}
                        disabled={updatingId === f.id}
                        className="rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
                        style={{ background: "var(--status-critical)" }}
                      >
                        Confirm fraud
                      </button>
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
