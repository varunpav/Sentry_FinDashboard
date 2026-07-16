"use client";

import { useCallback, useEffect, useState } from "react";
import { type Budget, budgetsApi } from "@/lib/api";
import { formatCategoryLabel } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Meter";

const EXPENSE_CATEGORIES = [
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
  "OTHER",
];

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBudgets(await budgetsApi.list());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedLimit = Number(limit);
    if (!parsedLimit || parsedLimit <= 0) {
      setError("Enter a monthly limit greater than 0.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await budgetsApi.upsert(category, parsedLimit);
      setLimit("");
      await load();
    } catch {
      setError("Failed to save budget.");
    } finally {
      setSaving(false);
    }
  }

  const budgetedCategories = new Set(budgets.map((b) => b.category));
  const availableCategories = EXPENSE_CATEGORIES.filter((c) => !budgetedCategories.has(c));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        Budgets
      </h1>

      <Card title="Set a monthly budget">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            >
              {(availableCategories.includes(category) ? availableCategories : [category, ...availableCategories]).map((c) => (
                <option key={c} value={c}>
                  {formatCategoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Monthly limit
            <input
              type="number"
              min={1}
              step="0.01"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="500"
              className="w-32 rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {saving ? "Saving…" : "Save budget"}
          </button>
        </form>
        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        )}
      </Card>

      <Card title="This month">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading…
          </p>
        ) : budgets.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No budgets set yet. Add one above.
          </p>
        ) : (
          <ul className="flex flex-col gap-5">
            {budgets.map((b) => (
              <li key={b.id}>
                <p className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {formatCategoryLabel(b.category)}
                </p>
                <Meter spent={b.spent} limit={b.monthly_limit} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
