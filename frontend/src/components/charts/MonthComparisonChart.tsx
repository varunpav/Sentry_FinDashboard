"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCategoryLabel, formatCurrency } from "@/lib/format";
import type { CategoryComparisonRow } from "@/lib/api";

interface TooltipPayloadItem {
  payload: CategoryComparisonRow & { label: string };
}

function ComparisonTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  const deltaColor =
    item.delta > 0 ? "var(--status-critical)" : item.delta < 0 ? "var(--status-good-text)" : "var(--text-secondary)";

  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-md"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <p className="font-medium" style={{ color: "var(--text-primary)" }}>
        {item.label}
      </p>
      <p style={{ color: "var(--text-primary)" }}>This month: {formatCurrency(item.current)}</p>
      <p style={{ color: "var(--text-muted)" }}>Last month: {formatCurrency(item.previous)}</p>
      <p style={{ color: deltaColor }}>
        {item.delta >= 0 ? "+" : ""}
        {formatCurrency(item.delta)}
        {item.delta_pct != null && ` (${item.delta_pct >= 0 ? "+" : ""}${item.delta_pct}%)`}
      </p>
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-2 flex items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />
        This month
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-1)", opacity: 0.3 }} />
        Last month
      </span>
    </div>
  );
}

export function MonthComparisonChart({ data }: { data: CategoryComparisonRow[] }) {
  const sorted = [...data].sort((a, b) => b.current - a.current);
  const chartData = sorted.map((d) => ({ ...d, label: formatCategoryLabel(d.category) }));

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        No spending recorded in either month yet.
      </p>
    );
  }

  return (
    <div>
      <Legend />
      <ResponsiveContainer width="100%" height={Math.max(chartData.length * 48, 140)}>
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
          <Tooltip content={<ComparisonTooltip />} cursor={{ fill: "var(--gridline)", opacity: 0.4 }} />
          <Bar dataKey="previous" fill="var(--series-1)" fillOpacity={0.3} radius={4} maxBarSize={16} />
          <Bar dataKey="current" fill="var(--series-1)" radius={4} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
