"use client";

import { useCallback, useEffect, useState } from "react";
import { type Goal, goalsApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Meter";
import { StatTile } from "@/components/ui/StatTile";

function ContributeControl({ goal, onContributed }: { goal: Goal; onContributed: () => void }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleContribute() {
    const parsed = Number(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      await goalsApi.contribute(goal.id, parsed);
      setAmount("");
      onContributed();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount"
        className="w-24 rounded-md px-2 py-1 text-sm"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
      />
      <button
        onClick={handleContribute}
        disabled={saving}
        className="rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
        style={{ background: "var(--series-1)" }}
      >
        {saving ? "Adding…" : "Contribute"}
      </button>
    </div>
  );
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [totalSaved, setTotalSaved] = useState(0);
  const [totalTarget, setTotalTarget] = useState(0);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await goalsApi.list();
      setGoals(res.goals);
      setTotalSaved(res.total_saved);
      setTotalTarget(res.total_target);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedTarget = Number(target);
    if (!name.trim()) {
      setError("Enter a goal name.");
      return;
    }
    if (!parsedTarget || parsedTarget <= 0) {
      setError("Enter a target amount greater than 0.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await goalsApi.create(name.trim(), parsedTarget, targetDate || undefined);
      setName("");
      setTarget("");
      setTargetDate("");
      await load();
    } catch {
      setError("Failed to create goal.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await goalsApi.delete(id);
    await load();
  }

  const active = goals.filter((g) => g.status === "active");
  const achieved = goals.filter((g) => g.status === "achieved");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        Savings goals
      </h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile label="Total saved" value={formatCurrency(totalSaved)} />
        <StatTile label="Total target" value={formatCurrency(totalTarget)} />
      </div>

      <Card title="New goal">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Emergency Fund"
              className="w-48 rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Target amount
            <input
              type="number"
              min={1}
              step="0.01"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="10000"
              className="w-32 rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Target date (optional)
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="rounded-md px-3 py-2 text-sm"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {saving ? "Saving…" : "Create goal"}
          </button>
        </form>
        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        )}
      </Card>

      <Card title="In progress">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Loading…
          </p>
        ) : active.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No active goals yet. Add one above.
          </p>
        ) : (
          <ul className="flex flex-col gap-5">
            {active.map((g) => (
              <li key={g.id}>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {g.name}
                    </p>
                    {g.target_date && (
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Target: {formatDate(g.target_date)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <ContributeControl goal={g} onContributed={load} />
                    <button
                      onClick={() => handleDelete(g.id)}
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <Meter spent={g.current_amount} limit={g.target_amount} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {achieved.length > 0 && (
        <Card title="Achieved">
          <ul className="flex flex-col gap-3">
            {achieved.map((g) => (
              <li key={g.id} className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-primary)" }}>{g.name}</span>
                <span style={{ color: "var(--status-good-text)" }}>
                  {formatCurrency(g.current_amount)} / {formatCurrency(g.target_amount)} ✓
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
