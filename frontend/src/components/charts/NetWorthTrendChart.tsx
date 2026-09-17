"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import { TooltipShell } from "./ChartTooltip";
import type { NetWorthPoint } from "@/lib/api";

interface TooltipPayloadItem {
  payload: NetWorthPoint;
}

function NetWorthTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <TooltipShell
      heading={formatDate(item.date)}
      rows={[
        { label: "Net worth", value: formatCurrency(item.net_worth), color: "var(--series-5)" },
        { label: "Assets", value: formatCurrency(item.assets), muted: true },
        { label: "Liabilities", value: formatCurrency(item.liabilities), muted: true },
      ]}
    />
  );
}

export function NetWorthTrendChart({ data }: { data: NetWorthPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-muted">
        No balance history yet — link an account or sync to start tracking net worth.
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
          minTickGap={32}
        />
        <YAxis
          tickFormatter={formatCompactCurrency}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          width={56}
        />
        <Tooltip content={<NetWorthTooltip />} cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="net_worth"
          stroke="var(--series-5)"
          strokeWidth={2}
          fill="var(--series-5)"
          fillOpacity={0.12}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
