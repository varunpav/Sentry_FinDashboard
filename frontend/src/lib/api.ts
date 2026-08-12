const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const ACCESS_TOKEN_KEY = "sentry_access_token";
const REFRESH_TOKEN_KEY = "sentry_refresh_token";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail.map((d: { msg?: string }) => d.msg).join(", ");
    }
    return res.statusText;
  } catch {
    return res.statusText;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    return null;
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data.access_token as string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// Shared request/401-refresh-retry logic, returning the raw Response. apiFetch and
// apiDownload both build on this so the auth handling never diverges between the two.
async function authedFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = "GET", body, auth = true, query } = options;

  const doFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && token) headers["Authorization"] = `Bearer ${token}`;

    return fetch(`${API_BASE_URL}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch(getAccessToken());

  if (res.status === 401 && auth) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(newToken);
    }
  }

  return res;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await authedFetch(path, options);

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Downloads a binary response (CSV/PDF/etc.) and triggers a browser save-as, rather
// than parsing it as JSON like apiFetch does.
export async function apiDownload(
  path: string,
  filename: string,
  query?: RequestOptions["query"]
): Promise<void> {
  const res = await authedFetch(path, { query });

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(detail, res.status);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---- Types ----

export interface User {
  id: number;
  email: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface AccountSummary {
  id: number;
  name: string;
  type: string | null;
  subtype: string | null;
  mask: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  institution_name: string | null;
}

export interface Transaction {
  id: number;
  account_id: number;
  account_name: string | null;
  amount: number;
  date: string;
  merchant_name: string | null;
  name: string | null;
  category_primary: string | null;
  category_detailed: string | null;
  category_override: string | null;
  effective_category: string | null;
  payment_channel: string | null;
  pending: boolean;
  is_flagged: boolean;
}

export interface PaginatedTransactions {
  items: Transaction[];
  total: number;
  page: number;
  page_size: number;
}

export interface Budget {
  id: number;
  category: string;
  monthly_limit: number;
  spent: number;
}

export interface CategorySpend {
  category: string;
  spent: number;
  budget: number | null;
}

export interface DailySpendPoint {
  date: string;
  amount: number;
}

export interface SpendingSummary {
  month: string;
  total_spent: number;
  total_budget: number;
  by_category: CategorySpend[];
  daily_spend: DailySpendPoint[];
}

export interface NetWorthSummary {
  assets: number;
  liabilities: number;
  net_worth: number;
  change_30d: number | null;
  change_30d_pct: number | null;
}

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  net_worth: number;
}

export interface RecurringSeries {
  id: number;
  display_name: string;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  median_gap_days: number;
  expected_amount: number;
  amount_stability: "fixed" | "variable";
  occurrences: number;
  first_seen: string;
  last_seen: string;
  next_due_date: string;
  confidence: number;
  status: "active" | "inactive";
  is_muted: boolean;
}

export interface RecurringListResponse {
  series: RecurringSeries[];
  total_monthly_cost: number;
}

export interface FraudFlag {
  id: number;
  transaction_id: number;
  amount: number;
  date: string;
  merchant_name: string | null;
  category_primary: string | null;
  anomaly_score: number;
  reasons: string[];
  status: "pending" | "confirmed" | "dismissed";
}

// ---- Auth ----

export const authApi = {
  register: (email: string, password: string) =>
    apiFetch<TokenResponse>("/auth/register", { method: "POST", body: { email, password }, auth: false }),
  login: (email: string, password: string) =>
    apiFetch<TokenResponse>("/auth/login", { method: "POST", body: { email, password }, auth: false }),
  me: () => apiFetch<User>("/auth/me"),
};

// ---- Plaid ----

export const plaidApi = {
  createLinkToken: () => apiFetch<{ link_token: string }>("/plaid/link-token", { method: "POST" }),
  exchangePublicToken: (publicToken: string) =>
    apiFetch<{ item_id: number; institution_name: string | null; accounts_linked: number }>(
      "/plaid/exchange",
      { method: "POST", body: { public_token: publicToken } }
    ),
  sync: () =>
    apiFetch<
      Array<{
        added: number;
        modified: number;
        removed: number;
        new_fraud_flags: number;
        balances_refreshed: number;
      }>
    >("/plaid/sync", { method: "POST" }),
  listAccounts: () => apiFetch<AccountSummary[]>("/plaid/accounts"),
  refreshBalances: () =>
    apiFetch<{ accounts_updated: number }>("/plaid/refresh-balances", { method: "POST" }),
};

// ---- Transactions ----

export const transactionsApi = {
  list: (params: {
    category?: string;
    accountId?: number;
    startDate?: string;
    endDate?: string;
    flaggedOnly?: boolean;
    search?: string;
    page?: number;
    pageSize?: number;
  }) =>
    apiFetch<PaginatedTransactions>("/transactions", {
      query: {
        category: params.category,
        account_id: params.accountId,
        start_date: params.startDate,
        end_date: params.endDate,
        flagged_only: params.flaggedOnly,
        search: params.search,
        page: params.page,
        page_size: params.pageSize,
      },
    }),
  updateCategory: (id: number, categoryOverride: string | null) =>
    apiFetch<Transaction>(`/transactions/${id}`, {
      method: "PATCH",
      body: { category_override: categoryOverride },
    }),
};

// ---- Budgets ----

export const budgetsApi = {
  list: (month?: string) => apiFetch<Budget[]>("/budgets", { query: { month } }),
  upsert: (category: string, monthlyLimit: number) =>
    apiFetch<Budget>("/budgets", { method: "PUT", body: { category, monthly_limit: monthlyLimit } }),
  spendingSummary: (month?: string) =>
    apiFetch<SpendingSummary>("/spending/summary", { query: { month } }),
};

export interface MonthlyTrendPoint {
  month: string;
  total_spent: number;
}

export interface CategoryComparisonRow {
  category: string;
  current: number;
  previous: number;
  delta: number;
  delta_pct: number | null;
}

export interface CategoryComparisonResponse {
  month: string;
  previous_month: string;
  categories: CategoryComparisonRow[];
}

export interface Goal {
  id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  status: "active" | "achieved" | "archived";
  progress_pct: number;
  created_at: string;
}

export interface GoalListResponse {
  goals: Goal[];
  total_saved: number;
  total_target: number;
}

// ---- Goals ----

export const goalsApi = {
  list: () => apiFetch<GoalListResponse>("/goals"),
  create: (name: string, targetAmount: number, targetDate?: string) =>
    apiFetch<Goal>("/goals", {
      method: "POST",
      body: { name, target_amount: targetAmount, target_date: targetDate || null },
    }),
  delete: (id: number) => apiFetch<void>(`/goals/${id}`, { method: "DELETE" }),
  contribute: (id: number, amount: number) =>
    apiFetch<Goal>(`/goals/${id}/contribute`, { method: "POST", body: { amount } }),
};

// ---- Export ----

export const exportApi = {
  transactionsCsv: (startDate: string, endDate: string) =>
    apiDownload("/export/transactions.csv", `sentry-transactions-${startDate}-to-${endDate}.csv`, {
      start_date: startDate,
      end_date: endDate,
    }),
  summaryPdf: (year: number) =>
    apiDownload("/export/summary.pdf", `sentry-summary-${year}.pdf`, { year }),
};

// ---- Insights ----

export const insightsApi = {
  monthlyTrend: (months?: number) =>
    apiFetch<{ points: MonthlyTrendPoint[] }>("/insights/monthly-trend", { query: { months } }),
  categoryComparison: (month?: string) =>
    apiFetch<CategoryComparisonResponse>("/insights/category-comparison", { query: { month } }),
};

// ---- Net worth ----

export const networthApi = {
  summary: () => apiFetch<NetWorthSummary>("/networth/summary"),
  history: (months?: number) => apiFetch<{ points: NetWorthPoint[] }>("/networth/history", { query: { months } }),
};

export interface SyncPreferences {
  auto_sync_enabled: boolean;
  interval_hours: number;
  last_auto_sync_at: string | null;
  last_auto_sync_status: "ok" | "failed" | "partial" | null;
  last_auto_sync_detail: string | null;
}

export interface AutoSyncItemResult {
  item_id: number;
  ok: boolean;
  detail: string | null;
}

export interface AutoSyncResult {
  synced: boolean;
  reason: string | null;
  next_due_at: string | null;
  last_auto_sync_at: string | null;
  status: "ok" | "failed" | "partial" | null;
  results: AutoSyncItemResult[];
}

// ---- Auto-sync ----

export const syncApi = {
  getPreferences: () => apiFetch<SyncPreferences>("/sync/preferences"),
  updatePreferences: (autoSyncEnabled: boolean, intervalHours: number) =>
    apiFetch<SyncPreferences>("/sync/preferences", {
      method: "PUT",
      body: { auto_sync_enabled: autoSyncEnabled, interval_hours: intervalHours },
    }),
  auto: () => apiFetch<AutoSyncResult>("/sync/auto", { method: "POST" }),
};

export interface NotificationPreferences {
  budget_alerts_enabled: boolean;
  budget_threshold_pct: number;
  budget_alert_at_100: boolean;
  bill_reminders_enabled: boolean;
  bill_lead_days: number;
  fraud_alerts_enabled: boolean;
  weekly_digest_enabled: boolean;
  weekly_digest_day: number;
  email_override: string | null;
}

export interface NotificationLogEntry {
  id: number;
  type: "budget" | "bill" | "fraud" | "digest";
  dedup_key: string;
  sent_at: string;
  status: "sent" | "skipped" | "failed";
  detail: string | null;
}

export interface NotificationRunResult {
  budget: number;
  bill: number;
  fraud: number;
  digest: number;
  resend_configured: boolean;
}

// ---- Notifications ----

export const notificationsApi = {
  getPreferences: () => apiFetch<NotificationPreferences>("/notifications/preferences"),
  updatePreferences: (prefs: NotificationPreferences) =>
    apiFetch<NotificationPreferences>("/notifications/preferences", { method: "PUT", body: prefs }),
  log: (limit?: number) => apiFetch<NotificationLogEntry[]>("/notifications/log", { query: { limit } }),
  run: () => apiFetch<NotificationRunResult>("/notifications/run", { method: "POST" }),
};

// ---- Recurring ----

export const recurringApi = {
  list: () => apiFetch<RecurringListResponse>("/recurring"),
  upcoming: (days?: number) => apiFetch<RecurringSeries[]>("/recurring/upcoming", { query: { days } }),
  refresh: () => apiFetch<{ active: number; inactive: number; total_candidates: number }>("/recurring/refresh", { method: "POST" }),
  setMuted: (seriesId: number, isMuted: boolean) =>
    apiFetch<RecurringSeries>(`/recurring/${seriesId}/mute`, { method: "POST", body: { is_muted: isMuted } }),
};

// ---- Fraud ----

export const fraudApi = {
  listFlags: (status?: string) => apiFetch<FraudFlag[]>("/fraud/flags", { query: { status_filter: status } }),
  updateStatus: (flagId: number, status: "confirmed" | "dismissed") =>
    apiFetch<FraudFlag>(`/fraud/flags/${flagId}`, { method: "POST", body: { status } }),
  retrain: () => apiFetch<{ trained_users: number; message: string }>("/fraud/retrain", { method: "POST" }),
};
