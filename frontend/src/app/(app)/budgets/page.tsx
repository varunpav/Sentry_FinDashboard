"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type Budget, budgetsApi } from "@/lib/api";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { currentMonth, formatCategoryLabel, formatCurrency, formatMonthLabel } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Meter } from "@/components/ui/Meter";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

function projectedSpendFor(month: string, spent: number): number | undefined {
  if (month !== currentMonth()) return undefined;
  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (daysElapsed <= 0) return spent;
  return (spent / daysElapsed) * daysInMonth;
}

export default function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setBudgets(await budgetsApi.list(month));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedLimit = Number(limit);
    if (!parsedLimit || parsedLimit <= 0) {
      setFormError("Enter a monthly limit greater than 0.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      // PUT /budgets always returns spent: 0.0 — never trust that field, refetch instead.
      await budgetsApi.upsert(category, parsedLimit);
      setLimit("");
      showToast(`Saved budget for ${formatCategoryLabel(category)}.`, "success");
      await load();
    } catch {
      showToast("Failed to save budget.", "error");
    } finally {
      setSaving(false);
    }
  }

  const budgetedCategories = new Set(budgets.map((b) => b.category));
  const availableCategories = EXPENSE_CATEGORIES.filter((c) => !budgetedCategories.has(c));

  const totals = useMemo(() => {
    const spent = budgets.reduce((sum, b) => sum + b.spent, 0);
    const limitSum = budgets.reduce((sum, b) => sum + b.monthly_limit, 0);
    return { spent, limit: limitSum };
  }, [budgets]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Budgets" action={<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />} />

      <Card title="Set a monthly budget">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            wrapperClassName="w-48"
          >
            {(availableCategories.includes(category) ? availableCategories : [category, ...availableCategories]).map(
              (c) => (
                <option key={c} value={c}>
                  {formatCategoryLabel(c)}
                </option>
              )
            )}
          </Select>
          <Input
            label="Monthly limit"
            type="number"
            min={1}
            step="0.01"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="500"
            wrapperClassName="w-32"
          />
          <Button type="submit" variant="primary" loading={saving}>
            Save budget
          </Button>
        </form>
        {formError && <p className="mt-2 text-sm text-status-critical">{formError}</p>}
      </Card>

      {loading ? (
        <CardSkeleton lines={4} />
      ) : error ? (
        <Card>
          <ErrorState onRetry={load} />
        </Card>
      ) : (
        <Card
          title={formatMonthLabel(month)}
          subtitle={
            budgets.length > 0
              ? `${formatCurrency(totals.spent)} spent of ${formatCurrency(totals.limit)} budgeted`
              : undefined
          }
        >
          {budgets.length === 0 ? (
            <EmptyState icon="piggyBank" title="No budgets set for this month" description="Add one above to start tracking a category." />
          ) : (
            <ul className="flex flex-col gap-5">
              {budgets.map((b) => (
                <li key={b.id}>
                  <p className="mb-2 text-sm font-medium text-text-primary">{formatCategoryLabel(b.category)}</p>
                  <Meter spent={b.spent} limit={b.monthly_limit} projected={projectedSpendFor(month, b.spent)} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
