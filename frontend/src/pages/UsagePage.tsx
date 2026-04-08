import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

type GroupBy = "model" | "provider" | "task_type";
type Days = 7 | 14 | 30 | 90;

interface SummaryRow {
  model?: string;
  provider?: string;
  task_type?: string;
  total_requests: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_duration_ms: number;
  latest_balance?: number | null;
}

interface TrendRow {
  date: string;
  requests: number;
  tokens: number;
  cost_usd: number;
  balance_usd?: number | null;
}

interface RecentRow {
  id: string;
  provider: string;
  model: string;
  task_type: string;
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
  cost_usd: number;
  balance_usd?: number | null;
  duration_ms: number;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n == null || isNaN(n)) return "0";
  return Math.round(n).toLocaleString();
}

function formatCost(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "$0.00";
  if (n === 0) return "$0.00";
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function groupByLabel(groupBy: GroupBy): string {
  switch (groupBy) {
    case "model":
      return "Model";
    case "provider":
      return "Provider";
    case "task_type":
      return "Task Type";
  }
}

function getGroupKey(row: SummaryRow, groupBy: GroupBy): string {
  switch (groupBy) {
    case "model":
      return row.model ?? "—";
    case "provider":
      return row.provider ?? "—";
    case "task_type":
      return row.task_type ?? "—";
  }
}

function formatDate(dateStr: string): string {
  // Expected format: "2025-03-01" or ISO string
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="rounded-xl bg-matrix-card p-5 flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-matrix-text-dim font-medium">
        {label}
      </span>
      <span className="text-2xl font-bold text-matrix-text-bright leading-tight">
        {value}
      </span>
      {sub && <span className="text-xs text-matrix-text-faint">{sub}</span>}
    </div>
  );
}

interface ToggleGroupProps<T extends string | number> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

function ToggleGroup<T extends string | number>({
  options,
  value,
  onChange,
}: ToggleGroupProps<T>) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-matrix-border">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={
            `px-3 py-1.5 text-sm font-medium transition-colors ` +
            (value === opt.value
              ? "bg-matrix-accent text-matrix-bg"
              : "bg-matrix-surface text-matrix-text-dim hover:text-matrix-text")
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Bar Chart ─────────────────────────────────────────────────────────────────

interface TrendChartProps {
  data: TrendRow[];
}

function TrendChart({ data }: TrendChartProps) {
  if (!data.length) {
    return (
      <p className="text-matrix-text-faint text-sm py-4 text-center">
        No trend data available.
      </p>
    );
  }

  const maxVal = Math.max(...data.map((r) => r.cost_usd || r.tokens || 0), 1);
  const useTokens = data.every((r) => !r.cost_usd);
  const getValue = (r: TrendRow) =>
    useTokens ? r.tokens : r.cost_usd;
  const formatVal = (r: TrendRow) =>
    useTokens ? formatNumber(r.tokens) : formatCost(r.cost_usd);

  return (
    <div className="space-y-1.5">
      {data.map((row) => {
        const val = getValue(row);
        const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
        return (
          <div key={row.date} className="flex items-center gap-3 text-xs">
            <span className="w-16 shrink-0 text-matrix-text-dim text-right">
              {formatDate(row.date)}
            </span>
            <div className="flex-1 h-5 bg-matrix-surface rounded overflow-hidden">
              <div
                className="h-full bg-matrix-accent rounded transition-all duration-300"
                style={{ width: `${Math.max(pct, pct > 0 ? 1 : 0)}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-matrix-text text-right font-mono">
              {formatVal(row)}
            </span>
            {row.requests > 0 && (
              <span className="w-14 shrink-0 text-matrix-text-faint text-right">
                {formatNumber(row.requests)} req
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UsagePage() {
  const [days, setDays] = useState<Days>(7);
  const [groupBy, setGroupBy] = useState<GroupBy>("model");

  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [errorTrend, setErrorTrend] = useState<string | null>(null);
  const [errorRecent, setErrorRecent] = useState<string | null>(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoadingSummary(true);
    setErrorSummary(null);
    api
      .get<SummaryRow[]>(`/usage/summary?days=${days}&group_by=${groupBy}`)
      .then(setSummary)
      .catch((e) => setErrorSummary(e.message ?? "Failed to load summary"))
      .finally(() => setLoadingSummary(false));
  }, [days, groupBy]);

  useEffect(() => {
    setLoadingTrend(true);
    setErrorTrend(null);
    api
      .get<TrendRow[]>(`/usage/trend?days=${Math.min(days, 30)}&provider=`)
      .then(setTrend)
      .catch((e) => setErrorTrend(e.message ?? "Failed to load trend"))
      .finally(() => setLoadingTrend(false));
  }, [days]);

  useEffect(() => {
    setLoadingRecent(true);
    setErrorRecent(null);
    api
      .get<RecentRow[]>(`/usage/recent?days=${days}&limit=50`)
      .then(setRecent)
      .catch((e) => setErrorRecent(e.message ?? "Failed to load recent activity"))
      .finally(() => setLoadingRecent(false));
  }, [days]);

  // ── Derived stats ───────────────────────────────────────────────────────────

  const totalRequests = summary.reduce((s, r) => s + (r.total_requests ?? 0), 0);
  const totalTokens = summary.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
  const totalCost = summary.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0);

  const kagiBalance = (() => {
    const withBalance = summary.filter(
      (r) => r.latest_balance != null && r.latest_balance !== 0,
    );
    if (!withBalance.length) return null;
    return withBalance[withBalance.length - 1]?.latest_balance ?? null;
  })();

  const sortedSummary = [...summary].sort(
    (a, b) => (b.total_cost_usd ?? 0) - (a.total_cost_usd ?? 0),
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const daysOptions: { value: Days; label: string }[] = [
    { value: 7, label: "7d" },
    { value: 14, label: "14d" },
    { value: 30, label: "30d" },
    { value: 90, label: "90d" },
  ];

  const groupByOptions: { value: GroupBy; label: string }[] = [
    { value: "model", label: "Model" },
    { value: "provider", label: "Provider" },
    { value: "task_type", label: "Task Type" },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-matrix-text-bright">
          API Usage
        </h1>
        <span className="text-xs text-matrix-text-faint">
          Showing last {days} days
        </span>
      </div>

      {/* ── Top Controls ── */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-matrix-text-dim">Time range:</span>
          <ToggleGroup
            options={daysOptions}
            value={days}
            onChange={setDays}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-matrix-text-dim">Group by:</span>
          <ToggleGroup
            options={groupByOptions}
            value={groupBy}
            onChange={setGroupBy}
          />
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {errorSummary ? (
        <p className="text-red-400 text-sm">{errorSummary}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Total Requests"
            value={loadingSummary ? "—" : formatNumber(totalRequests)}
            sub="across all models"
          />
          <StatCard
            label="Total Tokens"
            value={loadingSummary ? "—" : formatNumber(totalTokens)}
            sub="in + out"
          />
          <StatCard
            label="Estimated Cost"
            value={loadingSummary ? "—" : formatCost(totalCost)}
            sub="billed this period"
          />
          <StatCard
            label="Kagi Balance"
            value={
              loadingSummary
                ? "—"
                : kagiBalance != null
                  ? formatCost(kagiBalance)
                  : "N/A"
            }
            sub="latest known balance"
          />
        </div>
      )}

      {/* ── Daily Trend Chart ── */}
      <div className="rounded-xl bg-matrix-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-matrix-text-bright">
            Daily Trend
          </h2>
          {loadingTrend && (
            <span className="text-xs text-matrix-text-faint animate-pulse">
              Loading…
            </span>
          )}
        </div>
        {errorTrend ? (
          <p className="text-red-400 text-sm">{errorTrend}</p>
        ) : (
          <TrendChart data={trend.slice(-30)} />
        )}
      </div>

      {/* ── Summary Table ── */}
      <div className="rounded-xl bg-matrix-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-matrix-text-bright">
            Usage by {groupByLabel(groupBy)}
          </h2>
          {loadingSummary && (
            <span className="text-xs text-matrix-text-faint animate-pulse">
              Loading…
            </span>
          )}
        </div>
        {errorSummary ? (
          <p className="text-red-400 text-sm">{errorSummary}</p>
        ) : sortedSummary.length === 0 && !loadingSummary ? (
          <p className="text-matrix-text-faint text-sm py-2">
            No data for this period.
          </p>
        ) : (
          <div className="rounded-xl border border-matrix-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-matrix-surface text-matrix-text-dim text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium">
                    {groupByLabel(groupBy)}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Requests</th>
                  <th className="px-4 py-3 text-right font-medium">Tokens In</th>
                  <th className="px-4 py-3 text-right font-medium">Tokens Out</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {sortedSummary.map((row, i) => (
                  <tr
                    key={i}
                    className="border-t border-matrix-border hover:bg-matrix-surface/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-matrix-text font-mono text-xs max-w-xs truncate">
                      {getGroupKey(row, groupBy)}
                    </td>
                    <td className="px-4 py-3 text-right text-matrix-text tabular-nums">
                      {formatNumber(row.total_requests)}
                    </td>
                    <td className="px-4 py-3 text-right text-matrix-text-dim tabular-nums">
                      {formatNumber(row.total_tokens_in)}
                    </td>
                    <td className="px-4 py-3 text-right text-matrix-text-dim tabular-nums">
                      {formatNumber(row.total_tokens_out)}
                    </td>
                    <td className="px-4 py-3 text-right text-matrix-text-bright font-medium tabular-nums">
                      {formatCost(row.total_cost_usd)}
                    </td>
                    <td className="px-4 py-3 text-right text-matrix-text-dim tabular-nums">
                      {row.avg_duration_ms
                        ? `${Math.round(row.avg_duration_ms).toLocaleString()} ms`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recent Activity ── */}
      <div className="rounded-xl bg-matrix-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-matrix-text-bright">
            Recent Activity
          </h2>
          <div className="flex items-center gap-3">
            {loadingRecent && (
              <span className="text-xs text-matrix-text-faint animate-pulse">
                Loading…
              </span>
            )}
            {recent.length > 0 && !loadingRecent && (
              <span className="text-xs text-matrix-text-faint">
                {recent.length} entries
              </span>
            )}
          </div>
        </div>
        {errorRecent ? (
          <p className="text-red-400 text-sm">{errorRecent}</p>
        ) : recent.length === 0 && !loadingRecent ? (
          <p className="text-matrix-text-faint text-sm py-2">
            No recent activity.
          </p>
        ) : (
          <div className="rounded-xl border border-matrix-border overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="bg-matrix-surface text-matrix-text-dim text-xs uppercase tracking-wide">
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                  <th className="px-3 py-2 text-left font-medium">Provider</th>
                  <th className="px-3 py-2 text-left font-medium">Model</th>
                  <th className="px-3 py-2 text-left font-medium">Task</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-matrix-border hover:bg-matrix-surface/50 transition-colors"
                  >
                    <td className="px-3 py-2 text-matrix-text-dim whitespace-nowrap">
                      {relativeTime(row.created_at)}
                    </td>
                    <td className="px-3 py-2 text-matrix-text whitespace-nowrap">
                      {row.provider}
                    </td>
                    <td
                      className="px-3 py-2 text-matrix-text font-mono max-w-[180px] truncate"
                      title={row.model}
                    >
                      {row.model}
                    </td>
                    <td className="px-3 py-2 text-matrix-text-dim whitespace-nowrap">
                      {row.task_type || "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-matrix-text tabular-nums whitespace-nowrap">
                      {formatNumber(row.total_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-matrix-text-bright tabular-nums whitespace-nowrap">
                      {formatCost(row.cost_usd)}
                    </td>
                    <td className="px-3 py-2 text-right text-matrix-text-dim tabular-nums whitespace-nowrap">
                      {row.duration_ms
                        ? `${Math.round(row.duration_ms).toLocaleString()} ms`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
