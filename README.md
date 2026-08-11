# Sentry

A full-stack personal finance dashboard: link a bank account via Plaid, see where your
money goes and how your net worth trends, set monthly budgets, catch recurring
subscriptions and upcoming bills automatically, and get ML-based fraud alerts on your
own spending patterns — with email notifications you control the granularity of.

Demo login (seeded data, no Plaid credentials needed): **`demo@sentryapp.dev`** /
**`demo12345`**

## What it does

- **Bank linking & sync** — Plaid Link (Sandbox) to connect an account, cursor-based
  `/transactions/sync` to pull transactions incrementally, with balances refreshed on
  every sync (not just at link time)
- **Spending breakdown** — category and daily-trend charts over any month
- **Net worth tracking** — daily balance snapshots roll up into an assets-vs-liabilities
  trend line, classified from Plaid account types
- **Budgets** — per-category monthly limits with spend-vs-limit tracking
- **Recurring charges & bill reminders** — detects subscriptions and regular bills
  purely from transaction history (cadence, amount stability, next due date) — see
  [`docs/design-decisions.md`](docs/design-decisions.md) for how
- **Fraud detection** — a per-user, unsupervised anomaly-detection model flags unusual
  transactions with plain-English reasons ("Amount is 6.6x your typical spend here",
  "First transaction at this merchant", "3 a.m. transaction") — see
  [`docs/design-decisions.md`](docs/design-decisions.md) for the full reasoning
- **Configurable email notifications** — budget-threshold alerts, bill reminders, fraud
  alerts, and a weekly digest, each independently toggleable, sent via Resend
- **Auth** — JWT access/refresh tokens, multi-user

## Architecture

```
┌─────────────┐        ┌──────────────────┐        ┌──────────────┐
│   Next.js    │  REST  │     FastAPI       │  SQL   │  PostgreSQL   │
│  (dashboard, │◄──────►│  (auth, budgets,  │◄──────►│  (users,      │
│  charts,     │  JWT   │  sync, fraud      │        │  transactions,│
│  Plaid Link) │        │  scoring)         │        │  budgets, ...)│
└─────────────┘        └─────────┬─────────┘        └──────────────┘
                                  │
                        ┌─────────┴─────────┐
                        ▼                   ▼
                ┌───────────────┐   ┌──────────────────┐
                │   Plaid API   │   │  IsolationForest  │
                │   (Sandbox)   │   │  one model/user,  │
                └───────────────┘   │  joblib-persisted │
                                     └──────────────────┘
```

- **Frontend:** Next.js 16 (App Router, TypeScript), Tailwind, Recharts, `react-plaid-link`
- **Backend:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, `plaid-python`
- **ML:** scikit-learn `IsolationForest` + pandas feature engineering, running inside
  the FastAPI process — no separate ML service
- **Recurring detection:** pure Python/pandas over transaction history — no ML model,
  no new dependency (see [`docs/design-decisions.md`](docs/design-decisions.md))
- **Notifications:** [Resend](https://resend.com) over plain `httpx`, no SDK, no
  background scheduler — evaluated on sync or on demand (see Setup below)
- **Database:** PostgreSQL 16 (Docker)
- **Auth:** JWT (access + refresh), bcrypt password hashing; Plaid access tokens
  encrypted at rest with Fernet

Repo layout: `backend/app/{models,schemas,routers,services,ml}`,
`backend/scripts/seed_sandbox.py` (demo data), `frontend/src/{app,components,lib}`.

## Fraud detection, in short

Real fraud labels don't exist for a personal account, so this isn't a trained
classifier — it's a per-user `IsolationForest` that learns what "normal" looks like
from that user's own transaction history, then flags whatever doesn't fit. Features
are computed relative to the user's own history (log amount, category z-score,
new-merchant flag, days since last seen at a merchant, hour/day, 24h transaction
velocity, category rarity), which is what makes a $400 charge unremarkable for one
account and glaring for another. Below a transaction-count threshold, scoring falls
back to a shared model trained across all users as a cold-start compromise.

Full writeup — including why Isolation Forest over alternatives, and what
feedback-driven retraining would look like if built out — is in
[`docs/design-decisions.md`](docs/design-decisions.md).

## Recurring charges & bills, in short

No ML here — subscriptions and bills are detected by grouping transactions by
normalized merchant name, classifying the cadence from the gaps between occurrences
(weekly/monthly/etc.), and requiring that cadence to actually be regular before calling
it "recurring." A merchant that stops recurring is marked inactive rather than deleted,
so a cancelled subscription doesn't just vanish from your history. Full reasoning,
including a real false-positive this approach produced against the seeded demo data and
how it's guarded against, is in
[`docs/design-decisions.md`](docs/design-decisions.md).

## Setup

### Prerequisites

- Node 20+, Python 3.10+, Docker
- A free [Plaid](https://dashboard.plaid.com) account for Sandbox API keys (only
  needed if you want to link a live Sandbox account — the seeded demo user works
  without it)
- Optionally, a free [Resend](https://resend.com) API key if you want notifications to
  actually send email — without one, the app still runs and evaluates notifications
  normally, they just log as "skipped" instead of sending (see Setup below)

### 1. Start Postgres

```bash
docker compose up -d
```

Runs Postgres on `localhost:5433` (remapped from the default 5432 in case you already
have a local Postgres instance running there — check `docker-compose.yml` and
`backend/.env` if you need to change it). Uses a named volume (`sentry_pg_data`) and
a `sentry`/`sentry` user/db, both defined in `docker-compose.yml`.

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use .venv\Scripts\activate.bat for cmd
pip install -r requirements.txt

cp .env.example .env
# Edit .env:
#   - TOKEN_ENCRYPTION_KEY: generate with
#     python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#   - PLAID_CLIENT_ID / PLAID_SECRET: from https://dashboard.plaid.com (Sandbox keys)
#   - JWT_SECRET_KEY: any long random string
#   - RESEND_API_KEY: optional, from https://resend.com — leave blank and
#     notifications still evaluate and log, they just don't send

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API docs at http://localhost:8000/docs.

**Seed demo data** (recommended — Plaid Sandbox accounts start with sparse
transaction history, which isn't enough to train the fraud model or make the charts
interesting):

```bash
python scripts/seed_sandbox.py
```

Generates ~6 months of realistic synthetic transactions plus a few injected
anomalies, backfills matching daily balance snapshots so the net worth trend isn't
flat, seeds 3 monthly budgets chosen to land in each of the good/warning/over-budget
states, runs recurring-charge detection, and creates default notification preferences
— so nothing on first login is a blank slate. Prints the demo login.

**Run tests:** `pytest` (25 tests: auth, budget aggregation, fraud scoring against
synthetic fixtures with known injected anomalies, net worth classification/rollup,
recurring-charge detection, and notification dedup).

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # defaults to http://localhost:8000
npm run dev
```

Open http://localhost:3000.

## Using the app

1. Register a new account, or log in with the seeded demo user.
2. On the dashboard, click **Link a bank account** to connect via Plaid Link
   (Sandbox credentials: username `user_good`, password `pass_good`, any institution).
   The demo user already has seeded transactions and doesn't need this step.
3. Click **Sync transactions** any time to pull new transactions from Plaid — new
   transactions are automatically scored for fraud, balances refresh, and recurring
   charges + notifications re-evaluate.
4. Set monthly budgets per category on the **Budgets** page.
5. Review detected subscriptions and upcoming bills on the **Recurring** page; mute
   any false positive.
6. Review flagged transactions on the **Alerts** page and confirm or dismiss them.
7. On **Settings → Notifications**, choose which alerts you want and at what
   granularity, then use **Run check now** to evaluate immediately instead of waiting
   for the next sync.

## Known limitations & scope cuts

These were deliberate cuts to keep scope tight, not gaps I missed:

- **Plaid Sandbox only** — no Production access; real bank data was never the goal
- **No Plaid webhooks** — sync is a manual "Sync" button, not push-triggered
- **Not deployed** — runs locally only; no hosting/CI pipeline
- **No feedback-driven fraud retraining** — confirming/dismissing a fraud flag is
  recorded (`FraudFlag.status`) but doesn't yet feed back into the model; see
  `docs/design-decisions.md` for what that would look like
- **No background scheduler for notifications** — evaluation runs on sync or via the
  explicit `/notifications/run` endpoint, not on a timer; see `docs/design-decisions.md`
  for why that's a deliberate choice, not an oversight
- **Resend's shared sender only delivers to your own Resend account address** —
  sending to arbitrary recipients needs a verified domain, out of scope for a
  single-user POC
- **No savings goals, no CSV/PDF export, no manual transaction-category override, no
  transaction search, no month-over-month spend comparison** — all scoped out to keep
  this pass focused on net worth, recurring detection, and notifications

## Related

`../finance-anomaly-detector` in this same workspace is a separate, earlier
exploration of the same problem space (pgvector embeddings + LLM-generated
explanations rather than engineered features + IsolationForest) — unrelated codebase,
kept as a sibling project.
