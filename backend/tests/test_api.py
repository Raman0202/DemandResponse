from fastapi.testclient import TestClient

from app import app


def _token(c, user):
    return c.post("/api/login", json={"username": user, "password": "demo"}).json()["token"]


def test_login_and_rbac():
    with TestClient(app) as c:
        assert c.post("/api/login", json={"username": "operator", "password": "x"}).status_code == 401
        op = _token(c, "operator")
        h = {"Authorization": f"Bearer {op}"}
        assert c.get("/api/snapshot").status_code == 401
        snap = c.get("/api/snapshot", headers=h).json()
        assert snap["app"] == "GNA (Demand Response)"
        # operators cannot load DSM tables
        assert c.post("/api/action/prices", json={"dam": 5}, headers=h).status_code == 403
        eng = {"Authorization": f"Bearer {_token(c, 'engineer')}"}
        assert c.post("/api/action/prices", json={"dam": 5.4}, headers=eng).status_code == 200
        assert c.get("/api/audit/verify", headers=h).json()["ok"]


def test_whatif():
    with TestClient(app) as c:
        h = {"Authorization": f"Bearer {_token(c, 'analyst')}"}
        r = c.post("/api/whatif", json={"shortage": 1200, "minutes": 60, "participation": 0.7}, headers=h).json()
        assert r["no_action"]["dsm_rs"] > r["flex_first"]["total_rs"]


def test_industry_portal_isolation_and_offer_flow():
    with TestClient(app) as c:
        h = {"Authorization": f"Bearer {_token(c, 'jsw')}"}
        assert c.get("/api/snapshot", headers=h).status_code == 403
        portal = c.get("/api/industry/portal", headers=h).json()
        assert portal["participant"]["id"] == "P_JSW"
        assert len(portal["needs"]) == 24 and portal["programmes"]
        bad = c.post("/api/industry/offer", headers=h, json={"programme": "PRG-EVE", "mw": 999, "start_h": 18, "end_h": 22,
                                                             "response_min": 10, "max_duration_min": 60, "price_rs_mwh": 5000})
        assert bad.status_code == 409 and "declared flexible range" in bad.json()["detail"]
        ok = c.post("/api/industry/offer", headers=h, json={"programme": "PRG-EVE", "mw": 50, "start_h": 18, "end_h": 22,
                                                            "response_min": 10, "max_duration_min": 60, "price_rs_mwh": 5000})
        assert ok.status_code == 200
        oid = ok.json()["id"]
        sic = {"Authorization": f"Bearer {_token(c, 'sic1')}"}
        snap = c.get("/api/snapshot", headers=sic).json()
        assert any(o["id"] == oid and o["status"] == "PENDING" for o in snap["gridflex"]["offers"])
        g = {"Authorization": f"Bearer {_token(c, 'guest')}"}
        assert c.post("/api/industry/offer", headers=g, json={}).status_code == 409
        assert c.post("/api/industry/apply", headers=g, json={"company": "ACME Alloys", "discom": "HESCOM", "sector": "Steel",
                                                             "flexible_mw": 25, "contact": "ops@acme.example"}).status_code == 200
