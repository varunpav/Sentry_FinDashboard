# Sentry

A full-stack personal finance dashboard: link a bank account via Plaid, see where your
money goes, set monthly budgets, and get ML-based fraud alerts on your own spending
patterns.

Demo login (seeded data, no Plaid credentials needed): **`demo@sentryapp.dev`** /
**`demo12345`**

## What it does

- **Bank linking & sync** — Plaid Link (Sandbox) to connect an account, cursor-based
  `/transactions/sync` to pull transactions incrementally
- **Spending breakdown** — category and daily-trend charts over any month
- **Budgets** — per-category monthly limits with spend-vs-limit tracking
- **Fraud detection** — a per-user, unsupervised anomaly-detection model flags unusual
  transactions with plain-English reasons ("Amount is 6.6x your typical spend here",
  "First transaction at this merchant", "3 a.m. transaction") — see
  [`docs/design-decisions.md`](docs/design-decisions.md) for the full reasoning
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

## Setup

### Prerequisites

- Node 20+, Python 3.10+, Docker
- A free [Plaid](https://dashboard.plaid.com) account for Sandbox API keys (only
  needed if you want to link a live Sandbox account — the seeded demo user works
  without it)

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
anomalies, and seeds 3 monthly budgets chosen to land in each of the good/warning/
over-budget states so the dashboard isn't a blank slate on first look. Prints the
demo login.

**Run tests:** `pytest` (10 tests: auth, budget aggregation, fraud scoring against
synthetic fixtures with known injected anomalies).

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
   transactions are automatically scored for fraud.
4. Set monthly budgets per category on the **Budgets** page.
5. Review flagged transactions on the **Alerts** page and confirm or dismiss them.

## Known limitations & scope cuts

These were deliberate cuts to keep scope tight, not gaps I missed:

- **Plaid Sandbox only** — no Production access; real bank data was never the goal
- **No Plaid webhooks** — sync is a manual "Sync" button, not push-triggered
- **No notifications** — fraud alerts only surface in-app, no email/push
- **Not deployed** — runs locally only; no hosting/CI pipeline
- **No feedback-driven retraining** — confirming/dismissing a fraud flag is recorded
  (`FraudFlag.status`) but doesn't yet feed back into the model; see
  `docs/design-decisions.md` for what that would look like

## Related

`../finance-anomaly-detector` in this same workspace is a separate, earlier
exploration of the same problem space (pgvector embeddings + LLM-generated
explanations rather than engineered features + IsolationForest) — unrelated codebase,
kept as a sibling project.
