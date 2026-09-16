"use client";

import { useCallback, useEffect, useState } from "react";
import { type Goal, goalsApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Meter";
import { StatTile } from "@/components/ui/StatTile";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { CardSkeleton, StatTileSkeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

function ContributeControl({ goal, onContributed }: { goal: Goal; onContributed: () => void }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  async function handleContribute() {
    const parsed = Number(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      await goalsApi.contribute(goal.id, parsed);
      setAmount("");
      onContributed();
    } catch {
      showToast("Failed to add contribution.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount"
        className="w-24"
      />
      <Button size="sm" variant="primary" onClick={handleContribute} loading={saving}>
        Contribute
      </Button>
    </div>
  );
}

function EditGoalForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [name, setName] = useState(goal.name);
  const [target, setTarget] = useState(String(goal.target_amount));
  const [targetDate, setTargetDate] = useState(goal.target_date ?? "");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  async function handleSave() {
    const parsedTarget = Number(target);
    if (!name.trim() || !parsedTarget || parsedTarget <= 0) return;
    setSaving(true);
    try {
      await goalsApi.update(goal.id, { name: name.trim(), targetAmount: parsedTarget, targetDate: targetDate || undefined });
      onDone();
    } catch {
      showToast("Failed to update goal.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-2 p-3">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} wrapperClassName="w-40" />
      <Input
        label="Target"
        type="number"
        min={1}
        step="0.01"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        wrapperClassName="w-28"
      />
      <Input
        label="Target date"
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
        wrapperClassName="w-40"
      />
      <Button size="sm" variant="primary" onClick={handleSave} loading={saving}>
        Save
      </Button>
      <Button size="sm" onClick={onDone}>
        Cancel
      </Button>
    </div>
  );
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [totalSaved, setTotalSaved] = useState(0);
  const [totalTarget, setTotalTarget] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await goalsApi.list();
      setGoals(res.goals);
      setTotalSaved(res.total_saved);
      setTotalTarget(res.total_target);
    } catch {
      setError(true);
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
      setFormError("Enter a goal name.");
      return;
    }
    if (!parsedTarget || parsedTarget <= 0) {
      setFormError("Enter a target amount greater than 0.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await goalsApi.create(name.trim(), parsedTarget, targetDate || undefined);
      setName("");
      setTarget("");
      setTargetDate("");
      showToast("Goal created.", "success");
      await load();
    } catch {
      showToast("Failed to create goal.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await goalsApi.delete(id);
      await load();
    } catch {
      showToast("Failed to delete goal.", "error");
    }
  }

  const active = goals.filter((g) => g.status === "active");
  const achieved = goals.filter((g) => g.status === "achieved");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text-primary">Savings goals</h1>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatTile label="Total saved" value={formatCurrency(totalSaved)} />
          <StatTile label="Total target" value={formatCurrency(totalTarget)} />
        </div>
      )}

      <Card title="New goal">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency Fund" wrapperClassName="w-48" />
          <Input
            label="Target amount"
            type="number"
            min={1}
            step="0.01"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="10000"
            wrapperClassName="w-32"
          />
          <Input
            label="Target date (optional)"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={saving}>
            Create goal
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
        <Card title="In progress">
          {active.length === 0 ? (
            <EmptyState icon="target" title="No active goals yet" description="Add one above to start saving toward it." />
          ) : (
            <ul className="flex flex-col gap-5">
              {active.map((g) =>
                editingId === g.id ? (
                  <li key={g.id}>
                    <EditGoalForm goal={g} onDone={() => { setEditingId(null); load(); }} />
                  </li>
                ) : (
                  <li key={g.id}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <span className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text-primary">{g.name}</p>
                          <span className="tabular text-xs text-text-muted">{g.progress_pct}%</span>
                        </span>
                        {g.target_date && <p className="text-xs text-text-muted">Target: {formatDate(g.target_date)}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <ContributeControl goal={g} onContributed={load} />
                        <IconButton label="Edit goal" onClick={() => setEditingId(g.id)}>
                          {Icon.edit({ size: 14 })}
                        </IconButton>
                        <IconButton label="Delete goal" onClick={() => handleDelete(g.id)}>
                          {Icon.trash({ size: 14 })}
                        </IconButton>
                      </div>
                    </div>
                    <Meter spent={g.current_amount} limit={g.target_amount} />
                  </li>
                )
              )}
            </ul>
          )}
        </Card>
      )}

      {!loading && !error && achieved.length > 0 && (
        <Card title="Achieved">
          <ul className="flex flex-col gap-3">
            {achieved.map((g) => (
              <li key={g.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-text-primary">
                  {Icon.check({ size: 14, className: "text-status-good-text" })}
                  {g.name}
                </span>
                <span className="tabular text-status-good-text">
                  {formatCurrency(g.current_amount)} / {formatCurrency(g.target_amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
