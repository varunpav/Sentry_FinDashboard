"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  type AccountSummary,
  type CategoryComparisonResponse,
  type FraudFlag,
  type NetWorthPoint,
  type NetWorthSummary,
  type RecurringSeries,
  type SpendingSummary,
  type Transaction,
  budgetsApi,
  fraudApi,
  insightsApi,
  networthApi,
  plaidApi,
  recurringApi,
  transactionsApi,
} from "@/lib/api";
import { formatCategoryLabel, formatCurrency, formatDate } from "@/lib/format";
import { getCategoryColor } from "@/lib/categories";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { Meter } from "@/components/ui/Meter";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { CategoryBarChart } from "@/components/charts/CategoryBarChart";
import { DailySpendLineChart } from "@/components/charts/DailySpendLineChart";
import { NetWorthTrendChart } from "@/components/charts/NetWorthTrendChart";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { CardSkeleton, StatTileSkeleton } from "@/components/ui/Skeleton";

const HISTORY_RANGES = [3, 6, 12] as const;
const BILLS_HORIZONS = [7, 14, 30] as const;
const EXCLUDED_MERCHANT_CATEGORIES = new Set(["TRANSFER_IN", "TRANSFER_OUT", "INCOME", "LOAN_PAYMENTS"]);

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface MerchantTotal {
  merchant: string;
  total: number;
  category: string | null;
}

function topMerchants(transactions: Transaction[], limit = 5): MerchantTotal[] {
  const totals = new Map<string, MerchantTotal>();
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const category = t.effective_category ?? t.category_primary;
    if (category && EXCLUDED_MERCHANT_CATEGORIES.has(category)) continue;
    const key = t.merchant_name || t.name || "Unknown merchant";
    const existing = totals.get(key);
    if (existing) {
      existing.total += t.amount;
    } else {
      totals.set(key, { merchant: key, total: t.amount, category });
    }
  }
  return [...totals.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [monthTxns, setMonthTxns] = useState<Transaction[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthSummary | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthPoint[]>([]);
  const [historyMonths, setHistoryMonths] = useState<(typeof HISTORY_RANGES)[number]>(6);
  const [billsHorizon, setBillsHorizon] = useState<(typeof BILLS_HORIZONS)[number]>(14);
  const [comparison, setComparison] = useState<CategoryComparisonResponse | null>(null);
  const [upcomingBills, setUpcomingBills] = useState<RecurringSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [
        accountsRes,
        summaryRes,
        flagsRes,
        txnsRes,
        monthTxnsRes,
        netWorthRes,
        netWorthHistoryRes,
        comparisonRes,
        upcomingRes,
      ] = await Promise.all([
        plaidApi.listAccounts(),
        budgetsApi.spendingSummary(),
        fraudApi.listFlags("pending"),
        transactionsApi.list({ page: 1, pageSize: 6 }),
        transactionsApi.list({ startDate: firstOfMonthIso(), endDate: todayIso(), pageSize: 200 }),
        networthApi.summary(),
        networthApi.history(historyMonths),
        insightsApi.categoryComparison(),
        recurringApi.upcoming(billsHorizon),
      ]);
      setAccounts(accountsRes);
      setSummary(summaryRes);
      setFlags(flagsRes);
      setRecentTxns(txnsRes.items);
      setMonthTxns(monthTxnsRes.items);
      setNetWorth(netWorthRes);
      setNetWorthHistory(netWorthHistoryRes.points);
      setComparison(comparisonRes);
      setUpcomingBills(upcomingRes);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    // historyMonths/billsHorizon intentionally excluded here — range changes are
    // handled by the lighter-weight effects below so switching a range doesn't
    // reload the whole page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    networthApi
      .history(historyMonths)
      .then((res) => setNetWorthHistory(res.points))
      .catch(() => {});
  }, [historyMonths]);

  useEffect(() => {
    recurringApi
      .upcoming(billsHorizon)
      .then(setUpcomingBills)
      .catch(() => {});
  }, [billsHorizon]);

  const budgetRemaining = summary ? summary.total_budget - summary.total_spent : 0;

  const spendDelta = useMemo(() => {
    if (!comparison) return undefined;
    const current = comparison.categories.reduce((sum, c) => sum + c.current, 0);
    const previous = comparison.categories.reduce((sum, c) => sum + c.previous, 0);
    if (previous === 0) return undefined;
    const pct = Math.round(((current - previous) / previous) * 1000) / 10;
    return {
      value: `${pct >= 0 ? "+" : ""}${pct}% vs last month`,
      direction: (pct === 0 ? "flat" : pct > 0 ? "up" : "down") as "flat" | "up" | "down",
      positiveDirection: "down" as const,
    };
  }, [comparison]);

  const projectedSpend = useMemo(() => {
    if (!summary) return null;
    const now = new Date();
    const daysElapsed = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (daysElapsed <= 0) return summary.total_spent;
    return (summary.total_spent / daysElapsed) * daysInMonth;
  }, [summary]);

  const merchants = useMemo(() => topMerchants(monthTxns), [monthTxns]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
        <CardSkeleton lines={5} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState onRetry={loadData} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Dashboard</h1>
        {accounts.length === 0 && <PlaidLinkButton onLinked={loadData} />}
      </div>

      {accounts.length === 0 && (
        <Card>
          <EmptyState
            icon="wallet"
            title="No account linked yet"
            description="Link a bank account to see your spending breakdown, or run the seed script for demo data."
          />
        </Card>
      )}

      <Card
        action={
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {HISTORY_RANGES.map((m) => (
              <button
                key={m}
                onClick={() => setHistoryMonths(m)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  historyMonths === m ? "bg-surface-2 text-series-1" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {m}mo
              </button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
          <div>
            <p className="text-sm text-text-secondary">Net worth</p>
            <p className={`tabular mt-1 text-3xl font-semibold ${(netWorth?.net_worth ?? 0) < 0 ? "text-status-critical" : "text-text-primary"}`}>
              {formatCurrency(netWorth?.net_worth ?? 0)}
            </p>
            {netWorth?.change_30d != null && (
              <p className={`mt-1 text-sm font-medium ${netWorth.change_30d >= 0 ? "text-status-good-text" : "text-status-critical"}`}>
                {netWorth.change_30d >= 0 ? "+" : ""}
                {formatCurrency(netWorth.change_30d)}
                {netWorth.change_30d_pct != null &&
                  ` (${netWorth.change_30d_pct >= 0 ? "+" : ""}${netWorth.change_30d_pct}%)`}{" "}
                <span className="font-normal text-text-muted">30d</span>
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="h-2 w-2 rounded-full bg-series-5" />
                  Assets
                </span>
                <span className="tabular text-text-primary">{formatCurrency(netWorth?.assets ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="h-2 w-2 rounded-full bg-status-critical" />
                  Liabilities
                </span>
                <span className="tabular text-text-primary">{formatCurrency(netWorth?.liabilities ?? 0)}</span>
              </div>
            </div>
          </div>
          <NetWorthTrendChart data={netWorthHistory} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Spent this month" value={formatCurrency(summary?.total_spent ?? 0)} delta={spendDelta} />
        <StatTile
          label="Budget remaining"
          value={formatCurrency(budgetRemaining)}
          tone={budgetRemaining < 0 ? "critical" : undefined}
        />
        <StatTile
          label="Open fraud alerts"
          value={String(flags.length)}
          tone={flags.length > 0 ? "warning" : undefined}
        />
        <StatTile label="Linked accounts" value={String(accounts.length)} />
      </div>

      {summary && summary.total_budget > 0 && (
        <Card title="Budget pace" subtitle="Projected from this month's spending so far">
          <Meter spent={summary.total_spent} limit={summary.total_budget} projected={projectedSpend ?? undefined} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Spending by category">
          <CategoryBarChart data={summary?.by_category ?? []} />
        </Card>
        <Card title="Top merchants this month">
          {merchants.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">No spending recorded for this month yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {merchants.map((m) => (
                <li key={m.merchant} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: getCategoryColor(m.category) }}
                    />
                    <span className="truncate text-text-primary">{m.merchant}</span>
                  </span>
                  <span className="tabular shrink-0 font-medium text-text-primary">{formatCurrency(m.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Daily spend this month">
        <DailySpendLineChart data={summary?.daily_spend ?? []} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          title="Recent transactions"
          action={
            <Link href="/transactions" className="text-sm font-medium text-series-1">
              View all
            </Link>
          }
        >
          {recentTxns.length === 0 ? (
            <p className="text-sm text-text-muted">No transactions yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recentTxns.map((t) => (
                <li key={t.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-text-primary">{t.merchant_name || t.name || "Transaction"}</p>
                    <p className="text-text-muted">
                      {formatDate(t.date)} · {formatCategoryLabel(t.effective_category ?? t.category_primary)}
                    </p>
                  </div>
                  <span className={`tabular shrink-0 ${t.amount > 0 ? "text-text-primary" : "text-status-good-text"}`}>
                    {t.amount > 0 ? "-" : "+"}
                    {formatCurrency(Math.abs(t.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Fraud alerts"
          action={
            <Link href="/alerts" className="text-sm font-medium text-series-1">
              View all
            </Link>
          }
        >
          {flags.length === 0 ? (
            <p className="text-sm text-text-muted">No open alerts. Nice.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {flags.slice(0, 5).map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-text-primary">{f.merchant_name || "Unknown merchant"}</p>
                    <span className="tabular shrink-0 text-status-critical">{formatCurrency(f.amount)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-text-muted">{f.reasons[0]}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Upcoming bills"
          action={
            <Link href="/recurring" className="text-sm font-medium text-series-1">
              View all
            </Link>
          }
        >
          <div className="mb-3 flex gap-1">
            {BILLS_HORIZONS.map((d) => (
              <button
                key={d}
                onClick={() => setBillsHorizon(d)}
                className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                  billsHorizon === d
                    ? "border-border bg-surface-2 text-series-1"
                    : "border-transparent text-text-muted hover:text-text-secondary"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          {upcomingBills.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing due in the next {billsHorizon} days.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {upcomingBills.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-text-primary">{s.display_name}</p>
                    <p className="text-text-muted">{formatDate(s.next_due_date)}</p>
                  </div>
                  <span className="tabular shrink-0 text-text-primary">{formatCurrency(s.expected_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
