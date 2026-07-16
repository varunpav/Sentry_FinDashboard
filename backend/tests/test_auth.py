def test_register_and_me(client):
    resp = client.post("/auth/register", json={"email": "a@example.com", "password": "password123"})
    assert resp.status_code == 201
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "a@example.com"


def test_register_duplicate_email_conflicts(client):
    client.post("/auth/register", json={"email": "dup@example.com", "password": "password123"})
    resp = client.post("/auth/register", json={"email": "dup@example.com", "password": "password123"})
    assert resp.status_code == 409


def test_login_success_and_failure(client):
    client.post("/auth/register", json={"email": "b@example.com", "password": "correcthorse"})

    good = client.post("/auth/login", json={"email": "b@example.com", "password": "correcthorse"})
    assert good.status_code == 200

    bad = client.post("/auth/login", json={"email": "b@example.com", "password": "wrongpass"})
    assert bad.status_code == 401


def test_refresh_token_issues_new_access_token(client):
    reg = client.post("/auth/register", json={"email": "c@example.com", "password": "password123"})
    refresh_token = reg.json()["refresh_token"]

    resp = client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_protected_route_requires_auth(client):
    resp = client.get("/auth/me")
    assert resp.status_code in (401, 403)
