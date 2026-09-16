"""
BudKoszt Pro — calc_mode + included_in_calc + image_paths + PDF exclusion.

Covers the current review scope:
1) POST /api/estimates persists calc_mode (default 'labor_materials').
2) PUT /api/estimates/{id} persists calc_mode across the 3 values.
3) compute_totals respects calc_mode:
   - labor_only        -> materials_cost = 0
   - labor_selected_materials -> only items with included_in_calc=True count
   - labor_materials   -> all materials count
   Switching modes must NOT alter items[] (only totals differ).
4) included_in_calc field persists via PUT.
5) GET /api/estimates/{id}/pdf:
   - 200 %PDF when no requires_confirmation items
   - 409 with Polish detail.code == 'requires_confirmation' when any item requires it
   - PDF text EXCLUDES material items not counted per calc_mode
6) PUT /api/estimates/{id} persists image_paths (add + remove).
7) Regressions:
   - POST /api/ai/analyze creates estimate with items; price_source in {catalog,user,None};
     null price_source ⇒ unit_price == 0 (AI does not invent prices) and
     items without a catalog match get requires_confirmation=True.
   - Voice parse-command (context='estimate') returns 200 with actions[].
   - CSV import preview + apply still works end-to-end.
"""
from __future__ import annotations

import io
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://estimate-pro-112.preview.emergentagent.com"
API = BASE.rstrip("/") + "/api"

EMAIL = "test@budkoszt.pl"
PASSWORD = "test123"


# --------------------- session / helpers ---------------------
@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    if r.status_code == 401:
        r = s.post(f"{API}/auth/register", json={"email": EMAIL, "password": PASSWORD,
                                                 "name": "Jan Kowalski", "company_name": "Kowalski Instalacje"},
                   timeout=30)
    assert r.status_code == 200, f"auth failed: {r.status_code} {r.text[:200]}"
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="module")
def project(sess):
    rc = sess.post(f"{API}/clients", json={"name": f"TEST_CALC_Klient_{uuid.uuid4().hex[:6]}"})
    assert rc.status_code == 200, rc.text
    cid = rc.json()["client_id"]
    rp = sess.post(f"{API}/projects", json={"client_id": cid, "name": f"TEST_CALC_Inw_{uuid.uuid4().hex[:6]}",
                                            "trade": "elektryka"})
    assert rp.status_code == 200, rp.text
    pid = rp.json()["project_id"]
    yield {"project_id": pid, "client_id": cid}
    # cleanup
    sess.delete(f"{API}/projects/{pid}")
    sess.delete(f"{API}/clients/{cid}")


@pytest.fixture(scope="module")
def base_estimate(sess, project):
    """A saved manual estimate with mixed items and no requires_confirmation."""
    items = [
        {"kind": "material", "name": "TEST_Kabel YDY", "unit": "mb",
         "quantity": 100, "unit_price": 5.00, "included_in_calc": True,
         "source": "manual", "quantity_source": "user", "price_source": "user"},
        {"kind": "material", "name": "TEST_Gniazdko", "unit": "szt",
         "quantity": 10, "unit_price": 15.00, "included_in_calc": True,
         "source": "manual", "quantity_source": "user", "price_source": "user"},
        {"kind": "labor", "name": "TEST_Punkt elektryczny", "unit": "szt",
         "quantity": 10, "unit_price": 80.00,
         "source": "manual", "quantity_source": "user", "price_source": "user"},
        {"kind": "extra", "name": "TEST_Dojazd", "unit": "kpl",
         "quantity": 1, "unit_price": 100.00,
         "source": "manual", "quantity_source": "user", "price_source": "user"},
    ]
    r = sess.post(f"{API}/estimates", json={
        "project_id": project["project_id"],
        "title": "TEST_calc_mode",
        "items": items,
        "markup_percent": 0, "margin_percent": 0, "discount_percent": 0, "vat_percent": 23,
    })
    assert r.status_code == 200, r.text
    est = r.json()
    yield est
    sess.delete(f"{API}/estimates/{est['estimate_id']}")


# --------------------- 1) create default calc_mode ---------------------
class TestCreateAndPersistCalcMode:
    def test_default_calc_mode_labor_materials(self, base_estimate):
        assert base_estimate["calc_mode"] == "labor_materials"
        t = base_estimate["totals"]
        # materials = 100*5 + 10*15 = 650; labor=800; extra=100; subtotal=1550; net=1550; vat=356.5
        assert t["materials_cost"] == 650.00
        assert t["labor_cost"] == 800.00
        assert t["extra_cost"] == 100.00
        assert t["subtotal"] == 1550.00
        assert abs(t["vat"] - 356.50) < 0.02
        assert abs(t["gross"] - 1906.50) < 0.05

    def test_switch_to_labor_only(self, sess, base_estimate):
        eid = base_estimate["estimate_id"]
        r = sess.put(f"{API}/estimates/{eid}", json={"calc_mode": "labor_only"})
        assert r.status_code == 200
        est = r.json()
        assert est["calc_mode"] == "labor_only"
        t = est["totals"]
        assert t["materials_cost"] == 0.0
        # labor+extra = 900 -> net=900; vat=207; gross=1107
        assert t["subtotal"] == 900.00
        assert abs(t["gross"] - 1107.00) < 0.05
        # Items array unchanged (all 4 still there)
        assert len(est["items"]) == 4

    def test_switch_to_labor_selected_materials(self, sess, base_estimate):
        eid = base_estimate["estimate_id"]
        # Mark the second material item excluded, then PUT items + calc_mode
        r0 = sess.get(f"{API}/estimates/{eid}")
        est0 = r0.json()
        items = est0["items"]
        for it in items:
            if it["name"] == "TEST_Gniazdko":
                it["included_in_calc"] = False
        # ensure Kabel stays included_in_calc=True
        r = sess.put(f"{API}/estimates/{eid}", json={"calc_mode": "labor_selected_materials",
                                                    "items": items})
        assert r.status_code == 200
        est = r.json()
        assert est["calc_mode"] == "labor_selected_materials"
        # included material = Kabel (500). Gniazdko excluded.
        t = est["totals"]
        assert t["materials_cost"] == 500.00
        # subtotal = 500 + 800 + 100 = 1400 ; gross = 1400*1.23 = 1722
        assert t["subtotal"] == 1400.00
        assert abs(t["gross"] - 1722.00) < 0.05
        # persistence of included_in_calc
        by_name = {it["name"]: it for it in est["items"]}
        assert by_name["TEST_Kabel YDY"]["included_in_calc"] is True
        assert by_name["TEST_Gniazdko"]["included_in_calc"] is False
        # items still all present
        assert len(est["items"]) == 4

    def test_flip_included_in_calc_persists_and_recomputes(self, sess, base_estimate):
        eid = base_estimate["estimate_id"]
        r0 = sess.get(f"{API}/estimates/{eid}")
        est0 = r0.json()
        items = est0["items"]
        # include everything again
        for it in items:
            if it["kind"] == "material":
                it["included_in_calc"] = True
        r = sess.put(f"{API}/estimates/{eid}", json={"items": items})
        assert r.status_code == 200
        est = r.json()
        # still labor_selected_materials from previous test
        assert est["calc_mode"] == "labor_selected_materials"
        assert est["totals"]["materials_cost"] == 650.00  # both back in
        for it in est["items"]:
            if it["kind"] == "material":
                assert it["included_in_calc"] is True

    def test_switch_back_to_labor_materials_no_items_lost(self, sess, base_estimate):
        eid = base_estimate["estimate_id"]
        r = sess.put(f"{API}/estimates/{eid}", json={"calc_mode": "labor_materials"})
        assert r.status_code == 200
        est = r.json()
        assert est["calc_mode"] == "labor_materials"
        assert len(est["items"]) == 4
        assert est["totals"]["materials_cost"] == 650.00
        assert est["totals"]["labor_cost"] == 800.00


# --------------------- 2) PDF respects calc_mode ---------------------
class TestPdfRespectsCalcMode:
    def test_pdf_200_when_no_confirmation_needed(self, sess, base_estimate):
        eid = base_estimate["estimate_id"]
        token = sess.headers["Authorization"].split(" ", 1)[1]
        # ensure clean labor_materials mode
        sess.put(f"{API}/estimates/{eid}", json={"calc_mode": "labor_materials"})
        r = requests.get(f"{API}/estimates/{eid}/pdf?token={token}", timeout=60)
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"

    def test_pdf_excludes_material_in_labor_only(self, sess, base_estimate):
        import pypdf
        eid = base_estimate["estimate_id"]
        token = sess.headers["Authorization"].split(" ", 1)[1]
        sess.put(f"{API}/estimates/{eid}", json={"calc_mode": "labor_only"})
        r = requests.get(f"{API}/estimates/{eid}/pdf?token={token}", timeout=60)
        assert r.status_code == 200
        reader = pypdf.PdfReader(io.BytesIO(r.content))
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
        # Materials must NOT appear
        assert "TEST_Kabel YDY" not in text, "labor_only PDF leaks material row"
        assert "TEST_Gniazdko" not in text, "labor_only PDF leaks material row"
        # Labor + extra still present
        assert "TEST_Punkt elektryczny" in text
        assert "TEST_Dojazd" in text

    def test_pdf_excludes_only_unincluded_in_selected(self, sess, base_estimate):
        import pypdf
        eid = base_estimate["estimate_id"]
        token = sess.headers["Authorization"].split(" ", 1)[1]
        # exclude Gniazdko only
        r0 = sess.get(f"{API}/estimates/{eid}")
        items = r0.json()["items"]
        for it in items:
            if it["name"] == "TEST_Gniazdko":
                it["included_in_calc"] = False
            elif it["kind"] == "material":
                it["included_in_calc"] = True
        sess.put(f"{API}/estimates/{eid}", json={"calc_mode": "labor_selected_materials", "items": items})
        r = requests.get(f"{API}/estimates/{eid}/pdf?token={token}", timeout=60)
        assert r.status_code == 200
        reader = pypdf.PdfReader(io.BytesIO(r.content))
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
        assert "TEST_Kabel YDY" in text
        assert "TEST_Gniazdko" not in text
        assert "TEST_Punkt elektryczny" in text

    def test_pdf_409_when_requires_confirmation(self, sess, base_estimate):
        eid = base_estimate["estimate_id"]
        token = sess.headers["Authorization"].split(" ", 1)[1]
        r0 = sess.get(f"{API}/estimates/{eid}")
        items = r0.json()["items"]
        # Mark one item as requires_confirmation
        items[0]["requires_confirmation"] = True
        sess.put(f"{API}/estimates/{eid}", json={"calc_mode": "labor_materials", "items": items})
        r = requests.get(f"{API}/estimates/{eid}/pdf?token={token}", timeout=60)
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        detail = body.get("detail") or {}
        assert detail.get("code") == "requires_confirmation"
        assert isinstance(detail.get("count"), int) and detail["count"] >= 1
        assert isinstance(detail.get("items"), list)
        assert "potwierdzenia" in (detail.get("message") or "").lower()
        # cleanup: clear the flag so downstream tests don't fail
        items[0]["requires_confirmation"] = False
        sess.put(f"{API}/estimates/{eid}", json={"items": items})


# --------------------- 3) image_paths persistence ---------------------
def _tiny_jpeg_bytes():
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
        "070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c"
        "1c2837292c30313434341f27393d38323c2e333432ffc00011080001000103012200"
        "021101031101ffc4001f0000010501010101010100000000000000000102030405060"
        "708090a0bffc400b5100002010303020403050504040000017d01020300041105122131"
        "410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25"
        "262728292a3435363738393a434445464748494a535455565758595a636465666768"
        "696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8"
        "a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5"
        "e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda000c03010002110311003f00fbd0a28a2"
        "8ffd9"
    )


class TestImagePathsPersistence:
    def test_put_adds_and_removes_image_paths(self, sess, base_estimate):
        eid = base_estimate["estimate_id"]
        # upload 2 tiny jpegs
        paths = []
        for _ in range(2):
            files = {"file": ("x.jpg", _tiny_jpeg_bytes(), "image/jpeg")}
            headers = {"Authorization": sess.headers["Authorization"]}
            r = requests.post(f"{API}/upload", files=files, headers=headers, timeout=30)
            assert r.status_code == 200, r.text
            paths.append(r.json()["path"])
        # add both
        r1 = sess.put(f"{API}/estimates/{eid}", json={"image_paths": paths})
        assert r1.status_code == 200
        est = r1.json()
        assert est.get("image_paths") == paths
        # remove one
        r2 = sess.put(f"{API}/estimates/{eid}", json={"image_paths": [paths[0]]})
        assert r2.status_code == 200
        assert r2.json().get("image_paths") == [paths[0]]
        # clear all
        r3 = sess.put(f"{API}/estimates/{eid}", json={"image_paths": []})
        assert r3.status_code == 200
        assert r3.json().get("image_paths") == []


# --------------------- 4) AI analyze regression: no invented prices ---------------------
class TestAiAnalyzeRegression:
    def test_analyze_creates_estimate_no_invented_prices(self, sess, project):
        r = sess.post(f"{API}/ai/analyze", json={
            "project_id": project["project_id"],
            "trade": "elektryka",
            "description": "6 gniazd 230V, 4 punkty oświetleniowe, ~40 mb przewodu YDY 3x2,5, rozdzielnica.",
            "image_paths": [],
        }, timeout=25)
        assert r.status_code == 200, r.text[:200]
        eid = r.json()["estimate_id"]
        # poll for completion
        est = None
        for _ in range(60):
            g = sess.get(f"{API}/estimates/{eid}")
            assert g.status_code == 200
            est = g.json()
            if est.get("analysis_status") in ("completed", "failed"):
                break
            time.sleep(2)
        assert est and est["analysis_status"] == "completed", f"analysis error: {est and est.get('analysis_error')}"
        items = est.get("items", [])
        assert len(items) >= 1
        for it in items:
            assert it["price_source"] in (None, "catalog", "user"), f"invented price_source={it['price_source']}"
            if it["price_source"] is None:
                assert float(it["unit_price"]) == 0.0
                # invariant: no catalog price ⇒ requires_confirmation
                assert it.get("requires_confirmation") is True, \
                    f"null-price item should require confirmation: {it['name']}"
        # cleanup
        sess.delete(f"{API}/estimates/{eid}")

    def test_voice_parse_command_estimate_context(self, sess):
        r = sess.post(f"{API}/voice/parse-command", json={
            "context": "estimate",
            "text": "Zmień ilość gniazdka na 8",
            "estimate_items": [
                {"item_id": "x1", "name": "gniazdko", "unit": "szt", "quantity": 5, "unit_price": 15}
            ],
        }, timeout=45)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert "actions" in body
        assert isinstance(body["actions"], list)


# --------------------- 5) Import CSV preview + apply regression ---------------------
class TestImportRegression:
    def test_csv_preview_and_apply(self, sess):
        # Build a tiny CSV with 2 valid rows using Polish headers.
        csv = (
            "Nazwa;Cena netto;Jednostka;Nr katalogowy\n"
            f"TEST_CALCIMP_A_{uuid.uuid4().hex[:5]};12,50;szt;SKU_A_{uuid.uuid4().hex[:5]}\n"
            f"TEST_CALCIMP_B_{uuid.uuid4().hex[:5]};7,80;mb;SKU_B_{uuid.uuid4().hex[:5]}\n"
        ).encode("utf-8")

        # preview
        files = {"file": ("import.csv", csv, "text/csv")}
        data = {"kind": "material"}
        headers = {"Authorization": sess.headers["Authorization"]}
        r = requests.post(f"{API}/catalog/import/preview", files=files, data=data,
                          headers=headers, timeout=30)
        assert r.status_code == 200, r.text[:200]
        pv = r.json()
        assert pv["total_rows"] == 2
        assert "name" in pv["suggested_mapping"].values()
        assert "unit_price" in pv["suggested_mapping"].values()

        # apply
        mapping = pv["suggested_mapping"]
        # mapping is {column_name: field}
        import json as _json
        files = {"file": ("import.csv", csv, "text/csv")}
        data = {"kind": "material", "mapping": _json.dumps(mapping), "update_existing": "true"}
        r2 = requests.post(f"{API}/catalog/import/apply", files=files, data=data,
                           headers=headers, timeout=30)
        assert r2.status_code == 200, r2.text[:200]
        out = r2.json()
        assert out["created"] + out["updated"] >= 2

        # cleanup: soft-delete the two imported materials
        rl = sess.get(f"{API}/materials")
        for m in rl.json():
            if m["name"].startswith("TEST_CALCIMP_"):
                sess.delete(f"{API}/materials/{m['material_id']}")


# --------------------- 6) Price snapshot regression ---------------------
class TestPriceSnapshotRegression:
    def test_estimate_item_preserves_price_after_catalog_change(self, sess, project):
        # create a fresh material at 100
        mid_name = f"TEST_SNAP_Mat_{uuid.uuid4().hex[:5]}"
        rm = sess.post(f"{API}/materials", json={"name": mid_name, "trade": "elektryka",
                                                 "unit": "szt", "unit_price": 100.0})
        assert rm.status_code == 200
        mat = rm.json()
        mid = mat["material_id"]

        # create estimate referencing that catalog item
        r = sess.post(f"{API}/estimates", json={
            "project_id": project["project_id"],
            "title": "TEST_snap",
            "items": [{
                "kind": "material", "name": mid_name, "unit": "szt",
                "quantity": 2, "unit_price": 100.0,
                "catalog_id": mid, "catalog_name": mid_name,
                "price_source": "catalog", "source": "manual",
                "quantity_source": "user",
            }],
        })
        assert r.status_code == 200
        eid = r.json()["estimate_id"]

        # update the catalog price to 250
        ru = sess.put(f"{API}/materials/{mid}",
                      json={"name": mid_name, "trade": "elektryka",
                            "unit": "szt", "unit_price": 250.0})
        assert ru.status_code == 200
        assert float(ru.json()["unit_price"]) == 250.0

        # estimate item should keep its snapshot unit_price 100
        rg = sess.get(f"{API}/estimates/{eid}")
        est = rg.json()
        it = est["items"][0]
        assert float(it["unit_price"]) == 100.0, f"snapshot broken: {it['unit_price']}"
        assert it.get("catalog_id") == mid

        # cleanup
        sess.delete(f"{API}/estimates/{eid}")
        sess.delete(f"{API}/materials/{mid}")
