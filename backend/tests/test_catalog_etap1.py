"""
BudKoszt Pro — ETAP 1 catalog expansion tests
Universal materials+services catalog: new fields (main_category, ean, description,
vat_rate, price_source_label, source_url, status, notes; services: rate_min/max,
includes_materials). Non-destructive migration + status toggle + price snapshot
invariant on estimates + AI + voice regression + PDF.
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://estimate-pro-112.preview.emergentagent.com").rstrip("/")
API = BASE + "/api"

TEST_EMAIL = "test@budkoszt.pl"
TEST_PASSWORD = "test123"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    r = sess.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code == 401:
        r = sess.post(f"{API}/auth/register", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
            "name": "Jan Kowalski", "company_name": "Kowalski Instalacje"
        })
    assert r.status_code == 200, f"auth: {r.status_code} {r.text}"
    tok = r.json()["token"]
    sess.headers["Authorization"] = f"Bearer {tok}"
    sess.token = tok
    return sess


@pytest.fixture(scope="module")
def project_id(s):
    r = s.get(f"{API}/projects")
    assert r.status_code == 200
    projs = r.json()
    if projs:
        return projs[0]["project_id"]
    rc = s.post(f"{API}/clients", json={"name": f"TEST_Klient_{uuid.uuid4().hex[:6]}"})
    assert rc.status_code == 200
    cid = rc.json()["client_id"]
    rp = s.post(f"{API}/projects", json={"client_id": cid, "name": f"TEST_Inw_{uuid.uuid4().hex[:6]}", "trade": "elektryka"})
    assert rp.status_code == 200
    return rp.json()["project_id"]


# -------------------------------------------------------------------
# 1) GET /materials + /labor-rates: new fields present on every doc
# -------------------------------------------------------------------
class TestGetHasNewFields:
    def test_materials_have_new_fields(self, s):
        r = s.get(f"{API}/materials")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) > 20, f"expected seed >20, got {len(rows)}"
        required = ["main_category", "vat_rate", "ean", "description",
                    "price_source_label", "source_url", "status", "notes",
                    "manufacturer", "sku", "unit", "unit_price"]
        for m in rows:
            for k in required:
                assert k in m, f"material {m.get('name')} missing field {k}"
            assert m["status"] in ("active", "inactive"), f"bad status {m['status']}"
            assert m["main_category"], f"main_category empty on {m.get('name')}"

    def test_labor_have_new_fields(self, s):
        r = s.get(f"{API}/labor-rates")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) > 10, f"expected seed >10 services, got {len(rows)}"
        required = ["main_category", "description", "rate_min", "rate_max",
                    "includes_materials", "price_source_label", "status",
                    "notes", "unit", "rate"]
        for l in rows:
            for k in required:
                assert k in l, f"labor {l.get('name')} missing {k}"
            assert l["status"] in ("active", "inactive")
            assert l["main_category"]

    def test_migration_all_active_by_default(self, s):
        r = s.get(f"{API}/materials")
        rows = r.json()
        # After migration every existing doc should default to active
        actives = [m for m in rows if m.get("status") == "active"]
        assert len(actives) >= max(1, len(rows) - 5), "too many inactive after migration"


# -------------------------------------------------------------------
# 2) POST/PUT materials + labor with all new fields persist
# -------------------------------------------------------------------
class TestCrudNewFields:
    def test_create_material_full(self, s):
        body = {
            "name": f"TEST_Mat_{uuid.uuid4().hex[:6]}",
            "main_category": "elektryka",
            "trade": "elektryka",
            "subcategory": "przewody",
            "unit": "mb",
            "unit_price": 12.5,
            "vat_rate": 23,
            "manufacturer": "TEST_Man",
            "sku": "TSK-1",
            "ean": "5901234567890",
            "description": "TEST opis",
            "source_url": "https://example.com/p/1",
            "status": "active",
            "notes": "TEST notes",
        }
        r = s.post(f"{API}/materials", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        # default price_source_label should be 'ręczne' since caller left it empty
        assert d["price_source_label"] == "ręczne"
        for k in ["main_category", "vat_rate", "ean", "manufacturer", "sku",
                  "description", "source_url", "status", "notes"]:
            assert d[k] == body[k], f"field {k} not persisted: {d.get(k)} != {body[k]}"
        # verify via GET
        g = s.get(f"{API}/materials")
        assert any(m["material_id"] == d["material_id"] for m in g.json())
        # cleanup
        s.delete(f"{API}/materials/{d['material_id']}")

    def test_put_material_updates_price_updated_at(self, s):
        # create then update price
        body = {"name": f"TEST_MatPU_{uuid.uuid4().hex[:6]}", "trade": "elektryka",
                "unit": "szt", "unit_price": 10.0, "vat_rate": 23}
        r = s.post(f"{API}/materials", json=body)
        assert r.status_code == 200
        mid = r.json()["material_id"]
        pua0 = r.json()["price_updated_at"]
        time.sleep(1.1)
        body["unit_price"] = 20.0
        r2 = s.put(f"{API}/materials/{mid}", json=body)
        assert r2.status_code == 200
        d = r2.json()
        assert d["unit_price"] == 20.0
        assert d["price_updated_at"] != pua0, "price_updated_at should change on price change"
        # Update without price change -> price_updated_at stays
        body["notes"] = "changed"
        r3 = s.put(f"{API}/materials/{mid}", json=body)
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["price_updated_at"] == d["price_updated_at"], "price_updated_at should NOT change when unit_price unchanged"
        s.delete(f"{API}/materials/{mid}")

    def test_create_labor_rate_min_max_includes(self, s):
        body = {
            "name": f"TEST_Lab_{uuid.uuid4().hex[:6]}",
            "trade": "elektryka",
            "unit": "godz",
            "rate": 80.0,
            "rate_min": 70.0,
            "rate_max": 100.0,
            "includes_materials": True,
            "description": "TEST",
            "status": "active",
            "notes": "n",
        }
        r = s.post(f"{API}/labor-rates", json=body)
        assert r.status_code == 200
        d = r.json()
        assert d["rate_min"] == 70.0 and d["rate_max"] == 100.0
        assert d["includes_materials"] is True
        assert d["price_source_label"] == "ręczne"
        # PUT toggles includes_materials off
        body["includes_materials"] = False
        body["rate"] = 90.0
        r2 = s.put(f"{API}/labor-rates/{d['labor_id']}", json=body)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["includes_materials"] is False
        assert d2["rate"] == 90.0
        # rate changed => price_updated_at bumped
        assert d2["price_updated_at"] != d["price_updated_at"]
        s.delete(f"{API}/labor-rates/{d['labor_id']}")


# -------------------------------------------------------------------
# 3) PATCH /status toggles soft, item still in GET list
# -------------------------------------------------------------------
class TestStatusPatch:
    def test_patch_material_status_toggle(self, s):
        body = {"name": f"TEST_St_{uuid.uuid4().hex[:6]}", "trade": "elektryka",
                "unit": "szt", "unit_price": 1.0}
        r = s.post(f"{API}/materials", json=body); mid = r.json()["material_id"]

        r1 = s.patch(f"{API}/materials/{mid}/status", json={"status": "inactive"})
        assert r1.status_code == 200 and r1.json()["status"] == "inactive"
        # still returned by GET
        rows = s.get(f"{API}/materials").json()
        found = [m for m in rows if m["material_id"] == mid]
        assert len(found) == 1 and found[0]["status"] == "inactive"

        r2 = s.patch(f"{API}/materials/{mid}/status", json={"status": "active"})
        assert r2.status_code == 200 and r2.json()["status"] == "active"
        s.delete(f"{API}/materials/{mid}")

    def test_patch_labor_status_toggle(self, s):
        body = {"name": f"TEST_LSt_{uuid.uuid4().hex[:6]}", "trade": "elektryka",
                "unit": "godz", "rate": 50.0}
        r = s.post(f"{API}/labor-rates", json=body); lid = r.json()["labor_id"]
        r1 = s.patch(f"{API}/labor-rates/{lid}/status", json={"status": "inactive"})
        assert r1.status_code == 200 and r1.json()["status"] == "inactive"
        rows = s.get(f"{API}/labor-rates").json()
        assert any(l["labor_id"] == lid and l["status"] == "inactive" for l in rows)
        s.patch(f"{API}/labor-rates/{lid}/status", json={"status": "active"})
        s.delete(f"{API}/labor-rates/{lid}")


# -------------------------------------------------------------------
# 4) DELETE still soft-deletes (removed from list)
# -------------------------------------------------------------------
class TestDeleteRemoved:
    def test_delete_material_removed_from_list(self, s):
        r = s.post(f"{API}/materials", json={"name": f"TEST_Del_{uuid.uuid4().hex[:6]}",
                                             "trade": "elektryka", "unit": "szt", "unit_price": 1.0})
        mid = r.json()["material_id"]
        assert any(m["material_id"] == mid for m in s.get(f"{API}/materials").json())
        s.delete(f"{API}/materials/{mid}")
        assert not any(m["material_id"] == mid for m in s.get(f"{API}/materials").json())

    def test_delete_labor_removed_from_list(self, s):
        r = s.post(f"{API}/labor-rates", json={"name": f"TEST_LDel_{uuid.uuid4().hex[:6]}",
                                               "trade": "elektryka", "unit": "godz", "rate": 1.0})
        lid = r.json()["labor_id"]
        s.delete(f"{API}/labor-rates/{lid}")
        assert not any(l["labor_id"] == lid for l in s.get(f"{API}/labor-rates").json())


# -------------------------------------------------------------------
# 5) CRITICAL: estimate keeps price snapshot even when catalog price changes
# -------------------------------------------------------------------
class TestEstimatePriceSnapshot:
    def test_catalog_price_change_does_not_touch_estimate(self, s, project_id):
        # create a catalog material at price 100
        mr = s.post(f"{API}/materials", json={
            "name": f"TEST_Snap_{uuid.uuid4().hex[:6]}",
            "trade": "elektryka", "unit": "szt", "unit_price": 100.0, "vat_rate": 23,
        })
        assert mr.status_code == 200
        mat = mr.json()
        mid = mat["material_id"]

        # create an estimate referencing this catalog item at the catalog price
        er = s.post(f"{API}/estimates", json={
            "project_id": project_id,
            "title": f"TEST_SnapEst_{uuid.uuid4().hex[:6]}",
            "items": [{
                "kind": "material", "name": mat["name"], "unit": "szt",
                "quantity": 5.0, "unit_price": 100.0, "source": "catalog",
                "price_source": "catalog", "catalog_id": mid,
                "catalog_name": mat["name"],
            }],
            "markup_percent": 0, "margin_percent": 0, "discount_percent": 0, "vat_percent": 23,
        })
        assert er.status_code == 200, er.text
        eid = er.json()["estimate_id"]
        est_before = s.get(f"{API}/estimates/{eid}").json()
        item_before = est_before["items"][0]
        assert item_before["unit_price"] == 100.0

        # bump catalog price to 999.99
        up = s.put(f"{API}/materials/{mid}", json={
            "name": mat["name"], "trade": "elektryka", "unit": "szt",
            "unit_price": 999.99, "vat_rate": 23,
        })
        assert up.status_code == 200 and up.json()["unit_price"] == 999.99

        # re-read the estimate — snapshot must stay
        est_after = s.get(f"{API}/estimates/{eid}").json()
        item_after = est_after["items"][0]
        assert item_after["unit_price"] == 100.0, \
            f"SNAPSHOT VIOLATED: estimate item price changed to {item_after['unit_price']} after catalog PUT"
        assert item_after["catalog_id"] == mid

        # cleanup
        s.delete(f"{API}/estimates/{eid}")
        s.delete(f"{API}/materials/{mid}")


# -------------------------------------------------------------------
# 6) Regression: POST /ai/analyze still works end-to-end (Polish electrical)
# -------------------------------------------------------------------
class TestAIAnalyzeRegression:
    def test_ai_analyze_polish_electrical(self, s, project_id):
        r = s.post(f"{API}/ai/analyze", json={
            "project_id": project_id,
            "description": "12 gniazd podwójnych, 6 włączników, 120 mb YDY 3x2,5, rozdzielnica 12-mod, 8 opraw LED",
            "trade": "elektryka",
        })
        assert r.status_code == 200, r.text
        eid = r.json()["estimate_id"]
        assert r.json()["analysis_status"] == "processing"
        # poll to completion
        start = time.time()
        est = None
        while time.time() - start < 90:
            g = s.get(f"{API}/estimates/{eid}").json()
            if g["analysis_status"] in ("completed", "failed"):
                est = g
                break
            time.sleep(2)
        assert est is not None, "analyze did not finish in 90s"
        assert est["analysis_status"] == "completed", est.get("analysis_error")
        assert len(est["items"]) >= 3
        for it in est["items"]:
            # AI never invents prices — price_source ∈ {catalog, null, user}
            ps = it.get("price_source")
            assert ps in (None, "catalog", "user"), f"invalid price_source {ps}"
            # quantity_basis + quantity_source contract
            qb = it.get("quantity_basis")
            qs = it.get("quantity_source")
            if qb is not None:
                assert qb in ("read", "estimated"), f"invalid quantity_basis {qb}"
                assert qs in ("ai_read", "ai_estimated", "user"), f"invalid quantity_source {qs}"
            if ps is None:
                assert (it.get("unit_price") or 0) == 0.0
        s.delete(f"{API}/estimates/{eid}")


# -------------------------------------------------------------------
# 7) Regression: voice endpoints
# -------------------------------------------------------------------
class TestVoiceRegression:
    def test_voice_parse_catalog(self, s):
        r = s.post(f"{API}/voice/parse-command", json={
            "context": "catalog",
            "text": "Zmień cenę YDY 3x2,5 na 8 zł za metr",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert "actions" in d and isinstance(d["actions"], list)
        # backend uses key `op` for action type
        assert any(a.get("op") == "set_price" for a in d["actions"])

    def test_voice_parse_estimate(self, s):
        r = s.post(f"{API}/voice/parse-command", json={
            "context": "estimate",
            "text": "Dodaj 20 punktów elektrycznych po 85 zł",
            "estimate_items": [],
        })
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("actions"), list)

    def test_voice_apply_bump_prices(self, s):
        # pick an elektryka labor rate to compare before/after
        before = [l for l in s.get(f"{API}/labor-rates").json()
                  if l.get("trade") == "elektryka" and l.get("status") == "active"]
        assert len(before) >= 1
        sample = before[0]
        old = float(sample["rate"] or 0)
        r = s.post(f"{API}/catalog/voice-apply", json={
            "actions": [{"op": "bump_prices", "item_kind": "labor",
                         "trade": "elektryka", "percent": 5}]
        })
        assert r.status_code == 200, r.text
        after = [l for l in s.get(f"{API}/labor-rates").json()
                 if l["labor_id"] == sample["labor_id"]][0]
        # bump 5% (allow small float tolerance)
        assert abs(float(after["rate"]) - old * 1.05) < 0.02, \
            f"expected {old*1.05:.2f}, got {after['rate']}"


# -------------------------------------------------------------------
# 8) Regression: PDF hides internal markup/margin/profit
# -------------------------------------------------------------------
class TestPDFRegression:
    def test_pdf_ok(self, s, project_id):
        er = s.post(f"{API}/estimates", json={
            "project_id": project_id,
            "title": f"TEST_PDF_{uuid.uuid4().hex[:6]}",
            "items": [{"kind": "material", "name": "TEST poz", "unit": "szt",
                       "quantity": 2.0, "unit_price": 50.0}],
            "markup_percent": 10, "margin_percent": 5, "discount_percent": 0, "vat_percent": 23,
        })
        assert er.status_code == 200
        eid = er.json()["estimate_id"]
        p = s.get(f"{API}/estimates/{eid}/pdf?token={s.token}")
        assert p.status_code == 200
        assert p.headers.get("content-type", "").startswith("application/pdf")
        assert p.content[:5] == b"%PDF-"
        assert len(p.content) > 500
        s.delete(f"{API}/estimates/{eid}")
