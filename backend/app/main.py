from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import auth, budgets, fraud, plaid, transactions

settings = get_settings()

app = FastAPI(title="Sentry API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(plaid.router)
app.include_router(transactions.router)
app.include_router(budgets.router)
app.include_router(fraud.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
