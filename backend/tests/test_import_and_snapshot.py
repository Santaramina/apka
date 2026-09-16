"""ETAP 2 + ETAP 3 integration tests — CSV/Excel import & estimate price snapshot.

Covers:
- POST /api/catalog/import/preview  (CSV PL headers + XLSX)
- POST /api/catalog/import/apply    (create → re-run update, dedupe, error rows)
- Labor import via kind='labor'
- CRITICAL: estimate item price is a snapshot — updating catalog price MUST NOT
  change an existing estimate item.
- Light regression: /api/materials, /api/labor-rates, status PATCH, PDF, AI, voice, auth.

Public URL only (EXPO_BACKEND_URL). Cleans up TEST_ rows in finalizers.
"""
import io
import json
import os
import time

import openpyxl
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://estimate-pro-112.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test@budkoszt.pl"
TEST_PASSWORD = "test123"


# --------------------------- fixtures ---------------------------
@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


TEST_PREFIX = "TEST_IMP_"


def _mk_csv(rows_extra=""):
    header = "Nazwa;Producent;Nr katalogowy;EAN;Cena netto;Jednostka;VAT"
    r1 = f"{TEST_PREFIX}Przewód YDY 3x2,5;Elektrokabel;{TEST_PREFIX}SKU001;5901234567890;4,80;mb;23"
    r2 = f"{TEST_PREFIX}Gniazdo pojedyncze;Legrand;{TEST_PREFIX}SKU002;5901234567891;14,00;szt;23"
    r3 = f";Brak;{TEST_PREFIX}SKU003;;5,00;szt;23"            # missing name
    r4 = f"{TEST_PREFIX}Zły cena;X;{TEST_PREFIX}SKU004;;abc;szt;23"  # bad price
    r5 = f"{TEST_PREFIX}Duplikat;X;{TEST_PREFIX}SKU001;;9,90;szt;23"  # dup sku
    return ("\n".join([header, r1, r2, r3, r4, r5]) + "\n" + rows_extra).encode("utf-8")


def _cleanup(auth):
    # remove all imported test items so tests are idempotent
    for path in ("/materials", "/labor-rates"):
        r = requests.get(f"{API}{path}", headers=auth, timeout=15)
        if r.status_code != 200:
            continue
        for it in r.json():
            if str(it.get("name", "")).startswith(TEST_PREFIX):
                iid = it.get("material_id") or it.get("labor_id")
                requests.delete(f"{API}{path}/{iid}", headers=auth, timeout=15)


@pytest.fixture(autouse=True, scope="module")
def _clean(auth):
    _cleanup(auth)
    yield
    _cleanup(auth)


# --------------------------- preview ---------------------------
class TestImportPreview:
    def test_preview_csv_polish_headers_auto_mapping(self, auth):
        files = {"file": ("cennik.csv", _mk_csv(), "text/csv")}
        r = requests.post(f"{API}/catalog/import/preview", headers=auth, files=files, data={"kind": "material"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # response shape
        for k in ("columns", "suggested_mapping", "fields", "required", "sample_rows", "total_rows"):
            assert k in data, f"missing {k}"
        assert data["total_rows"] == 5
        # required = name + unit_price for material
        assert set(data["required"]) == {"name", "unit_price"}
        # auto-mapping of the 7 Polish headers
        m = data["suggested_mapping"]
        assert m.get("Nazwa") == "name"
        assert m.get("Producent") == "manufacturer"
        assert m.get("Nr katalogowy") == "sku"
        assert m.get("EAN") == "ean"
        assert m.get("Cena netto") == "unit_price"
        assert m.get("Jednostka") == "unit"
        assert m.get("VAT") == "vat_rate"
        # sample rows carry raw values
        assert data["sample_rows"][0]["Nazwa"].startswith(TEST_PREFIX)

    def test_preview_xlsx_openpyxl(self, auth):
        # build .xlsx in memory
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Nazwa", "Cena netto", "Jednostka"])
        ws.append([f"{TEST_PREFIX}Rura PP", "4,50", "mb"])
        buf = io.BytesIO()
        wb.save(buf)
        files = {"file": ("cennik.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/catalog/import/preview", headers=auth, files=files, data={"kind": "material"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "Nazwa" in data["columns"]
        assert data["suggested_mapping"].get("Nazwa") == "name"
        assert data["suggested_mapping"].get("Cena netto") == "unit_price"
        assert data["total_rows"] == 1

    def test_preview_empty_file_rejected(self, auth):
        files = {"file": ("empty.csv", b"", "text/csv")}
        r = requests.post(f"{API}/catalog/import/preview", headers=auth, files=files, data={"kind": "material"}, timeout=15)
        assert r.status_code == 400

    def test_preview_requires_auth(self):
        files = {"file": ("cennik.csv", _mk_csv(), "text/csv")}
        r = requests.post(f"{API}/catalog/import/preview", files=files, data={"kind": "material"}, timeout=15)
        assert r.status_code in (401, 403)


# --------------------------- apply ---------------------------
class TestImportApply:
    def test_apply_creates_updates_dedupes_and_reports_errors(self, auth):
        # RUN 1 — create
        mapping = {
            "Nazwa": "name",
            "Producent": "manufacturer",
            "Nr katalogowy": "sku",
            "EAN": "ean",
            "Cena netto": "unit_price",
            "Jednostka": "unit",
            "VAT": "vat_rate",
        }
        csv_bytes = _mk_csv()
        files = {"file": ("cennik.csv", csv_bytes, "text/csv")}
        data = {"kind": "material", "mapping": json.dumps(mapping), "update_existing": "true"}
        r = requests.post(f"{API}/catalog/import/apply", headers=auth, files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        res = r.json()
        # 2 valid + 3 skipped (empty name, bad price, in-file duplicate)
        assert res["created"] == 2, res
        assert res["updated"] == 0, res
        assert res["skipped"] >= 3, res
        errs = " | ".join(e["error"] for e in res["errors"])
        assert "Brak nazwy" in errs
        assert "Niepoprawna cena" in errs
        assert "Duplikat" in errs

        # verify persisted with correct flags
        gr = requests.get(f"{API}/materials", headers=auth, timeout=15)
        assert gr.status_code == 200
        imported = [m for m in gr.json() if str(m.get("name", "")).startswith(TEST_PREFIX)]
        assert len(imported) == 2
        by_name = {m["name"]: m for m in imported}
        m1 = by_name[f"{TEST_PREFIX}Przewód YDY 3x2,5"]
        assert abs(m1["unit_price"] - 4.80) < 0.01
        assert m1["unit"] == "mb"
        assert m1["vat_rate"] == 23
        assert m1["manufacturer"] == "Elektrokabel"
        assert m1["sku"] == f"{TEST_PREFIX}SKU001"
        assert m1["ean"] == "5901234567890"
        assert m1["price_source_label"] == "import"
        assert m1["price_is_example"] is False
        assert m1["main_category"]  # non-empty derived category
        assert m1["status"] == "active"

        # RUN 2 — same file with update_existing=true → all matched by SKU → 0 created, 2 updated
        files2 = {"file": ("cennik.csv", csv_bytes, "text/csv")}
        r2 = requests.post(f"{API}/catalog/import/apply", headers=auth, files=files2, data=data, timeout=60)
        assert r2.status_code == 200, r2.text
        res2 = r2.json()
        assert res2["created"] == 0, res2
        assert res2["updated"] == 2, res2
        # catalog counts must only grow or update, never shrink
        gr2 = requests.get(f"{API}/materials", headers=auth, timeout=15)
        assert len([m for m in gr2.json() if str(m.get("name", "")).startswith(TEST_PREFIX)]) == 2

    def test_apply_labor_kind(self, auth):
        header = "Nazwa usługi;Cena robocizny;Jednostka"
        rows = [
            f"{TEST_PREFIX}Montaż gniazda;35,00;szt",
            f"{TEST_PREFIX}Ułożenie przewodu;9,50;mb",
        ]
        csv = ("\n".join([header, *rows]) + "\n").encode("utf-8")
        files = {"file": ("uslugi.csv", csv, "text/csv")}

        # Preview for labor autosuggests correct mapping
        p = requests.post(f"{API}/catalog/import/preview", headers=auth, files=files, data={"kind": "labor"}, timeout=30)
        assert p.status_code == 200, p.text
        pj = p.json()
        assert pj["suggested_mapping"]["Nazwa usługi"] == "name"
        assert pj["suggested_mapping"]["Cena robocizny"] == "rate"
        assert pj["suggested_mapping"]["Jednostka"] == "unit"
        assert set(pj["required"]) == {"name", "rate"}

        # Apply
        files2 = {"file": ("uslugi.csv", csv, "text/csv")}
        data = {"kind": "labor", "mapping": json.dumps(pj["suggested_mapping"]), "update_existing": "true"}
        r = requests.post(f"{API}/catalog/import/apply", headers=auth, files=files2, data=data, timeout=30)
        assert r.status_code == 200, r.text
        res = r.json()
        assert res["created"] == 2, res
        assert res["updated"] == 0

        # Verify labor_rates persisted
        gr = requests.get(f"{API}/labor-rates", headers=auth, timeout=15)
        assert gr.status_code == 200
        imp = [l for l in gr.json() if str(l.get("name", "")).startswith(TEST_PREFIX)]
        assert len(imp) == 2
        one = next(l for l in imp if l["name"] == f"{TEST_PREFIX}Montaż gniazda")
        assert abs(one["rate"] - 35.00) < 0.01
        assert one["unit"] == "szt"
        assert one["price_source_label"] == "import"
        assert one["price_is_example"] is False

    def test_apply_no_delete_of_existing(self, auth):
        # Count existing catalog before import
        before = len(requests.get(f"{API}/materials", headers=auth, timeout=15).json())
        # tiny CSV
        csv = f"Nazwa;Cena netto\n{TEST_PREFIX}Nowy element;1,00\n".encode("utf-8")
        files = {"file": ("x.csv", csv, "text/csv")}
        r = requests.post(f"{API}/catalog/import/apply", headers=auth, files=files,
                          data={"kind": "material", "mapping": json.dumps({"Nazwa": "name", "Cena netto": "unit_price"}), "update_existing": "true"},
                          timeout=30)
        assert r.status_code == 200
        after = len(requests.get(f"{API}/materials", headers=auth, timeout=15).json())
        assert after >= before, f"Import must not delete: before={before}, after={after}"


# --------------------------- SNAPSHOT invariant (ETAP 3 core) ---------------------------
class TestEstimatePriceSnapshot:
    def test_catalog_price_change_via_import_does_NOT_affect_existing_estimate(self, auth):
        # 1) Create a material we control
        mat = {
            "name": f"{TEST_PREFIX}SnapMat",
            "manufacturer": "Xyz",
            "sku": f"{TEST_PREFIX}SNAP001",
            "unit": "szt",
            "unit_price": 100.00,
            "vat_rate": 23,
            "main_category": "elektryka",
            "category": "elektryka",
        }
        cr = requests.post(f"{API}/materials", headers=auth, json=mat, timeout=15)
        assert cr.status_code in (200, 201), cr.text
        mat_id = cr.json()["material_id"]

        # 2) Need a project + client for an estimate
        cl = requests.post(f"{API}/clients", headers=auth, json={"name": "TEST_IMP_Klient"}, timeout=15)
        assert cl.status_code in (200, 201), cl.text
        client_id = cl.json()["client_id"]
        pr = requests.post(f"{API}/projects", headers=auth, json={"name": "TEST_IMP_Projekt", "client_id": client_id}, timeout=15)
        assert pr.status_code in (200, 201), pr.text
        proj_id = pr.json()["project_id"]

        # 3) Create estimate with the material at price snapshot 100.00
        est_payload = {
            "project_id": proj_id,
            "title": "TEST_IMP_Kosztorys",
            "items": [{
                "kind": "material",
                "name": f"{TEST_PREFIX}SnapMat",
                "unit": "szt",
                "quantity": 2,
                "unit_price": 100.00,
                "catalog_id": mat_id,
                "price_source": "catalog",
                "source": "manual",
            }],
        }
        er = requests.post(f"{API}/estimates", headers=auth, json=est_payload, timeout=15)
        assert er.status_code in (200, 201), er.text
        est_id = er.json()["estimate_id"]
        item0_price_before = er.json()["items"][0]["unit_price"]
        assert abs(item0_price_before - 100.00) < 0.01

        # 4) Now IMPORT (update_existing) a CSV that bumps SnapMat price to 250.00
        csv = f"Nazwa;Nr katalogowy;Cena netto;Jednostka;VAT\n{TEST_PREFIX}SnapMat;{TEST_PREFIX}SNAP001;250,00;szt;23\n".encode("utf-8")
        files = {"file": ("bump.csv", csv, "text/csv")}
        data = {"kind": "material", "mapping": json.dumps({
            "Nazwa": "name", "Nr katalogowy": "sku", "Cena netto": "unit_price",
            "Jednostka": "unit", "VAT": "vat_rate"}), "update_existing": "true"}
        ir = requests.post(f"{API}/catalog/import/apply", headers=auth, files=files, data=data, timeout=30)
        assert ir.status_code == 200, ir.text
        assert ir.json()["updated"] == 1, ir.json()

        # 5) Verify catalog price actually changed to 250
        mg = requests.get(f"{API}/materials", headers=auth, timeout=15)
        cat = next(m for m in mg.json() if m["material_id"] == mat_id)
        assert abs(cat["unit_price"] - 250.00) < 0.01, "catalog price should have updated"

        # 6) Re-read the estimate — item price MUST still be 100.00 (snapshot invariant)
        eg = requests.get(f"{API}/estimates/{est_id}", headers=auth, timeout=15)
        assert eg.status_code == 200, eg.text
        it_after = eg.json()["items"][0]
        assert abs(it_after["unit_price"] - 100.00) < 0.01, f"SNAPSHOT VIOLATED — estimate item price changed to {it_after['unit_price']}"
        assert it_after.get("catalog_id") == mat_id  # link preserved

        # cleanup: estimate/project/client
        requests.delete(f"{API}/estimates/{est_id}", headers=auth, timeout=15)
        requests.delete(f"{API}/projects/{proj_id}", headers=auth, timeout=15)
        requests.delete(f"{API}/clients/{client_id}", headers=auth, timeout=15)
        requests.delete(f"{API}/materials/{mat_id}", headers=auth, timeout=15)


# --------------------------- Regressions ---------------------------
class TestRegressionEtap1:
    def test_materials_fields_present(self, auth):
        r = requests.get(f"{API}/materials", headers=auth, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        m = data[0]
        for k in ("main_category", "vat_rate", "ean", "description", "price_source_label", "source_url", "status"):
            assert k in m, f"missing {k}"

    def test_labor_rates_fields_present(self, auth):
        r = requests.get(f"{API}/labor-rates", headers=auth, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0
        l = data[0]
        for k in ("rate_min", "rate_max", "includes_materials", "price_source_label", "status"):
            assert k in l, f"missing {k}"

    def test_material_status_patch_toggle(self, auth):
        r = requests.get(f"{API}/materials", headers=auth, timeout=15)
        mid = r.json()[0]["material_id"]
        orig_status = r.json()[0]["status"]
        new_status = "inactive" if orig_status == "active" else "active"
        pr = requests.patch(f"{API}/materials/{mid}/status", headers=auth, json={"status": new_status}, timeout=15)
        assert pr.status_code == 200, pr.text
        gr = requests.get(f"{API}/materials", headers=auth, timeout=15)
        cur = next(m for m in gr.json() if m["material_id"] == mid)
        assert cur["status"] == new_status
        # restore
        requests.patch(f"{API}/materials/{mid}/status", headers=auth, json={"status": orig_status}, timeout=15)

    def test_labor_status_patch_toggle(self, auth):
        r = requests.get(f"{API}/labor-rates", headers=auth, timeout=15)
        lid = r.json()[0]["labor_id"]
        orig = r.json()[0]["status"]
        new_s = "inactive" if orig == "active" else "active"
        pr = requests.patch(f"{API}/labor-rates/{lid}/status", headers=auth, json={"status": new_s}, timeout=15)
        assert pr.status_code == 200
        gr = requests.get(f"{API}/labor-rates", headers=auth, timeout=15)
        cur = next(l for l in gr.json() if l["labor_id"] == lid)
        assert cur["status"] == new_s
        requests.patch(f"{API}/labor-rates/{lid}/status", headers=auth, json={"status": orig}, timeout=15)


class TestRegressionAiVoicePdf:
    def test_ai_analyze_catalog_only_prices(self, auth):
        # need a project_id
        cl = requests.post(f"{API}/clients", headers=auth, json={"name": "TEST_IMP_AI_Klient"}, timeout=15).json()
        pr = requests.post(f"{API}/projects", headers=auth, json={"name": "TEST_IMP_AI_Projekt", "client_id": cl["client_id"]}, timeout=15).json()
        payload = {
            "project_id": pr["project_id"],
            "description": ("Instalacja elektryczna: 8 gniazd 230V, 4 włączniki, 60 mb przewodu YDY 3x2,5, rozdzielnica 8 modułów, 6 opraw LED 24W."),
            "trade": "elektryka",
        }
        r = requests.post(f"{API}/ai/analyze", headers=auth, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        est = r.json()
        eid = est.get("estimate_id")
        assert eid
        # poll estimate.analysis_status
        deadline = time.time() + 120
        result = None
        while time.time() < deadline:
            g = requests.get(f"{API}/estimates/{eid}", headers=auth, timeout=15)
            if g.status_code == 200 and g.json().get("analysis_status") in ("ready", "completed", "failed", "error"):
                result = g.json()
                break
            time.sleep(3)
        assert result is not None, "AI job did not finish in 120s"
        assert result.get("analysis_status") in ("ready", "completed"), result.get("analysis_status")
        items = result.get("items", [])
        assert len(items) >= 3
        # AI must NOT invent prices — price_source must be catalog/user/null (never 'ai')
        for it in items:
            ps = it.get("price_source")
            assert ps in (None, "catalog", "user"), f"AI invented price: {it}"
            if ps is None:
                assert (it.get("unit_price") or 0) == 0
        # cleanup
        requests.delete(f"{API}/estimates/{eid}", headers=auth, timeout=15)
        requests.delete(f"{API}/projects/{pr['project_id']}", headers=auth, timeout=15)
        requests.delete(f"{API}/clients/{cl['client_id']}", headers=auth, timeout=15)

    def test_voice_parse_catalog(self, auth):
        r = requests.post(f"{API}/voice/parse-command", headers=auth,
                          json={"context": "catalog", "text": "Zmień cenę przewodu YDY 3x2,5 na 8 zł"}, timeout=30)
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("actions", []), list)

    def test_voice_parse_estimate(self, auth):
        r = requests.post(f"{API}/voice/parse-command", headers=auth,
                          json={"context": "estimate", "text": "Dodaj 10 gniazd po 45 zł", "estimate_items": []}, timeout=30)
        assert r.status_code == 200, r.text

    def test_voice_apply_bump_labor(self, auth):
        # non-mutating small percentage that we then revert
        r = requests.post(f"{API}/catalog/voice-apply", headers=auth,
                          json={"actions": [{"op": "bump_prices", "item_kind": "labor", "trade": "elektryka", "percent": 0}]}, timeout=30)
        assert r.status_code == 200, r.text

    def test_pdf_regression(self, auth):
        # find any estimate
        er = requests.get(f"{API}/estimates", headers=auth, timeout=15)
        if er.status_code != 200 or not er.json():
            pytest.skip("No estimate present for PDF regression")
        est = er.json()[0]
        eid = est["estimate_id"]
        # get a share/pdf token if needed
        pr = requests.get(f"{API}/estimates/{eid}/pdf", headers=auth, timeout=30)
        # some deployments need ?token= via share endpoint — accept 200 or 401 fallback
        if pr.status_code == 401:
            # try share link
            sh = requests.post(f"{API}/estimates/{eid}/share", headers=auth, timeout=15)
            if sh.status_code == 200 and "token" in sh.json():
                pr = requests.get(f"{API}/estimates/{eid}/pdf?token={sh.json()['token']}", timeout=30)
        assert pr.status_code == 200, pr.text
        assert pr.content[:5] == b"%PDF-", pr.content[:20]

    def test_auth_login_shape(self):
        r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "token" in j and "user" in j

    def test_projects_and_clients_list(self, auth):
        for path in ("/projects", "/clients"):
            r = requests.get(f"{API}{path}", headers=auth, timeout=15)
            assert r.status_code == 200, path
