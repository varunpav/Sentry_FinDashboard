import os

os.environ.setdefault("TOKEN_ENCRYPTION_KEY", "kQ8f3n1yZk8v3nq2C9c1h1s5b9m6h9y0N3x8f2a9k7Q=")
os.environ.setdefault("DATABASE_URL", "sqlite://")
# Belt-and-braces: TestClient(app) without a `with` block never triggers the lifespan
# handler anyway, but this guarantees a live scheduler thread can never start in tests.
os.environ.setdefault("SCHEDULER_ENABLED", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)


@pytest.fixture(autouse=True)
def _reset_db():
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


def _override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def auth_headers(client):
    def _make(email: str = "test@example.com", password: str = "hunter2pass"):
        resp = client.post("/auth/register", json={"email": email, "password": password})
        assert resp.status_code == 201, resp.text
        token = resp.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _make
