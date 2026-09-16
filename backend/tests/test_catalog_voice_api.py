"""
BudKoszt Pro – Catalog expansion + Voice-edit LIVE API test suite.

Covers the review request:
 - New catalog fields (trade, subcategory, manufacturer, sku, specs, price_is_example)
   present on /api/materials and /api/labor-rates. Seed top-up expected ~132/58.
 - POST/PUT /api/materials & /api/labor-rates set price_is_example=False
   and persist all new fields; DELETE soft-deletes.
 - POST /api/voice/parse-command (context=catalog | estimate) returns transcription
   + resolved actions[] with proper status/catalog_id/label. Uses real Gemini via
   Emergent LLM key.
 - POST /api/catalog/voice-apply actually mutates the database
   (set_price, bump_prices, add_item, delete_item).
 - Regression: auth login, estimates list, /api/ai/analyze reachable (async 200).
 - AI never invents prices: set_price only present when a numeric amount was said.
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL",
                     "https://estimate-pro-112.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

TEST_EMAIL = "test@budkoszt.pl"
TEST_PASSWORD = "test123"

state = {"token": None, "user": None}


# --------------------------- fixtures ---------------------------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    r = sess.post(f"{API}/auth/login",
                  json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=20)
    if r.status_code == 401:
        r = sess.post(f"{API}/auth/register", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
            "name": "Jan Kowalski", "company_name": "Kowalski Instalacje",
        }, timeout=20)
    assert r.status_code == 200, f"auth failed {r.status_code} {r.text[:200]}"
    d = r.json()
    state["token"] = d["token"]
    state["user"] = d["user"]
    sess.headers["Authorization"] = f"Bearer {state['token']}"
    return sess


# --------------------------- helpers ---------------------------
def _find_material_by_name(materials, needle):
    for m in materials:
        if needle.lower() in m.get("name", "").lower():
            return m
    return None


# =====================================================================
# 1. Catalog: seed shape and counts
# =====================================================================
class TestCatalogShape:
    def test_materials_new_fields_present(self, s):
        r = s.get(f"{API}/materials", timeout=20)
        assert r.status_code == 200
        mats = r.json()
        assert len(mats) >= 100, f"expected ~132 materials after seed top-up, got {len(mats)}"
        # every doc should carry new fields
        required = {"trade", "subcategory", "manufacturer", "sku", "specs", "price_is_example"}
        sample = mats[0]
        assert required.issubset(sample.keys()), f"missing fields: {required - sample.keys()}"
        # at least one row is example-flagged (seed) and covers 'elektryka'
        assert any(m.get("price_is_example") is True for m in mats)
        trades = {m.get("trade") for m in mats}
        for t in ("elektryka", "hydraulika", "pv", "hvac", "gaz", "cctv", "alarmy",
                  "sieci_lan", "ogolnobudowlana"):
            assert t in trades, f"trade '{t}' missing from materials seed"

    def test_labor_new_fields_present(self, s):
        r = s.get(f"{API}/labor-rates", timeout=20)
        assert r.status_code == 200
        lab = r.json()
        assert len(lab) >= 40, f"expected ~58 labor rates, got {len(lab)}"
        required = {"trade", "subcategory", "price_is_example"}
        assert required.issubset(lab[0].keys())
        trades = {l.get("trade") for l in lab}
        assert "elektryka" in trades and "ogolnobudowlana" in trades

    def test_ydy_3x25_seeded_with_trade(self, s):
        # Note: price_is_example may be False if a previous run set the user price;
        # user-priority is expected. We only assert structural seed presence + trade.
        mats = s.get(f"{API}/materials", timeout=20).json()
        ydy = _find_material_by_name(mats, "YDYp 3x2,5")
        assert ydy is not None, "seed missing 'Przewód YDYp 3x2,5'"
        assert ydy["trade"] == "elektryka"
        assert ydy["unit"] == "mb"
        # at least one YDYp-family seed should still carry the example flag
        family = [m for m in mats if "YDYp" in m.get("name", "")]
        assert any(m.get("price_is_example") is True for m in family), \
            "no YDYp family item is example-priced; seed flag missing"


# =====================================================================
# 2. Catalog CRUD (materials + labor)
# =====================================================================
class TestCatalogCRUD:
    def test_create_material_sets_user_priority(self, s):
        body = {
            "name": f"TEST_M_{uuid.uuid4().hex[:6]}",
            "trade": "elektryka", "subcategory": "Osprzęt",
            "unit": "szt", "unit_price": 12.5,
            "manufacturer": "ACME", "sku": "SKU-1", "specs": "IP20",
        }
        r = s.post(f"{API}/materials", json=body, timeout=15)
        assert r.status_code == 200, r.text[:300]
        doc = r.json()
        assert doc["price_is_example"] is False
        assert doc["manufacturer"] == "ACME" and doc["sku"] == "SKU-1" and doc["specs"] == "IP20"
        assert doc["trade"] == "elektryka" and doc["subcategory"] == "Osprzęt"
        # persistence via GET
        mats = s.get(f"{API}/materials", timeout=15).json()
        got = next((m for m in mats if m["material_id"] == doc["material_id"]), None)
        assert got is not None and got["unit_price"] == 12.5
        state["_mat_id"] = doc["material_id"]

    def test_update_material_clears_example_flag(self, s):
        # take a seeded elektryka material with price_is_example=True
        mats = s.get(f"{API}/materials", timeout=15).json()
        seeded = next((m for m in mats
                       if m.get("price_is_example") and m.get("trade") == "elektryka"), None)
        assert seeded is not None, "no example-priced elektryka material to update"
        body = {
            "name": seeded["name"], "trade": seeded["trade"],
            "subcategory": seeded.get("subcategory") or "",
            "unit": seeded["unit"], "unit_price": 99.99,
            "manufacturer": seeded.get("manufacturer") or "",
            "sku": seeded.get("sku") or "", "specs": seeded.get("specs") or "",
        }
        r = s.put(f"{API}/materials/{seeded['material_id']}", json=body, timeout=15)
        assert r.status_code == 200
        upd = r.json()
        assert upd["price_is_example"] is False
        assert upd["unit_price"] == 99.99
        state["_seeded_mat_id"] = seeded["material_id"]
        state["_seeded_mat_original_price"] = seeded["unit_price"]

    def test_delete_material_soft(self, s):
        mid = state.get("_mat_id")
        assert mid
        r = s.delete(f"{API}/materials/{mid}", timeout=15)
        assert r.status_code == 200 and r.json().get("ok") is True
        mats = s.get(f"{API}/materials", timeout=15).json()
        assert not any(m["material_id"] == mid for m in mats), "deleted material still listed"

    def test_labor_crud_roundtrip(self, s):
        body = {
            "name": f"TEST_L_{uuid.uuid4().hex[:6]}", "trade": "elektryka",
            "subcategory": "Instalacje", "unit": "pkt", "rate": 77.0,
        }
        r = s.post(f"{API}/labor-rates", json=body, timeout=15)
        assert r.status_code == 200
        lab = r.json()
        assert lab["price_is_example"] is False and lab["rate"] == 77.0
        assert lab["trade"] == "elektryka" and lab["subcategory"] == "Instalacje"
        lid = lab["labor_id"]
        # update rate
        body2 = {**body, "rate": 88.0}
        r2 = s.put(f"{API}/labor-rates/{lid}", json=body2, timeout=15)
        assert r2.status_code == 200 and r2.json()["rate"] == 88.0
        assert r2.json()["price_is_example"] is False
        # delete
        assert s.delete(f"{API}/labor-rates/{lid}", timeout=15).status_code == 200
        lst = s.get(f"{API}/labor-rates", timeout=15).json()
        assert not any(l["labor_id"] == lid for l in lst)


# =====================================================================
# 3. Voice parsing – catalog context (real Gemini)
# =====================================================================
class TestVoiceParseCatalog:
    def test_set_price_ydy(self, s):
        payload = {"context": "catalog",
                   "text": "Zmień cenę YDY 3x2,5 na 8 zł za metr"}
        r = s.post(f"{API}/voice/parse-command", json=payload, timeout=60)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert isinstance(data.get("actions"), list) and len(data["actions"]) >= 1
        sp = next((a for a in data["actions"] if a.get("op") == "set_price"), None)
        assert sp is not None, f"no set_price action, got: {data['actions']}"
        assert sp.get("status") == "ok", f"resolve status: {sp}"
        # catalog_id resolved to some seeded YDYp material
        assert sp.get("catalog_id")
        mats = s.get(f"{API}/materials", timeout=15).json()
        got = next((m for m in mats if m["material_id"] == sp["catalog_id"]), None)
        assert got is not None and "YDYp 3x2,5" in got["name"]
        assert isinstance(sp.get("label"), str) and len(sp["label"]) > 0
        assert float(sp.get("new_price")) == 8.0

    def test_bump_labor_elektryka(self, s):
        payload = {"context": "catalog",
                   "text": "Podnieś ceny robocizny w elektryce o 10%"}
        r = s.post(f"{API}/voice/parse-command", json=payload, timeout=60)
        assert r.status_code == 200
        actions = r.json().get("actions", [])
        bp = next((a for a in actions if a.get("op") == "bump_prices"), None)
        assert bp is not None, f"no bump_prices action: {actions}"
        assert bp.get("item_kind") == "labor"
        # trade may be 'elektryka' - accept both spellings
        assert (bp.get("trade") or "").lower().startswith("elektryk")
        assert float(bp.get("percent")) == 10.0
        assert bp.get("status") == "ok"

    def test_add_item_gniazdo(self, s):
        payload = {"context": "catalog", "text": "Dodaj gniazdo podwójne po 22 zł"}
        r = s.post(f"{API}/voice/parse-command", json=payload, timeout=60)
        assert r.status_code == 200
        actions = r.json().get("actions", [])
        ai = next((a for a in actions if a.get("op") == "add_item"), None)
        assert ai is not None, f"no add_item action: {actions}"
        assert float(ai.get("price") or 0) == 22.0
        assert "gniazdo" in (ai.get("name") or "").lower()

    def test_ai_does_not_invent_prices(self, s):
        # NO explicit amount in the sentence -> AI must not fabricate a new_price
        payload = {"context": "catalog",
                   "text": "Zmień cenę przewodu YDY 3x2,5"}
        r = s.post(f"{API}/voice/parse-command", json=payload, timeout=60)
        assert r.status_code == 200
        for a in r.json().get("actions", []):
            if a.get("op") == "set_price":
                # either no price OR requires_confirmation status – never a random price
                np_ = a.get("new_price")
                assert np_ in (None, 0, 0.0, "") or a.get("status") in (
                    "needs_confirmation", "ambiguous", "requires_confirmation"), \
                    f"AI invented a price: {a}"


# =====================================================================
# 4. Voice parsing – estimate context
# =====================================================================
class TestVoiceParseEstimate:
    def test_add_20_points(self, s):
        payload = {
            "context": "estimate",
            "text": "Dodaj 20 punktów elektrycznych po 85 zł",
            "estimate_items": [
                {"name": "Punkt elektryczny podtynkowy", "unit": "pkt",
                 "quantity": 10, "unit_price": 85},
            ],
        }
        r = s.post(f"{API}/voice/parse-command", json=payload, timeout=60)
        assert r.status_code == 200
        actions = r.json().get("actions", [])
        ai = next((a for a in actions if a.get("op") == "add_item"), None)
        assert ai is not None, f"no add_item: {actions}"
        assert float(ai.get("quantity") or 0) == 20.0
        assert float(ai.get("price") or ai.get("unit_price") or 0) == 85.0

    def test_delete_last(self, s):
        payload = {
            "context": "estimate", "text": "usuń ostatnią pozycję",
            "estimate_items": [
                {"name": "Punkt elektryczny podtynkowy", "unit": "pkt",
                 "quantity": 10, "unit_price": 85},
                {"name": "Przewód YDYp 3x2,5", "unit": "mb",
                 "quantity": 50, "unit_price": 4.8},
            ],
        }
        r = s.post(f"{API}/voice/parse-command", json=payload, timeout=60)
        assert r.status_code == 200
        actions = r.json().get("actions", [])
        di = next((a for a in actions if a.get("op") == "delete_item"), None)
        assert di is not None, f"no delete_item: {actions}"
        assert di.get("status") == "ok"
        assert di.get("index") == 1  # last of two items


# =====================================================================
# 5. Voice apply – actual DB mutations
# =====================================================================
class TestVoiceApply:
    def test_apply_set_price(self, s):
        mats = s.get(f"{API}/materials", timeout=15).json()
        target = _find_material_by_name(mats, "YDYp 3x1,5")
        assert target is not None
        mid = target["material_id"]
        body = {"actions": [{
            "op": "set_price", "item_kind": "material",
            "catalog_id": mid, "new_price": 8.0,
        }]}
        r = s.post(f"{API}/catalog/voice-apply", json=body, timeout=20)
        assert r.status_code == 200
        assert r.json()["count"] == 1
        # verify persisted
        mats2 = s.get(f"{API}/materials", timeout=15).json()
        got = next(m for m in mats2 if m["material_id"] == mid)
        assert got["unit_price"] == 8.0
        assert got["price_is_example"] is False

    def test_apply_bump_labor_elektryka(self, s):
        # capture before-prices for elektryka labor
        before = s.get(f"{API}/labor-rates", timeout=15).json()
        el_before = {l["labor_id"]: l["rate"] for l in before if l.get("trade") == "elektryka"}
        assert len(el_before) >= 3
        r = s.post(f"{API}/catalog/voice-apply", json={"actions": [{
            "op": "bump_prices", "item_kind": "labor",
            "trade": "elektryka", "percent": 10,
        }]}, timeout=20)
        assert r.status_code == 200 and r.json()["count"] == 1
        after = s.get(f"{API}/labor-rates", timeout=15).json()
        el_after = {l["labor_id"]: l["rate"] for l in after if l.get("trade") == "elektryka"}
        for lid, old in el_before.items():
            assert lid in el_after
            assert abs(el_after[lid] - round(old * 1.1, 2)) < 0.02, \
                f"{lid}: {old} → {el_after[lid]}"

    def test_apply_add_item_and_delete(self, s):
        name = f"TEST_VoiceAdd_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/catalog/voice-apply", json={"actions": [{
            "op": "add_item", "item_kind": "material", "trade": "elektryka",
            "name": name, "unit": "szt", "price": 42.0,
        }]}, timeout=15)
        assert r.status_code == 200 and r.json()["count"] == 1
        mats = s.get(f"{API}/materials", timeout=15).json()
        added = next((m for m in mats if m["name"] == name), None)
        assert added is not None and added["unit_price"] == 42.0
        assert added["price_is_example"] is False
        # now delete it via apply
        r2 = s.post(f"{API}/catalog/voice-apply", json={"actions": [{
            "op": "delete_item", "item_kind": "material",
            "catalog_id": added["material_id"],
        }]}, timeout=15)
        assert r2.status_code == 200 and r2.json()["count"] == 1
        mats2 = s.get(f"{API}/materials", timeout=15).json()
        assert not any(m["material_id"] == added["material_id"] for m in mats2)


# =====================================================================
# 6. Regression: auth, estimates list, /ai/analyze reachable
# =====================================================================
class TestRegression:
    def test_login_returns_token(self, s):
        assert state["token"]
        assert state["user"]["email"] == TEST_EMAIL

    def test_estimates_list_reachable(self, s):
        r = s.get(f"{API}/estimates", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_ai_analyze_reachable_async(self, s):
        # Create a lightweight project first
        rc = s.post(f"{API}/clients",
                    json={"name": f"TEST_ClReg_{uuid.uuid4().hex[:6]}"}, timeout=15)
        assert rc.status_code == 200
        cid = rc.json()["client_id"]
        rp = s.post(f"{API}/projects",
                    json={"client_id": cid,
                          "name": f"TEST_PrjReg_{uuid.uuid4().hex[:6]}",
                          "trade": "elektryka"}, timeout=15)
        assert rp.status_code == 200
        pid = rp.json()["project_id"]

        t0 = time.time()
        r = s.post(f"{API}/ai/analyze", json={
            "project_id": pid, "trade": "elektryka",
            "description": "Prosta instalacja: 4 gniazda, przewód YDY 3x2,5 20mb",
            "image_paths": [],
        }, timeout=20)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("analysis_status") == "processing"
        assert elapsed < 10, f"analyze blocked {elapsed:.1f}s"
        # cleanup: project delete (idempotent)
        s.delete(f"{API}/projects/{pid}", timeout=10)
        s.delete(f"{API}/clients/{cid}", timeout=10)
