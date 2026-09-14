"""
BudKoszt Pro — Backend test suite (pytest)
Covers: auth, catalog seed, clients/projects CRUD, materials/labor CRUD,
AI analyze (Gemini), estimates edit + PDF.
"""
import os
import time
import uuid
import pytest
import requests

BASE = "https://estimate-pro-112.preview.emergentagent.com"
API = BASE + "/api"

TEST_EMAIL = "test@budkoszt.pl"
TEST_PASSWORD = "test123"

# Shared session across tests
_state = {"token": None, "user": None, "client_id": None, "project_id": None,
          "material_id": None, "labor_id": None, "estimate_id": None}


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _auth(sess):
    if _state["token"]:
        sess.headers.update({"Authorization": f"Bearer {_state['token']}"})
        return
    # Try login first
    r = sess.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code == 401:
        # Register
        r = sess.post(f"{API}/auth/register", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
            "name": "Jan Kowalski", "company_name": "Kowalski Instalacje"
        })
    assert r.status_code == 200, f"auth failed {r.status_code} {r.text}"
    data = r.json()
    _state["token"] = data["token"]
    _state["user"] = data["user"]
    sess.headers.update({"Authorization": f"Bearer {_state['token']}"})


# ------------------- Auth -------------------
class TestAuth:
    def test_login_or_register(self, s):
        _auth(s)
        assert _state["token"]
        assert _state["user"]["email"] == TEST_EMAIL

    def test_me(self, s):
        _auth(s)
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["email"] == TEST_EMAIL

    def test_profile_update(self, s):
        _auth(s)
        r = s.put(f"{API}/auth/profile", json={"phone": "+48 500 111 222", "nip": "1234567890"})
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["phone"] == "+48 500 111 222"
        assert u["nip"] == "1234567890"

    def test_login_invalid(self, s):
        r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code in (401, 403)


# ------------------- Catalog seed -------------------
class TestCatalogSeed:
    def test_materials_seeded(self, s):
        _auth(s)
        r = s.get(f"{API}/materials")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 25, f"expected ~30 seeded materials, got {len(data)}"

    def test_labor_seeded(self, s):
        _auth(s)
        r = s.get(f"{API}/labor-rates")
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 10, f"expected ~14 seeded labor rates, got {len(data)}"


# ------------------- Clients CRUD -------------------
class TestClients:
    def test_create_client(self, s):
        _auth(s)
        r = s.post(f"{API}/clients", json={
            "name": f"TEST_Klient_{uuid.uuid4().hex[:6]}",
            "company": "TEST_Sp. z o.o.",
            "phone": "+48 600 000 000",
            "email": "klient@test.pl"
        })
        assert r.status_code == 200
        doc = r.json()
        assert doc["client_id"]
        _state["client_id"] = doc["client_id"]

    def test_get_client(self, s):
        _auth(s)
        r = s.get(f"{API}/clients/{_state['client_id']}")
        assert r.status_code == 200
        assert r.json()["client_id"] == _state["client_id"]

    def test_list_clients(self, s):
        _auth(s)
        r = s.get(f"{API}/clients")
        assert r.status_code == 200
        assert any(c["client_id"] == _state["client_id"] for c in r.json())

    def test_update_client(self, s):
        _auth(s)
        r = s.put(f"{API}/clients/{_state['client_id']}", json={
            "name": "TEST_Klient_Updated",
            "company": "TEST_Update Sp. z o.o.",
            "phone": "+48 600 999 999",
            "email": "klient@test.pl"
        })
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Klient_Updated"


# ------------------- Projects CRUD -------------------
class TestProjects:
    def test_create_project(self, s):
        _auth(s)
        # self-heal in case TestClients ran on a different xdist worker
        if not _state["client_id"]:
            rc = s.post(f"{API}/clients", json={"name": f"TEST_Klient_{uuid.uuid4().hex[:6]}"})
            assert rc.status_code == 200
            _state["client_id"] = rc.json()["client_id"]
        r = s.post(f"{API}/projects", json={
            "client_id": _state["client_id"],
            "name": f"TEST_Inwestycja_{uuid.uuid4().hex[:6]}",
            "address": "ul. Testowa 1, Warszawa",
            "trade": "instalacje-sanitarne"
        })
        assert r.status_code == 200
        _state["project_id"] = r.json()["project_id"]

    def test_get_project(self, s):
        _auth(s)
        r = s.get(f"{API}/projects/{_state['project_id']}")
        assert r.status_code == 200
        p = r.json()
        assert p["project_id"] == _state["project_id"]
        assert p["client"] is not None

    def test_list_projects(self, s):
        _auth(s)
        r = s.get(f"{API}/projects")
        assert r.status_code == 200
        assert any(p["project_id"] == _state["project_id"] for p in r.json())

    def test_update_project(self, s):
        _auth(s)
        r = s.put(f"{API}/projects/{_state['project_id']}", json={
            "client_id": _state["client_id"],
            "name": "TEST_Inwestycja_Updated",
            "address": "ul. Nowa 2",
            "trade": "elektryka"
        })
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Inwestycja_Updated"


# ------------------- Materials CRUD -------------------
class TestMaterials:
    def test_create_material(self, s):
        _auth(s)
        r = s.post(f"{API}/materials", json={
            "name": "TEST_Farba biała",
            "category": "wykonczeniowka",
            "unit": "l",
            "unit_price": 45.50
        })
        assert r.status_code == 200
        _state["material_id"] = r.json()["material_id"]

    def test_update_material(self, s):
        _auth(s)
        r = s.put(f"{API}/materials/{_state['material_id']}", json={
            "name": "TEST_Farba biała PRO",
            "category": "wykonczeniowka",
            "unit": "l",
            "unit_price": 55.00
        })
        assert r.status_code == 200
        assert r.json()["unit_price"] == 55.00

    def test_delete_material(self, s):
        _auth(s)
        r = s.delete(f"{API}/materials/{_state['material_id']}")
        assert r.status_code == 200
        # verify absent
        r2 = s.get(f"{API}/materials")
        assert not any(m["material_id"] == _state["material_id"] for m in r2.json())


class TestLabor:
    def test_create_labor(self, s):
        _auth(s)
        r = s.post(f"{API}/labor-rates", json={
            "name": "TEST_Malowanie", "category": "wykonczeniowka",
            "unit": "m2", "rate": 25.0
        })
        assert r.status_code == 200
        _state["labor_id"] = r.json()["labor_id"]

    def test_update_labor(self, s):
        _auth(s)
        r = s.put(f"{API}/labor-rates/{_state['labor_id']}", json={
            "name": "TEST_Malowanie PRO", "category": "wykonczeniowka",
            "unit": "m2", "rate": 30.0
        })
        assert r.status_code == 200
        assert r.json()["rate"] == 30.0

    def test_delete_labor(self, s):
        _auth(s)
        r = s.delete(f"{API}/labor-rates/{_state['labor_id']}")
        assert r.status_code == 200


# ------------------- AI analyze (Gemini) + Estimate edit + PDF -------------------
# Kept in a SINGLE class so xdist loadscope pins them to one worker (shared _state).
class TestAIEstimatePDF:
    def test_analyze_text_only(self, s):
        _auth(s)
        # ensure a project exists even if TestProjects ran on another worker
        if not _state["project_id"]:
            if not _state["client_id"]:
                rc = s.post(f"{API}/clients", json={"name": "TEST_AI_Klient"})
                assert rc.status_code == 200
                _state["client_id"] = rc.json()["client_id"]
            rp = s.post(f"{API}/projects", json={
                "client_id": _state["client_id"],
                "name": "TEST_AI_Inwestycja",
                "trade": "instalacje-sanitarne"
            })
            assert rp.status_code == 200
            _state["project_id"] = rp.json()["project_id"]
        payload = {
            "project_id": _state["project_id"],
            "description": (
                "Łazienka 6 m2 do kompleksowego remontu. Skucie starych "
                "płytek, nowa hydraulika, ułożenie glazury i terakoty, "
                "montaż wanny, umywalki, WC oraz baterii. Malowanie sufitu."
            ),
            "trade": "instalacje-sanitarne",
            "image_paths": []
        }
        r = s.post(f"{API}/ai/analyze", json=payload, timeout=90)
        assert r.status_code == 200, f"AI analyze failed: {r.status_code} {r.text[:300]}"
        est = r.json()
        assert est.get("estimate_id")
        assert isinstance(est.get("items"), list) and len(est["items"]) >= 3, \
            f"expected multiple items, got {len(est.get('items', []))}"
        assert est.get("scope_summary")
        assert "totals" in est and est["totals"].get("gross", 0) > 0
        _state["estimate_id"] = est["estimate_id"]

    def test_get_estimate(self, s):
        _auth(s)
        assert _state["estimate_id"], "AI analyze must run before this"
        r = s.get(f"{API}/estimates/{_state['estimate_id']}")
        assert r.status_code == 200
        est = r.json()
        assert est["totals"]["gross"] > 0

    def test_update_items_and_totals(self, s):
        _auth(s)
        r = s.get(f"{API}/estimates/{_state['estimate_id']}")
        est = r.json()
        items = est["items"]
        # bump first item qty
        items[0]["quantity"] = float(items[0].get("quantity", 1)) + 5
        items[0]["unit_price"] = 123.45
        r2 = s.put(f"{API}/estimates/{_state['estimate_id']}", json={
            "items": items, "markup_percent": 15, "discount_percent": 5,
            "vat_percent": 23, "status": "sent"
        })
        assert r2.status_code == 200
        upd = r2.json()
        assert upd["markup_percent"] == 15
        assert upd["discount_percent"] == 5
        assert upd["status"] == "sent"
        # totals recomputed
        assert upd["totals"]["subtotal"] > 0
        assert upd["totals"]["gross"] > upd["totals"]["net"]

    def test_pdf_download(self, s):
        _auth(s)
        token = _state["token"]
        # PDF endpoint uses ?token= (also header). Use plain requests to check bytes.
        url = f"{API}/estimates/{_state['estimate_id']}/pdf?token={token}"
        r = requests.get(url, timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"


# ------------------- Cleanup -------------------
class TestZCleanup:
    def test_delete_project(self, s):
        _auth(s)
        if _state["project_id"]:
            r = s.delete(f"{API}/projects/{_state['project_id']}")
            assert r.status_code == 200

    def test_delete_client(self, s):
        _auth(s)
        if _state["client_id"]:
            r = s.delete(f"{API}/clients/{_state['client_id']}")
            assert r.status_code == 200
