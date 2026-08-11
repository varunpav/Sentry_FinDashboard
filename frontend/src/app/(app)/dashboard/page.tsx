"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  type AccountSummary,
  type FraudFlag,
  type NetWorthPoint,
  type NetWorthSummary,
  type RecurringSeries,
  type SpendingSummary,
  type Transaction,
  budgetsApi,
  fraudApi,
  networthApi,
  plaidApi,
  recurringApi,
  transactionsApi,
} from "@/lib/api";
import { formatCategoryLabel, formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { CategoryBarChart } from "@/components/charts/CategoryBarChart";
import { DailySpendLineChart } from "@/components/charts/DailySpendLineChart";
import { NetWorthTrendChart } from "@/components/charts/NetWorthTrendChart";

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthSummary | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthPoint[]>([]);
  const [upcomingBills, setUpcomingBills] = useState<RecurringSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accountsRes, summaryRes, flagsRes, txnsRes, netWorthRes, netWorthHistoryRes, upcomingRes] =
        await Promise.all([
          plaidApi.listAccounts().catch(() => []),
          budgetsApi.spendingSummary(),
          fraudApi.listFlags("pending").catch(() => []),
          transactionsApi
            .list({ page: 1, pageSize: 6 })
            .catch(() => ({ items: [], total: 0, page: 1, page_size: 6 })),
          networthApi.summary().catch(() => null),
          networthApi.history(6).catch(() => ({ points: [] })),
          recurringApi.upcoming(14).catch(() => []),
        ]);
      setAccounts(accountsRes);
      setSummary(summaryRes);
      setFlags(flagsRes);
      setRecentTxns(txnsRes.items);
      setNetWorth(netWorthRes);
      setNetWorthHistory(netWorthHistoryRes.points);
      setUpcomingBills(upcomingRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const results = await plaidApi.sync();
      const added = results.reduce((sum, r) => sum + r.added, 0);
      const newFlags = results.reduce((sum, r) => sum + r.new_fraud_flags, 0);
      setSyncMessage(`Synced ${added} new transaction(s), ${newFlags} new fraud flag(s).`);
      await loadData();
    } catch {
      setSyncMessage("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const budgetRemaining = summary ? summary.total_budget - summary.total_spent : 0;

  if (loading) {
    return <p style={{ color: "var(--text-muted)" }}>Loading dashboard…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Dashboard
        </h1>
        {accounts.length === 0 ? (
          <PlaidLinkButton onLinked={loadData} />
        ) : (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            {syncing ? "Syncing…" : "Sync transactions"}
          </button>
        )}
      </div>

      {syncMessage && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{syncMessage}</p>}

      {accounts.length === 0 && (
        <Card>
          <p style={{ color: "var(--text-secondary)" }}>
            Link a bank account to see your spending breakdown, or run the seed script for demo data.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Net worth"
          value={formatCurrency(netWorth?.net_worth ?? 0)}
          tone={(netWorth?.net_worth ?? 0) < 0 ? "critical" : undefined}
        />
        <StatTile label="Spent this month" value={formatCurrency(summary?.total_spent ?? 0)} />
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
      </div>

      <Card
        title="Net worth trend"
        action={
          netWorth?.change_30d !== null && netWorth?.change_30d !== undefined ? (
            <span
              className="text-sm font-medium"
              style={{ color: netWorth.change_30d >= 0 ? "var(--status-good-text)" : "var(--status-critical)" }}
            >
              {netWorth.change_30d >= 0 ? "+" : ""}
              {formatCurrency(netWorth.change_30d)} (30d)
            </span>
          ) : undefined
        }
      >
        <NetWorthTrendChart data={netWorthHistory} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Spending by category">
          <CategoryBarChart data={summary?.by_category ?? []} />
        </Card>
        <Card title="Daily spend this month">
          <DailySpendLineChart data={summary?.daily_spend ?? []} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Recent transactions" action={<Link href="/transactions" className="text-sm font-medium" style={{ color: "var(--series-1)" }}>View all</Link>}>
          {recentTxns.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No transactions yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recentTxns.map((t) => (
                <li key={t.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p style={{ color: "var(--text-primary)" }}>{t.merchant_name || t.name || "Transaction"}</p>
                    <p style={{ color: "var(--text-muted)" }}>
                      {formatDate(t.date)} · {formatCategoryLabel(t.category_primary)}
                    </p>
                  </div>
                  <span style={{ color: t.amount > 0 ? "var(--text-primary)" : "var(--status-good-text)" }}>
                    {t.amount > 0 ? "-" : "+"}
                    {formatCurrency(Math.abs(t.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Fraud alerts" action={<Link href="/alerts" className="text-sm font-medium" style={{ color: "var(--series-1)" }}>View all</Link>}>
          {flags.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No open alerts. Nice.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {flags.slice(0, 5).map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex items-center justify-between">
                    <p style={{ color: "var(--text-primary)" }}>{f.merchant_name || "Unknown merchant"}</p>
                    <span style={{ color: "var(--status-critical)" }}>{formatCurrency(f.amount)}</span>
                  </div>
                  <p style={{ color: "var(--text-muted)" }}>{f.reasons[0]}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Upcoming bills" action={<Link href="/recurring" className="text-sm font-medium" style={{ color: "var(--series-1)" }}>View all</Link>}>
          {upcomingBills.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nothing due in the next 2 weeks.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {upcomingBills.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p style={{ color: "var(--text-primary)" }}>{s.display_name}</p>
                    <p style={{ color: "var(--text-muted)" }}>{formatDate(s.next_due_date)}</p>
                  </div>
                  <span style={{ color: "var(--text-primary)" }}>{formatCurrency(s.expected_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
