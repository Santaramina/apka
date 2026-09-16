"""End-to-end audit of the BudKoszt Pro estimate creation pipeline.

Requirements audited (from review request):
- POST /api/ai/analyze with Polish electrical description -> completed items
- Every item has quantity_basis ('read'|'estimated') and quantity_source ('ai_read'|'ai_estimated')
- Prices ONLY from catalog (price_source='catalog') OR 0.0 with requires_confirmation=True
- AI never invents items not present in the description
- Matching: 'YDY 3x2,5' -> 'Przewód YDYp 3x2,5' (never 3x1,5) with unit compat.
- Generic 'Oprawa LED' (no wattage) -> must NOT auto-match a specific 18W item
- Totals math (no double-counting markup+margin) via PUT /api/estimates/{id}
- CRUD editing on estimate items (change qty/price/product, add/delete manual item)
- PDF: valid application/pdf, %PDF header, no internal Narzut/Marża/Zysk leaks
- Regression: auth, catalog GET, voice endpoints
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

_state = {}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    r = sess.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json()["token"]
    sess.headers["Authorization"] = f"Bearer {tok}"
    _state["token"] = tok
    return sess


@pytest.fixture(scope="module")
def project_id(s):
    r = s.get(f"{API}/projects")
    assert r.status_code == 200
    projects = r.json()
    assert isinstance(projects, list) and len(projects) > 0, "expected pre-seeded projects"
    # prefer any project with a client so PDF gen works; server tolerates missing
    return projects[0]["project_id"]


def _wait_completed(sess, estimate_id, timeout=180):
    start = time.time()
    last = None
    while time.time() - start < timeout:
        r = sess.get(f"{API}/estimates/{estimate_id}")
        assert r.status_code == 200
        last = r.json()
        if last.get("analysis_status") in ("completed", "failed"):
            return last
        time.sleep(2)
    pytest.fail(f"analysis timeout, last status={last.get('analysis_status') if last else None}")


# ==========================================================================
# 1) Full pipeline: analyze -> match -> quantity_basis/source, price_source
# ==========================================================================
class TestAIPipelinePolishElectrical:
    DESCRIPTION = (
        "Instalacja elektryczna w mieszkaniu: 12 gniazd podwójnych 230V, "
        "6 włączników pojedynczych, 120 mb przewodu YDY 3x2,5, "
        "rozdzielnica 12-modułowa natynkowa, 8 opraw LED. "
        "Malowanie pomijamy — zakres tylko elektryczny."
    )

    def test_analyze_kicks_off_async(self, s, project_id):
        t0 = time.time()
        r = s.post(f"{API}/ai/analyze", json={
            "project_id": project_id,
            "trade": "elektryka",
            "description": self.DESCRIPTION,
            "image_paths": [],
        }, timeout=20)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["analysis_status"] == "processing"
        assert time.time() - t0 < 10, "analyze must return async (<10s)"
        _state["est_id"] = j["estimate_id"]

    def test_analysis_completes(self, s):
        est = _wait_completed(s, _state["est_id"], timeout=180)
        assert est["analysis_status"] == "completed", f"failed: {est.get('analysis_error')}"
        items = est.get("items", [])
        assert len(items) >= 4, f"expected >=4 items, got {len(items)}"
        _state["items"] = items
        _state["totals"] = est.get("totals", {})

    def test_every_item_has_quantity_basis_and_source(self, s):
        for it in _state["items"]:
            assert it.get("quantity_basis") in ("read", "estimated"), it
            expected_qs = "ai_read" if it["quantity_basis"] == "read" else "ai_estimated"
            assert it.get("quantity_source") == expected_qs, (
                f"quantity_source mismatch: {it.get('quantity_source')} vs basis {it['quantity_basis']}"
            )

    def test_price_source_catalog_or_confirmation(self, s):
        """AI must NEVER invent a price. Either matched -> price_source='catalog' and price>0,
        or unmatched -> price=0 AND requires_confirmation=True (or has candidate_matches)."""
        for it in _state["items"]:
            ps = it.get("price_source")
            price = float(it.get("unit_price") or 0)
            assert ps in (None, "catalog", "user"), f"forbidden price_source={ps}"
            if ps == "catalog":
                assert price > 0, f"catalog match must have price>0: {it}"
                assert it.get("catalog_id"), f"catalog match must carry catalog_id: {it}"
            else:
                # AI never invented a price for an unmatched item
                assert price == 0.0, f"unmatched item must have price=0, got {price}: {it}"
                # user must be able to see why: either flag or candidates
                assert it.get("requires_confirmation") or (it.get("candidate_matches") or []), (
                    f"unmatched item without confirmation flag or candidates: {it}"
                )

    def test_ai_never_invents_painting_when_excluded(self, s):
        """Description says 'malowanie pomijamy' — AI must NOT invent painting items."""
        painting_hits = [it for it in _state["items"]
                         if any(kw in it.get("name", "").lower() for kw in ("malowan", "gładz", "gladz", "farba", "tapetow"))]
        assert painting_hits == [], f"AI invented painting items despite exclusion: {painting_hits}"

    def test_ydy_3x25_never_matches_3x15(self, s):
        """Critical safety: YDY 3x2,5 must never be matched to a 3x1,5 catalog entry."""
        found = False
        for it in _state["items"]:
            n = it.get("name", "").lower()
            if "3x2,5" in n or "3x2.5" in n:
                found = True
                cname = (it.get("catalog_name") or "").lower()
                if cname:
                    assert "3x1,5" not in cname and "3x1.5" not in cname, (
                        f"YDY 3x2,5 wrongly matched to 3x1,5: {it}"
                    )
                # candidate list: 3x1,5 must NOT be a candidate for a 3x2,5 query
                for cand in it.get("candidate_matches", []):
                    n2 = (cand.get("catalog_name") or "").lower()
                    assert "3x1,5" not in n2 and "3x1.5" not in n2, (
                        f"YDY 3x2,5 has 3x1,5 candidate: {cand}"
                    )
        assert found, "expected at least one YDY 3x2,5 line from the description"

    def test_generic_led_luminaire_not_autoconfirmed(self, s):
        """Description says '8 opraw LED' (no wattage). A specific 18W catalog item must
        NOT be auto-picked — either unmatched (requires_confirmation) or matched only if
        catalog has a generic 'Oprawa LED' without wattage."""
        for it in _state["items"]:
            n = it.get("name", "").lower()
            if "oprawa" in n and "led" in n and not any(w in n for w in ("18w", "18 w", "24w", "36w", "9w", "12w")):
                cname = (it.get("catalog_name") or "").lower()
                if it.get("price_source") == "catalog" and cname:
                    # if it did auto-match, the catalog name must also be generic (no wattage)
                    assert not any(w in cname for w in ("18w", "18 w", "24w", "36w")), (
                        f"generic 'Oprawa LED' auto-matched to specific wattage catalog: {it}"
                    )


# ==========================================================================
# 2) Totals math via PUT /api/estimates/{id} — no double-counting
# ==========================================================================
class TestTotalsMath:
    def test_put_recomputes_totals_no_double_counting(self, s):
        eid = _state.get("est_id")
        assert eid, "prior analyze must have produced an estimate"
        items = [
            {"kind": "material", "name": "Farba", "unit": "l",  "quantity": 10, "unit_price": 20.0},
            {"kind": "labor",    "name": "Malowanie", "unit": "m2", "quantity": 20, "unit_price": 25.0},
            {"kind": "extra",    "name": "Transport", "unit": "kpl","quantity": 1,  "unit_price": 100.0},
        ]
        r = s.put(f"{API}/estimates/{eid}", json={
            "items": items,
            "markup_percent": 10, "margin_percent": 5,
            "discount_percent": 5, "vat_percent": 23,
        })
        assert r.status_code == 200
        t = r.json()["totals"]
        subtotal = 200 + 500 + 100  # 800
        markup = subtotal * 0.10    # 80
        margin = subtotal * 0.05    # 40  (both from subtotal, NOT compounded)
        before = subtotal + markup + margin      # 920
        discount = before * 0.05                 # 46
        net = before - discount                  # 874
        vat = net * 0.23                         # 201.02
        gross = net + vat                        # 1075.02
        profit = net - subtotal                  # 74
        assert t["subtotal"] == 800.0
        assert t["markup"] == 80.0
        assert t["margin"] == 40.0
        assert abs(t["discount"] - discount) < 0.02
        assert abs(t["net"] - net) < 0.02
        assert abs(t["vat"] - vat) < 0.02
        assert abs(t["gross"] - gross) < 0.02
        assert abs(t["profit"] - profit) < 0.02
        # sanity: NOT compounded (would give net = 800 * 1.10 * 1.05 = 924)
        assert abs(t["net"] - 924.0) > 1.0


# ==========================================================================
# 3) Item CRUD editing via PUT
# ==========================================================================
class TestEditingCRUD:
    def _get_items(self, s):
        r = s.get(f"{API}/estimates/{_state['est_id']}")
        assert r.status_code == 200
        return r.json().get("items", []), r.json()

    def test_change_qty_and_price_persists(self, s):
        items, _ = self._get_items(s)
        assert items, "prior test should have set 3 items"
        items[0]["quantity"] = 12.5
        items[0]["unit_price"] = 22.5
        items[0]["price_source"] = "user"
        r = s.put(f"{API}/estimates/{_state['est_id']}", json={"items": items})
        assert r.status_code == 200
        got, _ = self._get_items(s)
        assert got[0]["quantity"] == 12.5
        assert got[0]["unit_price"] == 22.5
        assert got[0]["price_source"] == "user"

    def test_add_manual_item_and_delete(self, s):
        items, _ = self._get_items(s)
        prev_len = len(items)
        new_item = {
            "kind": "material", "name": "TEST_Manualna_pozycja",
            "unit": "szt", "quantity": 3, "unit_price": 55.0,
            "price_source": "user", "source": "manual",
        }
        items.append(new_item)
        r = s.put(f"{API}/estimates/{_state['est_id']}", json={"items": items})
        assert r.status_code == 200
        got, _ = self._get_items(s)
        assert len(got) == prev_len + 1
        assert any(it.get("name") == "TEST_Manualna_pozycja" for it in got)
        # totals updated
        j = r.json()
        assert j["totals"]["subtotal"] > 0

        # now delete the manual one
        got_without = [it for it in got if it.get("name") != "TEST_Manualna_pozycja"]
        r2 = s.put(f"{API}/estimates/{_state['est_id']}", json={"items": got_without})
        assert r2.status_code == 200
        got2, _ = self._get_items(s)
        assert not any(it.get("name") == "TEST_Manualna_pozycja" for it in got2)

    def test_replace_with_catalog_match(self, s):
        # find a catalog material id to reference
        rm = s.get(f"{API}/materials")
        assert rm.status_code == 200
        mats = rm.json()
        target = next((m for m in mats if float(m.get("unit_price") or 0) > 0), None)
        assert target, "need at least one priced material"

        items, _ = self._get_items(s)
        items[0]["catalog_id"] = target["material_id"]
        items[0]["catalog_name"] = target["name"]
        items[0]["unit"] = target.get("unit") or items[0].get("unit", "szt")
        items[0]["unit_price"] = float(target["unit_price"])
        items[0]["price_source"] = "catalog"
        items[0]["requires_confirmation"] = False
        r = s.put(f"{API}/estimates/{_state['est_id']}", json={"items": items})
        assert r.status_code == 200
        got, _ = self._get_items(s)
        assert got[0]["catalog_id"] == target["material_id"]
        assert got[0]["price_source"] == "catalog"
        assert abs(got[0]["unit_price"] - float(target["unit_price"])) < 0.001


# ==========================================================================
# 4) PDF: valid, no internal leaks
# ==========================================================================
class TestPDF:
    def test_pdf_download(self, s):
        eid = _state["est_id"]
        token = _state["token"]
        r = requests.get(f"{API}/estimates/{eid}/pdf?token={token}", timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert len(r.content) > 500
        assert r.content[:5] == b"%PDF-"

    def test_pdf_hides_internals(self, s):
        eid = _state["est_id"]
        token = _state["token"]
        r = requests.get(f"{API}/estimates/{eid}/pdf?token={token}", timeout=60)
        assert r.status_code == 200
        import io as _io
        import pypdf
        text = "\n".join(p.extract_text() or "" for p in pypdf.PdfReader(_io.BytesIO(r.content)).pages)
        # Internal-only vocab must NOT appear
        assert "Narzut" not in text, f"PDF leaks 'Narzut': {text[:400]}"
        assert "Marża" not in text and "Marza" not in text, "PDF leaks 'Marża'"
        assert "Zysk" not in text, "PDF leaks 'Zysk'"
        assert "Koszt zakupu" not in text
        # Client-facing must appear
        assert "Warto" in text or "warto" in text.lower(), "missing 'Wartość'"
        assert "DO ZAP" in text.upper(), "missing 'DO ZAPŁATY'"


# ==========================================================================
# 5) Regression: auth, catalog, voice
# ==========================================================================
class TestRegression:
    def test_login_still_ok(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        assert r.status_code == 200
        j = r.json()
        assert j.get("token") and j.get("user")

    def test_catalog_get(self, s):
        r = s.get(f"{API}/materials")
        assert r.status_code == 200 and isinstance(r.json(), list) and len(r.json()) > 0
        r2 = s.get(f"{API}/labor-rates")
        assert r2.status_code == 200 and isinstance(r2.json(), list) and len(r2.json()) > 0

    def test_voice_parse_catalog(self, s):
        r = s.post(f"{API}/voice/parse-command", json={
            "text": "Zmień cenę YDY 3x2,5 na 8 zł za metr",
            "context": "catalog",
        }, timeout=60)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "actions" in j

    def test_voice_parse_estimate(self, s):
        r = s.post(f"{API}/voice/parse-command", json={
            "text": "Dodaj 20 punktów elektrycznych po 85 zł",
            "context": "estimate",
        }, timeout=60)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "actions" in j
