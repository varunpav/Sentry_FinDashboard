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
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { ErrorState } from "@/components/ui/EmptyState";
import { CardSkeleton, StatTileSkeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/ui/Icons";
import { MonthComparisonChart } from "@/components/charts/MonthComparisonChart";
import { MonthlyTrendChart } from "@/components/charts/MonthlyTrendChart";
import { useToast } from "@/components/ui/Toast";

const TREND_RANGES = [6, 12, 24] as const;

function defaultCsvRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

export default function InsightsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [trendMonths, setTrendMonths] = useState<(typeof TREND_RANGES)[number]>(6);
  const [trend, setTrend] = useState<MonthlyTrendPoint[]>([]);
  const [comparison, setComparison] = useState<CategoryComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [csvRange, setCsvRange] = useState(defaultCsvRange);
  const [pdfYear, setPdfYear] = useState(new Date().getFullYear());
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [trendRes, comparisonRes] = await Promise.all([
        insightsApi.monthlyTrend(trendMonths),
        insightsApi.categoryComparison(month),
      ]);
      setTrend(trendRes.points);
      setComparison(comparisonRes);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [month, trendMonths]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCsvExport() {
    setExporting("csv");
    try {
      await exportApi.transactionsCsv(csvRange.start, csvRange.end);
    } catch {
      showToast("CSV export failed.", "error");
    } finally {
      setExporting(null);
    }
  }

  async function handlePdfExport() {
    setExporting("pdf");
    try {
      await exportApi.summaryPdf(pdfYear);
    } catch {
      showToast("PDF export failed.", "error");
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
        <h1 className="text-xl font-semibold text-text-primary">Insights</h1>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      {loading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </div>
          <CardSkeleton lines={5} />
        </>
      ) : error ? (
        <Card>
          <ErrorState onRetry={load} />
        </Card>
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

          <Card
            title={`Spending trend, last ${trendMonths} months`}
            action={
              <div className="flex gap-1 rounded-md border border-border p-0.5">
                {TREND_RANGES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setTrendMonths(m)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      trendMonths === m ? "bg-surface-2 text-series-1" : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {m}mo
                  </button>
                ))}
              </div>
            }
          >
            <MonthlyTrendChart data={trend} />
          </Card>

          <Card
            title={`${formatMonthLabel(month)} vs ${comparison ? formatMonthLabel(comparison.previous_month) : "last month"}, by category`}
          >
            <MonthComparisonChart data={comparison?.categories ?? []} />
          </Card>

          <Card title="Export">
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label="From"
                  type="date"
                  value={csvRange.start}
                  onChange={(e) => setCsvRange((r) => ({ ...r, start: e.target.value }))}
                />
                <Input
                  label="To"
                  type="date"
                  value={csvRange.end}
                  onChange={(e) => setCsvRange((r) => ({ ...r, end: e.target.value }))}
                />
                <Button onClick={handleCsvExport} loading={exporting === "csv"} disabled={exporting !== null && exporting !== "csv"}>
                  {exporting !== "csv" && Icon.download({ size: 14 })}
                  Download CSV
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label="Year"
                  type="number"
                  value={pdfYear}
                  onChange={(e) => setPdfYear(Number(e.target.value))}
                  wrapperClassName="w-24"
                />
                <Button onClick={handlePdfExport} loading={exporting === "pdf"} disabled={exporting !== null && exporting !== "pdf"}>
                  {exporting !== "pdf" && Icon.download({ size: 14 })}
                  Download PDF summary
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
