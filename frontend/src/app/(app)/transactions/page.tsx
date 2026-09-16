"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type AccountSummary,
  type PaginatedTransactions,
  type Transaction,
  exportApi,
  plaidApi,
  transactionsApi,
} from "@/lib/api";
import { EXPENSE_CATEGORIES, getCategoryColor } from "@/lib/categories";
import { formatCategoryLabel, formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const SEARCH_DEBOUNCE_MS = 350;

type SortKey = "date" | "amount";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  sortableKey,
  sortKey,
  sortDir,
  onToggle,
}: {
  label: string;
  sortableKey: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onToggle: (key: SortKey) => void;
}) {
  const active = sortKey === sortableKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortableKey)}
      className="flex items-center gap-1 font-medium text-text-muted hover:text-text-primary"
    >
      {label}
      {active && (sortDir === "asc" ? Icon.arrowUp({ size: 12 }) : Icon.arrowDown({ size: 12 }))}
    </button>
  );
}

function defaultCsvRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

function TransactionDetailDrawer({
  txn,
  onClose,
  onUpdated,
}: {
  txn: Transaction | null;
  onClose: () => void;
  onUpdated: (t: Transaction) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleCategoryChange(value: string) {
    if (!txn) return;
    setSaving(true);
    try {
      const updated = await transactionsApi.updateCategory(txn.id, value || null);
      onUpdated(updated);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={!!txn} onClose={onClose} title="Transaction detail">
      {txn && (
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-lg font-semibold text-text-primary">{txn.merchant_name || txn.name || "Transaction"}</p>
            <p className={`tabular mt-1 text-2xl font-semibold ${txn.amount > 0 ? "text-text-primary" : "text-status-good-text"}`}>
              {txn.amount > 0 ? "-" : "+"}
              {formatCurrency(Math.abs(txn.amount))}
            </p>
          </div>

          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Date</dt>
              <dd className="text-text-primary">{formatDate(txn.date)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Account</dt>
              <dd className="text-text-primary">{txn.account_name || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Plaid category</dt>
              <dd className="text-text-primary">{formatCategoryLabel(txn.category_primary)}</dd>
            </div>
            {txn.category_detailed && (
              <div className="flex items-center justify-between">
                <dt className="text-text-muted">Detailed category</dt>
                <dd className="text-text-primary">{formatCategoryLabel(txn.category_detailed)}</dd>
              </div>
            )}
            {txn.payment_channel && (
              <div className="flex items-center justify-between">
                <dt className="text-text-muted">Payment channel</dt>
                <dd className="text-text-primary">{formatCategoryLabel(txn.payment_channel)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Status</dt>
              <dd className="text-text-primary">
                {txn.pending ? "Pending" : "Posted"}
                {txn.is_flagged && (
                  <span className="ml-2">
                    <StatusBadge status="pending" />
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-sm font-medium text-text-secondary">Your category</p>
            <div className="flex items-center gap-2">
              <Select
                value={txn.effective_category ?? ""}
                onChange={(e) => handleCategoryChange(e.target.value)}
                disabled={saving}
              >
                <option value="">{formatCategoryLabel(txn.category_primary)} (Plaid default)</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {formatCategoryLabel(c)}
                  </option>
                ))}
              </Select>
              {txn.category_override && (
                <Button size="sm" variant="ghost" onClick={() => handleCategoryChange("")} disabled={saving}>
                  Clear override
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

// Reads the ?search=&flagged=1 deep link that Alerts uses to jump here pre-filtered
// to the transaction behind a fraud flag. useSearchParams needs a Suspense boundary
// around it in the App Router, hence the wrapper component below.
function TransactionsPageInner() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search") ?? "";
  const initialFlagged = searchParams.get("flagged") === "1";

  const [data, setData] = useState<PaginatedTransactions | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [flaggedOnly, setFlaggedOnly] = useState(initialFlagged);
  const [category, setCategory] = useState("");
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [exporting, setExporting] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    plaidApi.listAccounts().then(setAccounts).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await transactionsApi.list({
        page,
        pageSize,
        flaggedOnly,
        category: category || undefined,
        accountId,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search || undefined,
      });
      setData(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, flaggedOnly, category, accountId, startDate, endDate, search]);

  useEffect(() => {
    load();
  }, [load]);

  function handleRowUpdated(updated: Transaction) {
    setData((prev) =>
      prev ? { ...prev, items: prev.items.map((t) => (t.id === updated.id ? updated : t)) } : prev
    );
    setSelectedTxn((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Sorting only reorders the currently-loaded page — the backend has no sort
  // parameter, and re-sorting across pages would need a new endpoint. Server order
  // (date desc) is the default and matches this column's default direction.
  const sortedItems = useMemo(() => {
    const items = data?.items ?? [];
    if (!sortKey) return items;
    const sorted = [...items].sort((a, b) => {
      const av = sortKey === "date" ? a.date : a.amount;
      const bv = sortKey === "date" ? b.date : b.amount;
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [data, sortKey, sortDir]);

  async function handleExport() {
    setExporting(true);
    try {
      const range = startDate && endDate ? { start: startDate, end: endDate } : defaultCsvRange();
      await exportApi.transactionsCsv(range.start, range.end);
    } catch {
      showToast("Export failed.", "error");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = data ? Math.max(Math.ceil(data.total / pageSize), 1) : 1;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Transactions"
        action={
          <Button size="sm" onClick={handleExport} loading={exporting}>
            {!exporting && Icon.download({ size: 14 })}
            Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search merchant…"
          className="w-48"
        />
        <Select
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
        >
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {formatCategoryLabel(c)}
            </option>
          ))}
        </Select>
        <Select
          value={accountId ?? ""}
          onChange={(e) => {
            setPage(1);
            setAccountId(e.target.value ? Number(e.target.value) : undefined);
          }}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.mask ? ` ••${a.mask}` : ""}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          value={startDate}
          onChange={(e) => {
            setPage(1);
            setStartDate(e.target.value);
          }}
        />
        <span className="text-text-muted">–</span>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => {
            setPage(1);
            setEndDate(e.target.value);
          }}
        />
        <label className="ml-auto flex items-center gap-2 text-sm text-text-secondary">
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

      <Card padded={false}>
        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon="list" title="No transactions found" description="Try widening your filters, or sync your accounts." />
        ) : (
          <div className="max-h-[65vh] overflow-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-surface-1">
                <tr className="border-b border-border">
                  <th className="px-5 py-3 text-left">
                    <SortHeader label="Date" sortableKey="date" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  </th>
                  <th className="px-5 py-3 text-left font-medium text-text-muted">Merchant</th>
                  <th className="px-5 py-3 text-left font-medium text-text-muted">Category</th>
                  <th className="px-5 py-3 text-left font-medium text-text-muted">Account</th>
                  <th className="px-5 py-3 text-left">
                    <SortHeader label="Amount" sortableKey="amount" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  </th>
                  <th className="px-5 py-3 text-left font-medium text-text-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTxn(t)}
                    className="cursor-pointer border-b border-gridline last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-5 py-3 text-text-secondary">{formatDate(t.date)}</td>
                    <td className="px-5 py-3 text-text-primary">
                      {t.merchant_name || t.name || "—"}
                      {t.pending && <span className="ml-2 text-xs text-text-muted">(pending)</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-text-secondary">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: getCategoryColor(t.effective_category ?? t.category_primary) }}
                        />
                        {formatCategoryLabel(t.effective_category ?? t.category_primary)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-text-secondary">{t.account_name || "—"}</td>
                    <td
                      className={`tabular px-5 py-3 font-medium ${t.amount > 0 ? "text-text-primary" : "text-status-good-text"}`}
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

      {data && data.items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={pageSize}
              onChange={(e) => {
                setPage(1);
                setPageSize(Number(e.target.value));
              }}
              className="!py-1"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </div>
          {data.total > pageSize && (
            <div className="flex items-center gap-3">
              <span>
                Page {page} of {totalPages} · {data.total} total
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1}>
                  Previous
                </Button>
                <Button size="sm" onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <TransactionDetailDrawer txn={selectedTxn} onClose={() => setSelectedTxn(null)} onUpdated={handleRowUpdated} />
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
      <TransactionsPageInner />
    </Suspense>
  );
}
