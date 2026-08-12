"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type CategoryComparisonResponse,
  type MonthlyTrendPoint,
  exportApi,
  insightsApi,
} from "@/lib/api";
import { currentMonth, formatCurrency, formatMonthLabel } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { MonthComparisonChart } from "@/components/charts/MonthComparisonChart";
import { MonthlyTrendChart } from "@/components/charts/MonthlyTrendChart";

function defaultCsvRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

export default function InsightsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [trend, setTrend] = useState<MonthlyTrendPoint[]>([]);
  const [comparison, setComparison] = useState<CategoryComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [csvRange, setCsvRange] = useState(defaultCsvRange);
  const [pdfYear, setPdfYear] = useState(new Date().getFullYear());
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [trendRes, comparisonRes] = await Promise.all([
        insightsApi.monthlyTrend(6),
        insightsApi.categoryComparison(month),
      ]);
      setTrend(trendRes.points);
      setComparison(comparisonRes);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCsvExport() {
    setExporting("csv");
    try {
      await exportApi.transactionsCsv(csvRange.start, csvRange.end);
    } finally {
      setExporting(null);
    }
  }

  async function handlePdfExport() {
    setExporting("pdf");
    try {
      await exportApi.summaryPdf(pdfYear);
    } finally {
      setExporting(null);
    }
  }

  const totalCurrent = comparison?.categories.reduce((sum, c) => sum + c.current, 0) ?? 0;
  const totalPrevious = comparison?.categories.reduce((sum, c) => sum + c.previous, 0) ?? 0;
  const totalDelta = totalCurrent - totalPrevious;
  const totalDeltaPct = totalPrevious ? Math.round((totalDelta / totalPrevious) * 1000) / 10 : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Insights
        </h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md px-3 py-1.5 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label={`Spent in ${formatMonthLabel(month)}`} value={formatCurrency(totalCurrent)} />
            <StatTile
              label={`Spent in ${comparison ? formatMonthLabel(comparison.previous_month) : "prior month"}`}
              value={formatCurrency(totalPrevious)}
            />
            <StatTile
              label="Change"
              value={`${totalDelta >= 0 ? "+" : ""}${formatCurrency(totalDelta)}${
                totalDeltaPct != null ? ` (${totalDeltaPct >= 0 ? "+" : ""}${totalDeltaPct}%)` : ""
              }`}
              tone={totalDelta > 0 ? "critical" : totalDelta < 0 ? "good" : undefined}
            />
          </div>

          <Card title="Spending trend, last 6 months">
            <MonthlyTrendChart data={trend} />
          </Card>

          <Card title={`${formatMonthLabel(month)} vs ${comparison ? formatMonthLabel(comparison.previous_month) : "last month"}, by category`}>
            <MonthComparisonChart data={comparison?.categories ?? []} />
          </Card>

          <Card title="Export">
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  From
                  <input
                    type="date"
                    value={csvRange.start}
                    onChange={(e) => setCsvRange((r) => ({ ...r, start: e.target.value }))}
                    className="rounded-md px-3 py-1.5 text-sm"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  To
                  <input
                    type="date"
                    value={csvRange.end}
                    onChange={(e) => setCsvRange((r) => ({ ...r, end: e.target.value }))}
                    className="rounded-md px-3 py-1.5 text-sm"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                </label>
                <button
                  onClick={handleCsvExport}
                  disabled={exporting !== null}
                  className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                >
                  {exporting === "csv" ? "Downloading…" : "Download CSV"}
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  Year
                  <input
                    type="number"
                    value={pdfYear}
                    onChange={(e) => setPdfYear(Number(e.target.value))}
                    className="w-24 rounded-md px-3 py-1.5 text-sm"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                </label>
                <button
                  onClick={handlePdfExport}
                  disabled={exporting !== null}
                  className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                >
                  {exporting === "pdf" ? "Downloading…" : "Download PDF summary"}
                </button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
