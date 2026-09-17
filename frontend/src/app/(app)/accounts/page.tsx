"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AccountSummary,
  type NetWorthSummary,
  networthApi,
  plaidApi,
} from "@/lib/api";
import { formatCurrency, titleCase } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/Meter";
import { Icon } from "@/components/ui/Icons";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { CardSkeleton, StatTileSkeleton } from "@/components/ui/Skeleton";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";
import { useToast } from "@/components/ui/Toast";

const TYPE_GROUP_ORDER = ["depository", "credit", "loan", "investment", "other"];
const TYPE_GROUP_LABEL: Record<string, string> = {
  depository: "Cash accounts",
  credit: "Credit cards",
  loan: "Loans",
  investment: "Investments",
  other: "Other accounts",
};
const TYPE_GROUP_ICON: Record<string, keyof typeof Icon> = {
  depository: "building",
  credit: "creditCard",
  loan: "piggyBank",
  investment: "chart",
  other: "wallet",
};

function groupKey(type: string | null): string {
  const t = (type || "").toLowerCase();
  return TYPE_GROUP_ORDER.includes(t) ? t : "other";
}

function AccountCard({ account }: { account: AccountSummary }) {
  const isCredit = groupKey(account.type) === "credit";
  const balanceIsLiability = isCredit || groupKey(account.type) === "loan";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{account.name}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {account.institution_name || "Unknown institution"}
            {account.mask ? ` · ••${account.mask}` : ""}
          </p>
        </div>
        {account.subtype && (
          <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-secondary">
            {titleCase(account.subtype)}
          </span>
        )}
      </div>

      <p className={`tabular mt-4 text-2xl font-semibold ${balanceIsLiability ? "text-status-critical" : "text-text-primary"}`}>
        {formatCurrency(account.current_balance ?? 0)}
      </p>
      {account.available_balance != null && !isCredit && (
        <p className="tabular mt-1 text-xs text-text-muted">
          {formatCurrency(account.available_balance)} available
        </p>
      )}

      {isCredit && account.credit_limit != null && account.credit_limit > 0 && (
        <div className="mt-4">
          <Meter spent={account.current_balance ?? 0} limit={account.credit_limit} />
        </div>
      )}
    </Card>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [netWorth, setNetWorth] = useState<NetWorthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [accountsRes, netWorthRes] = await Promise.all([plaidApi.listAccounts(), networthApi.summary()]);
      setAccounts(accountsRes);
      setNetWorth(netWorthRes);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefreshBalances() {
    setRefreshing(true);
    try {
      const res = await plaidApi.refreshBalances();
      showToast(`Refreshed ${res.accounts_updated} account balance(s).`, "success");
      await load();
    } catch {
      showToast("Failed to refresh balances.", "error");
    } finally {
      setRefreshing(false);
    }
  }

  const groups = TYPE_GROUP_ORDER.map((key) => ({
    key,
    accounts: (accounts ?? []).filter((a) => groupKey(a.type) === key),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Balances across every linked account."
        action={
          accounts && accounts.length > 0 ? (
            <>
              <Button size="sm" onClick={handleRefreshBalances} loading={refreshing}>
                {!refreshing && Icon.refresh({ size: 14 })}
                Refresh balances
              </Button>
              <PlaidLinkButton onLinked={load} />
            </>
          ) : undefined
        }
      />

      {loading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </div>
        </>
      ) : error ? (
        <Card>
          <ErrorState onRetry={load} />
        </Card>
      ) : !accounts || accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon="wallet"
            title="No accounts linked yet"
            description="Link a bank account to see balances here, or run the seed script for demo data."
            action={<PlaidLinkButton onLinked={load} />}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Assets" value={formatCurrency(netWorth?.assets ?? 0)} />
            <StatTile
              label="Liabilities"
              value={formatCurrency(netWorth?.liabilities ?? 0)}
              tone={(netWorth?.liabilities ?? 0) > 0 ? "warning" : undefined}
            />
            <StatTile
              label="Net worth"
              value={formatCurrency(netWorth?.net_worth ?? 0)}
              tone={(netWorth?.net_worth ?? 0) < 0 ? "critical" : "good"}
            />
          </div>

          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                {Icon[TYPE_GROUP_ICON[group.key]]({ size: 15 })}
                {TYPE_GROUP_LABEL[group.key]}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.accounts.map((account) => (
                  <AccountCard key={account.id} account={account} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
