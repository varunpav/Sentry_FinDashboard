# Sentry

A full-stack personal finance dashboard: link a bank account via Plaid, track net
worth and spending, catch recurring bills automatically, get ML-based fraud alerts,
and configure email notifications for all of it.

Demo login (seeded data, no Plaid credentials needed): **`demo@sentryapp.dev`** /
**`demo12345`**

Location: `C:\Users\varun\passion-projs\sentry-findashboard`

## What it does

- **Bank linking & sync** — Plaid Link (Sandbox), cursor-based transaction sync,
  balances refreshed on every sync
- **Automatic sync** — optional background sync on a 1h–2 day interval (off by
  default), plus a lightweight on-open check — see
  [`docs/design-decisions.md`](docs/design-decisions.md) for the scheduler design
- **Net worth** — daily balance snapshots roll up into an assets-vs-liabilities trend
- **Budgets & spending breakdown** — per-category limits, category/daily charts
- **Transactions** — search, filter by category/account/date range, and manually
  recategorize a transaction — the override survives the next Plaid sync (see
  [`docs/design-decisions.md`](docs/design-decisions.md) for why that's not trivial)
- **Insights** — month-over-month spend trend and a per-category comparison against
  the prior month
- **Savings goals** — target + contributions, progress reused from the budget Meter
- **Recurring charges & bill reminders** — detected from transaction history alone,
  see [`docs/design-decisions.md`](docs/design-decisions.md)
- **Fraud detection** — per-user unsupervised anomaly detection with plain-English
  reasons, see [`docs/design-decisions.md`](docs/design-decisions.md)
- **Email notifications** — budget/bill/fraud alerts + weekly digest via Resend,
  per-type granularity controls
- **Export** — transactions as CSV, an annual spend/budget summary as PDF
- **Auth** — JWT access/refresh, multi-user

## Screenshots (Dummy Data)

<img width="1893" height="907" alt="image" src="https://github.com/user-attachments/assets/a2325e7f-e048-46ad-a686-774c231b8cd0" />
<img width="1896" height="908" alt="image" src="https://github.com/user-attachments/assets/d69155d9-cdc6-40b2-9860-218f69e1a0b6" />
<img width="1919" height="897" alt="image" src="https://github.com/user-attachments/assets/bb90c2a3-c368-41db-b883-f9e84b4098cc" />
<img width="1919" height="901" alt="image" src="https://github.com/user-attachments/assets/3db9c7d2-ec01-4ecc-9957-20b8fe312488" />
<img width="1917" height="892" alt="image" src="https://github.com/user-attachments/assets/84083557-0c91-4ae2-956d-60205205228d" />
<img width="1911" height="895" alt="image" src="https://github.com/user-attachments/assets/3319457c-9282-4ec8-b29d-d2f2b577c825" />


## Architecture

```
┌─────────────┐        ┌───────────────────┐        ┌───────────────┐
│   Next.js   │  REST  │     FastAPI       │  SQL   │  PostgreSQL   │
│  (dashboard,│◄──────►│  (auth, budgets,  │◄──────►│  (users,      │
│  charts,    │  JWT   │  sync, fraud      │        │  transactions,│
│  Plaid Link)│        │  scoring)         │        │  budgets, ...)│
└─────────────┘        └─────────┬─────────┘        └───────────────┘
                                  │
                        ┌─────────┴─────────┐
                        ▼                   ▼
                ┌───────────────┐   ┌──────────────────┐
                │   Plaid API   │   │  IsolationForest │
                │   (Sandbox)   │   │  one model/user, │
                └───────────────┘   │  joblib-persisted│
                                    └──────────────────┘
```

**Stack:** Next.js 16 + TypeScript + Tailwind + Recharts · FastAPI + SQLAlchemy 2.0 +
Alembic · scikit-learn `IsolationForest` (in-process, no separate ML service) ·
recurring detection via pandas, no ML · Resend over plain `httpx` for notifications ·
APScheduler for optional auto-sync (the only scheduler in the app; notifications
still have none of their own — they ride on whatever sync just ran) · CSV via
stdlib, PDF via `reportlab` · PostgreSQL 16 (Docker) · JWT auth + Fernet-encrypted
Plaid tokens.

## Setup

### Prerequisites

Node 20+, Python 3.10+, Docker. Optional: a free [Plaid](https://dashboard.plaid.com)
Sandbox key (only needed to link a live account — the demo user doesn't need it) and
a free [Resend](https://resend.com) key (notifications work without one, they just
log as "skipped" instead of sending).

### 1. Postgres

```bash
docker compose up -d
```

Runs on `localhost:5433`. User/db/volume are all `sentry` — see `docker-compose.yml`.

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt

cp .env.example .env
# Set TOKEN_ENCRYPTION_KEY (see comment in .env.example), JWT_SECRET_KEY;
# PLAID_CLIENT_ID/SECRET and RESEND_API_KEY are optional.

alembic upgrade head
uvicorn app.main:app --reload --port 8010
```

API docs: http://localhost:8010/docs

**Seed demo data:**

```bash
python scripts/seed_sandbox.py
```

~6 months of transactions across rent, subscriptions, groceries, dining, gas, and
travel, plus injected fraud anomalies, balance history, budgets, 3 savings goals with
partial progress, a demo category override, recurring-charge detection, and default
notification preferences. Prints the login.

**Tests:** `pytest` (58 tests across auth, budgets, fraud, net worth, recurring
detection, notifications, transaction search/override, insights, goals, export,
and auto-sync scheduling).

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://localhost:8010
npm run dev
```

Open http://localhost:3000.

## Using the app

1. Log in with the seeded demo user (or register a new one, then link a Sandbox
   account via Plaid Link — `user_good` / `pass_good`).
2. **Sync transactions** to pull new data, refresh balances, and re-run recurring
   detection + notifications.
3. Set budgets, review recurring charges (mute false positives), review fraud alerts,
   and configure notification granularity under **Settings**. Turn on automatic sync
   there too, and pick an interval on the slider — alerts still only fire *after* a
   sync, so this is what makes them arrive without you opening the app.
4. On **Transactions**, search, filter, and recategorize anything Plaid got wrong —
   the override sticks even after the next sync.
5. Check **Insights** for month-over-month spend, track progress on **Goals**, and
   export a CSV or annual PDF summary from the Insights page.

## Known limitations & scope cuts

Deliberate, not gaps I missed: Plaid Sandbox only (no webhooks, no Production) · not
deployed · no feedback-driven fraud retraining yet (recorded but unused — see
`docs/design-decisions.md`) · Resend's shared sender only delivers to your own account
without a verified domain · goal contributions increment a single total with no
per-contribution audit trail · PDF export is one annual summary, not a report builder ·
auto-sync only runs while the backend process is running — it's a scheduler, not a
cloud cron, so a laptop that's asleep for 2 days catches up on the next tick rather
than syncing precisely on schedule (why: `docs/design-decisions.md`) · auto-sync
defaults to off, since the seeded demo item's placeholder Plaid token can't actually
sync (it degrades gracefully — logs a failed status — but there's nothing to see).

## Related

`../finance-anomaly-detector` is a separate, earlier exploration of the same problem
space (pgvector + LLM explanations) — unrelated codebase, kept as a sibling project.
