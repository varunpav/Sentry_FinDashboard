"use client";

import { useCallback, useEffect, useState } from "react";
import { type PaginatedTransactions, transactionsApi } from "@/lib/api";
import { formatCategoryLabel, formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";

const PAGE_SIZE = 20;

export default function TransactionsPage() {
  const [data, setData] = useState<PaginatedTransactions | null>(null);
  const [page, setPage] = useState(1);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await transactionsApi.list({ page, pageSize: PAGE_SIZE, flaggedOnly });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [page, flaggedOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.max(Math.ceil(data.total / PAGE_SIZE), 1) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Transactions
        </h1>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => {
              setPage(1);
              setFlaggedOnly(e.target.checked);
            }}
          />
          Flagged only
        </label>
      </div>

      <Card className="!p-0">
        {loading ? (
          <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>
            Loading…
          </p>
        ) : !data || data.items.length === 0 ? (
          <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>
            No transactions found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Date", "Merchant", "Category", "Account", "Amount", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left font-medium"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                    <td className="px-5 py-3" style={{ color: "var(--text-secondary)" }}>
                      {formatDate(t.date)}
                    </td>
                    <td className="px-5 py-3" style={{ color: "var(--text-primary)" }}>
                      {t.merchant_name || t.name || "—"}
                      {t.pending && (
                        <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                          (pending)
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3" style={{ color: "var(--text-secondary)" }}>
                      {formatCategoryLabel(t.category_primary)}
                    </td>
                    <td className="px-5 py-3" style={{ color: "var(--text-secondary)" }}>
                      {t.account_name || "—"}
                    </td>
                    <td
                      className="px-5 py-3 font-medium"
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        color: t.amount > 0 ? "var(--text-primary)" : "var(--status-good-text)",
                      }}
                    >
                      {t.amount > 0 ? "-" : "+"}
                      {formatCurrency(Math.abs(t.amount))}
                    </td>
                    <td className="px-5 py-3">{t.is_flagged && <StatusBadge status="pending" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="rounded-md px-3 py-1.5 disabled:opacity-40"
              style={{ border: "1px solid var(--border)" }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              className="rounded-md px-3 py-1.5 disabled:opacity-40"
              style={{ border: "1px solid var(--border)" }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
