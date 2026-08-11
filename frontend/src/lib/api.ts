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

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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
    apiFetch<Array<{ added: number; modified: number; removed: number; new_fraud_flags: number }>>(
      "/plaid/sync",
      { method: "POST" }
    ),
  listAccounts: () => apiFetch<AccountSummary[]>("/plaid/accounts"),
};

// ---- Transactions ----

export const transactionsApi = {
  list: (params: {
    category?: string;
    accountId?: number;
    startDate?: string;
    endDate?: string;
    flaggedOnly?: boolean;
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
        page: params.page,
        page_size: params.pageSize,
      },
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

// ---- Fraud ----

export const fraudApi = {
  listFlags: (status?: string) => apiFetch<FraudFlag[]>("/fraud/flags", { query: { status_filter: status } }),
  updateStatus: (flagId: number, status: "confirmed" | "dismissed") =>
    apiFetch<FraudFlag>(`/fraud/flags/${flagId}`, { method: "POST", body: { status } }),
  retrain: () => apiFetch<{ trained_users: number; message: string }>("/fraud/retrain", { method: "POST" }),
};
