"use client";

import { useCallback, useEffect, useState } from "react";
import { type PaginatedTransactions, type Transaction, transactionsApi } from "@/lib/api";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { formatCategoryLabel, formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

function CategoryCell({ txn, onUpdated }: { txn: Transaction; onUpdated: (t: Transaction) => void }) {
  const [saving, setSaving] = useState(false);

  async function handleChange(value: string) {
    setSaving(true);
    try {
      const updated = await transactionsApi.updateCategory(txn.id, value || null);
      onUpdated(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={txn.effective_category ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="rounded-md px-2 py-1 text-sm disabled:opacity-60"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
      >
        <option value="">{formatCategoryLabel(txn.category_primary)}</option>
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {formatCategoryLabel(c)}
          </option>
        ))}
      </select>
      {txn.category_override && (
        <button
          type="button"
          title="Clear override, revert to Plaid's category"
          onClick={() => handleChange("")}
          disabled={saving}
          className="text-xs disabled:opacity-60"
          style={{ color: "var(--series-1)" }}
        >
          edited ✕
        </button>
      )}
    </div>
  );
}

export default function TransactionsPage() {
  const [data, setData] = useState<PaginatedTransactions | null>(null);
  const [page, setPage] = useState(1);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [category, setCategory] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await transactionsApi.list({
        page,
        pageSize: PAGE_SIZE,
        flaggedOnly,
        category: category || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search || undefined,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [page, flaggedOnly, category, startDate, endDate, search]);

  useEffect(() => {
    load();
  }, [load]);

  function handleRowUpdated(updated: Transaction) {
    setData((prev) =>
      prev ? { ...prev, items: prev.items.map((t) => (t.id === updated.id ? updated : t)) } : prev
    );
  }

  const totalPages = data ? Math.max(Math.ceil(data.total / PAGE_SIZE), 1) : 1;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        Transactions
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search merchant…"
          className="w-48 rounded-md px-3 py-1.5 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
        <select
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
          className="rounded-md px-3 py-1.5 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        >
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {formatCategoryLabel(c)}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setPage(1);
            setStartDate(e.target.value);
          }}
          className="rounded-md px-3 py-1.5 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
        <span style={{ color: "var(--text-muted)" }}>–</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => {
            setPage(1);
            setEndDate(e.target.value);
          }}
          className="rounded-md px-3 py-1.5 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
        <label className="ml-auto flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
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
                    <td className="px-5 py-3">
                      <CategoryCell txn={t} onUpdated={handleRowUpdated} />
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
