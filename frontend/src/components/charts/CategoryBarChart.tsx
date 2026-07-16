"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCategoryLabel, formatCurrency } from "@/lib/format";
import type { CategorySpend } from "@/lib/api";

interface TooltipPayloadItem {
  payload: CategorySpend;
}

function CategoryTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  const overBudget = item.budget != null && item.spent > item.budget;

  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-md"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <p className="font-medium" style={{ color: "var(--text-primary)" }}>
        {formatCategoryLabel(item.category)}
      </p>
      <p style={{ color: "var(--text-secondary)" }}>Spent: {formatCurrency(item.spent)}</p>
      {item.budget != null && (
        <p style={{ color: overBudget ? "var(--status-critical)" : "var(--text-secondary)" }}>
          Budget: {formatCurrency(item.budget)} {overBudget && "— over budget"}
        </p>
      )}
    </div>
  );
}

export function CategoryBarChart({ data }: { data: CategorySpend[] }) {
  const sorted = [...data].sort((a, b) => b.spent - a.spent);
  const chartData = sorted.map((d) => ({ ...d, label: formatCategoryLabel(d.category) }));

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        No spending recorded for this month yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(chartData.length * 44, 120)}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--text-secondary)", fontSize: 13 }}
        />
        <Tooltip content={<CategoryTooltip />} cursor={{ fill: "var(--gridline)", opacity: 0.4 }} />
        <Bar dataKey="spent" radius={4} maxBarSize={22}>
          {chartData.map((entry, index) => {
            const overBudget = entry.budget != null && entry.spent > entry.budget;
            return (
              <Cell key={index} fill={overBudget ? "var(--status-critical)" : "var(--series-1)"} />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
