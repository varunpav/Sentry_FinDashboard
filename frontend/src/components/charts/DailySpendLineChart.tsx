"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import type { DailySpendPoint } from "@/lib/api";

interface TooltipPayloadItem {
  payload: DailySpendPoint;
}

function SpendTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-md"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <p style={{ color: "var(--text-secondary)" }}>{formatDate(item.date)}</p>
      <p className="font-medium" style={{ color: "var(--text-primary)" }}>
        {formatCurrency(item.amount)}
      </p>
    </div>
  );
}

export function DailySpendLineChart({ data }: { data: DailySpendPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        No daily spending to chart yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          axisLine={{ stroke: "var(--baseline)" }}
          tickLine={false}
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={formatCompactCurrency}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          width={56}
        />
        <Tooltip content={<SpendTooltip />} cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="var(--series-1)"
          fillOpacity={0.1}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
