"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCategoryLabel, formatCurrency } from "@/lib/format";
import { getCategoryColor } from "@/lib/categories";
import { TooltipShell } from "./ChartTooltip";
import type { CategoryComparisonRow } from "@/lib/api";

interface TooltipPayloadItem {
  payload: CategoryComparisonRow & { label: string };
}

function ComparisonTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  const color = getCategoryColor(item.category);
  return (
    <TooltipShell
      heading={item.label}
      rows={[
        { label: "This month", value: formatCurrency(item.current), color },
        { label: "Last month", value: formatCurrency(item.previous), muted: true },
      ]}
      footnote={`${item.delta >= 0 ? "+" : ""}${formatCurrency(item.delta)}${
        item.delta_pct != null ? ` (${item.delta_pct >= 0 ? "+" : ""}${item.delta_pct}%)` : ""
      } vs last month`}
    />
  );
}

export function MonthComparisonChart({ data }: { data: CategoryComparisonRow[] }) {
  const sorted = [...data].sort((a, b) => b.current - a.current);
  const chartData = sorted.map((d) => ({ ...d, label: formatCategoryLabel(d.category) }));

  if (chartData.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">No spending recorded in either month yet.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-text-secondary" />
          This month
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-text-secondary opacity-30" />
          Last month
        </span>
      </div>
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
          <Bar dataKey="previous" radius={4} maxBarSize={16}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={getCategoryColor(entry.category)} fillOpacity={0.3} />
            ))}
          </Bar>
          <Bar dataKey="current" radius={4} maxBarSize={16}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={getCategoryColor(entry.category)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
