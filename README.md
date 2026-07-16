# FinTrack

A full-stack personal finance dashboard: link a bank account via Plaid, see where your
money goes, set monthly budgets, and get ML-based fraud alerts.

- **Frontend:** Next.js 16 (App Router, TypeScript, Tailwind, Recharts)
- **Backend:** FastAPI, SQLAlchemy, Alembic, Postgres
- **Bank data:** Plaid (Sandbox)
- **Fraud detection:** per-user Isolation Forest (scikit-learn), trained on each user's
  own transaction history

## Prerequisites

- Node 20+, Python 3.10+, Docker
- A free [Plaid](https://dashboard.plaid.com) account for Sandbox API keys

## 1. Start Postgres

```bash
docker compose up -d
```

Runs Postgres on `localhost:5433` (remapped from the default 5432 in case you already
have a local Postgres instance running there — check `docker-compose.yml` and
`backend/.env` if you need to change it).

## 2. Backend setup

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

### Seed demo data (recommended)

Plaid Sandbox accounts start with sparse transaction history, which isn't enough to
train the fraud model or make the charts interesting. Run this to generate ~6 months
of realistic synthetic transactions (with a few injected anomalies) for a demo user:

```bash
python scripts/seed_sandbox.py
```

Prints a demo login (default `demo@fintrackapp.dev` / `demo12345`).

### Run tests

```bash
pytest
```

## 3. Frontend setup

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

## Notes

- Fraud detection trains a personal model per user once they have enough transaction
  history (default: 50+); below that it falls back to a shared model trained across
  all users. Trigger a full retrain with `POST /fraud/retrain`.
- Only Plaid Sandbox is supported (see the plan's non-goals) — no real bank data.
