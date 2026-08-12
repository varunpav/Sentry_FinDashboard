from datetime import date


def _auth(client, auth_headers):
    return auth_headers()


def test_create_and_list_goal(client, auth_headers):
    headers = auth_headers()
    resp = client.post(
        "/goals", json={"name": "Emergency Fund", "target_amount": 10000, "target_date": "2027-01-01"}, headers=headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Emergency Fund"
    assert body["current_amount"] == 0.0
    assert body["progress_pct"] == 0.0
    assert body["status"] == "active"

    listed = client.get("/goals", headers=headers).json()
    assert len(listed["goals"]) == 1
    assert listed["total_target"] == 10000.0
    assert listed["total_saved"] == 0.0


def test_contribute_increments_and_computes_progress(client, auth_headers):
    headers = auth_headers()
    goal = client.post("/goals", json={"name": "Vacation", "target_amount": 2000}, headers=headers).json()

    resp = client.post(f"/goals/{goal['id']}/contribute", json={"amount": 500}, headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["current_amount"] == 500.0
    assert body["progress_pct"] == 25.0
    assert body["status"] == "active"


def test_contribute_past_target_flips_status_to_achieved(client, auth_headers):
    headers = auth_headers()
    goal = client.post("/goals", json={"name": "New Laptop", "target_amount": 1000}, headers=headers).json()

    client.post(f"/goals/{goal['id']}/contribute", json={"amount": 600}, headers=headers)
    resp = client.post(f"/goals/{goal['id']}/contribute", json={"amount": 500}, headers=headers)
    body = resp.json()
    assert body["current_amount"] == 1100.0
    assert body["progress_pct"] == 100.0  # capped, not 110%
    assert body["status"] == "achieved"


def test_delete_goal(client, auth_headers):
    headers = auth_headers()
    goal = client.post("/goals", json={"name": "Temp", "target_amount": 100}, headers=headers).json()

    resp = client.delete(f"/goals/{goal['id']}", headers=headers)
    assert resp.status_code == 204

    listed = client.get("/goals", headers=headers).json()
    assert listed["goals"] == []


def test_goal_not_found_for_another_user(client, auth_headers):
    owner_headers = auth_headers(email="owner@example.com")
    goal = client.post("/goals", json={"name": "Owner Goal", "target_amount": 500}, headers=owner_headers).json()

    intruder_headers = auth_headers(email="intruder@example.com")
    resp = client.post(f"/goals/{goal['id']}/contribute", json={"amount": 10}, headers=intruder_headers)
    assert resp.status_code == 404
