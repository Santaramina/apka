"""
BudKoszt Pro — Backend test suite (pytest) — refactor pass 2
Covers refactored estimation core:
- Async /api/ai/analyze (returns immediately with analysis_status=processing)
- Price matching from catalog (price_source=catalog|null, no AI prices)
- Trade flow (explicit trade, fallback to project.trade)
- /reanalyze
- compute_totals w/ markup/margin/discount/vat
- Upload validation (content_type, 20MB limit)
- PDF (client offer hides Narzut/Marża/Zysk, shows Wartość netto / DO ZAPŁATY)
- Multi-tenant scoping (second user cannot access first user's data)
"""
import io
import time
import uuid
import pytest
import requests

BASE = "https://estimate-pro-112.preview.emergentagent.com"
API = BASE + "/api"

TEST_EMAIL = "test@budkoszt.pl"
TEST_PASSWORD = "test123"

state = {
    "token": None, "user": None,
    "client_id": None, "project_id": None,
    "estimate_id": None, "elec_estimate_id": None, "fallback_estimate_id": None,
    "u2_token": None, "u2_email": None,
}


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(sess):
    if state["token"]:
        sess.headers["Authorization"] = f"Bearer {state['token']}"
        return
    r = sess.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code == 401:
        r = sess.post(f"{API}/auth/register", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
            "name": "Jan Kowalski", "company_name": "Kowalski Instalacje"
        })
    assert r.status_code == 200, f"auth failed {r.status_code} {r.text}"
    d = r.json()
    state["token"] = d["token"]
    state["user"] = d["user"]
    sess.headers["Authorization"] = f"Bearer {state['token']}"


def _wait_completed(sess, estimate_id, timeout=90):
    """Poll estimate until analysis_status is completed or failed."""
    start = time.time()
    last = None
    while time.time() - start < timeout:
        r = sess.get(f"{API}/estimates/{estimate_id}")
        assert r.status_code == 200
        est = r.json()
        last = est
        st = est.get("analysis_status")
        if st in ("completed", "failed"):
            return est
        time.sleep(2)
    pytest.fail(f"Analysis did not finish in {timeout}s (last status={last.get('analysis_status')})")


def _ensure_project(sess, trade="mieszane"):
    _login(sess)
    if state["client_id"] and state["project_id"]:
        return
    rc = sess.post(f"{API}/clients", json={"name": f"TEST_Klient_{uuid.uuid4().hex[:6]}"})
    assert rc.status_code == 200
    state["client_id"] = rc.json()["client_id"]
    rp = sess.post(f"{API}/projects", json={
        "client_id": state["client_id"],
        "name": f"TEST_Inw_{uuid.uuid4().hex[:6]}",
        "trade": trade,
    })
    assert rp.status_code == 200
    state["project_id"] = rp.json()["project_id"]


# ----------------------- Auth basics -----------------------
class TestAuth:
    def test_login(self, s):
        _login(s)
        assert state["user"]["email"] == TEST_EMAIL

    def test_me(self, s):
        _login(s)
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200 and r.json()["user"]["email"] == TEST_EMAIL

    def test_bad_password(self, s):
        r = requests.post(f"{API}/auth/login",
                          json={"email": TEST_EMAIL, "password": "wrong"})
        assert r.status_code == 401


# ----------------------- Catalog seed -----------------------
class TestSeed:
    def test_materials(self, s):
        _login(s)
        r = s.get(f"{API}/materials")
        assert r.status_code == 200 and len(r.json()) >= 25

    def test_labor(self, s):
        _login(s)
        r = s.get(f"{API}/labor-rates")
        assert r.status_code == 200 and len(r.json()) >= 10


# ----------------------- Upload validation -----------------------
class TestUpload:
    def test_reject_text_plain(self, s):
        _login(s)
        # explicit content-type to bypass session default
        files = {"file": ("note.txt", b"hello world", "text/plain")}
        headers = {"Authorization": s.headers["Authorization"]}
        r = requests.post(f"{API}/upload", files=files, headers=headers)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text[:200]}"

    def test_accept_jpeg_tiny(self, s):
        _login(s)
        # 1x1 white JPEG bytes
        jpeg = bytes.fromhex(
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
        files = {"file": ("x.jpg", jpeg, "image/jpeg")}
        headers = {"Authorization": s.headers["Authorization"]}
        r = requests.post(f"{API}/upload", files=files, headers=headers)
        assert r.status_code == 200, r.text[:200]
        assert r.json()["content_type"] == "image/jpeg"

    def test_reject_oversize(self, s):
        _login(s)
        big = b"\x00" * (20 * 1024 * 1024 + 1024)  # >20MB
        files = {"file": ("big.jpg", big, "image/jpeg")}
        headers = {"Authorization": s.headers["Authorization"]}
        r = requests.post(f"{API}/upload", files=files, headers=headers)
        assert r.status_code == 400


# ----------------------- AI analyze async + catalog matching -----------------------
class TestAIAsync:
    def test_analyze_returns_processing_immediately(self, s):
        _ensure_project(s, trade="mieszane")
        t0 = time.time()
        r = s.post(f"{API}/ai/analyze", json={
            "project_id": state["project_id"],
            "trade": "hydraulika",
            "description": (
                "Łazienka 6 m2: skucie starych płytek, ułożenie nowej glazury i terakoty, "
                "montaż wanny, umywalki, WC, baterii, przewód YDY 3x2,5 do zasilania pralki, "
                "malowanie sufitu."
            ),
            "image_paths": []
        }, timeout=20)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text[:300]
        est = r.json()
        assert est["estimate_id"]
        assert est["analysis_status"] == "processing"
        # non-blocking: should return well before Gemini finishes
        assert elapsed < 10, f"analyze blocked {elapsed:.1f}s (should be async)"
        state["estimate_id"] = est["estimate_id"]

    def test_analyze_completes_with_items(self, s):
        _login(s)
        est = _wait_completed(s, state["estimate_id"], timeout=120)
        assert est["analysis_status"] == "completed", f"failed: {est.get('analysis_error')}"
        items = est.get("items", [])
        assert len(items) >= 3
        # required fields
        for it in items:
            assert set(["kind", "name", "quantity", "unit", "unit_price",
                        "price_source", "quantity_source", "quantity_basis", "confidence"]).issubset(it.keys())
            # Refactored contract: quantity_source is 'ai_read' or 'ai_estimated' (mirrors basis)
            assert it["quantity_source"] in ("ai_read", "ai_estimated"), it["quantity_source"]
            assert it["quantity_basis"] in ("read", "estimated"), it["quantity_basis"]
            # price_source is either 'catalog' or None; NEVER 'ai' (AI never invents prices)
            assert it["price_source"] in (None, "catalog", "user")
            # if unmatched -> price=0
            if it["price_source"] is None:
                assert float(it["unit_price"]) == 0.0
            else:
                # matched -> price>0, catalog_id/name present
                assert float(it["unit_price"]) > 0
                assert it.get("catalog_id")
                assert it.get("catalog_name")

    def test_trade_explicit_elektryka(self, s):
        _ensure_project(s)
        r = s.post(f"{API}/ai/analyze", json={
            "project_id": state["project_id"],
            "trade": "elektryka",
            "description": "Nowa instalacja elektryczna: 6 gniazd 230V, 4 punkty oświetleniowe, przewód YDY 3x2,5 około 40 mb, rozdzielnica z zabezpieczeniami.",
            "image_paths": []
        }, timeout=20)
        assert r.status_code == 200
        state["elec_estimate_id"] = r.json()["estimate_id"]
        est = _wait_completed(s, state["elec_estimate_id"], timeout=120)
        assert est["analysis_status"] == "completed"
        assert est.get("trade") == "elektryka"
        # ideally at least one item matches catalog (przewód YDY exists in seed)
        matched = [it for it in est["items"] if it.get("price_source") == "catalog"]
        assert len(matched) >= 1, "expected at least one catalog match for electrical scope"

    def test_trade_fallback_to_project(self, s):
        # omit trade in payload; project.trade should be used
        _login(s)
        # make a dedicated project so trade is known
        rc = s.post(f"{API}/clients", json={"name": f"TEST_KFall_{uuid.uuid4().hex[:6]}"})
        cid = rc.json()["client_id"]
        rp = s.post(f"{API}/projects", json={"client_id": cid, "name": "TEST_Fallback", "trade": "wykonczenia"})
        pid = rp.json()["project_id"]
        r = s.post(f"{API}/ai/analyze", json={
            "project_id": pid,
            "description": "Pokój 20 m2: gładzie, malowanie ścian i sufitu, panele podłogowe.",
            "image_paths": []
        }, timeout=20)
        assert r.status_code == 200
        eid = r.json()["estimate_id"]
        state["fallback_estimate_id"] = eid
        est = _wait_completed(s, eid, timeout=120)
        assert est["analysis_status"] == "completed"
        assert est.get("trade") == "wykonczenia"

    def test_reanalyze(self, s):
        _login(s)
        r = s.post(f"{API}/estimates/{state['estimate_id']}/reanalyze", timeout=20)
        assert r.status_code == 200
        assert r.json()["analysis_status"] == "processing"
        est = _wait_completed(s, state["estimate_id"], timeout=120)
        assert est["analysis_status"] == "completed"
        assert len(est.get("items", [])) >= 3


    # ----- Totals + PDF (kept in this class so xdist keeps estimate_id on one worker) -----
    def test_compute_totals(self, s):
        _login(s)
        # Update estimate with known items to check math
        eid = state["estimate_id"]
        items = [
            {"kind": "material", "name": "Farba biała", "unit": "l",
             "quantity": 10, "unit_price": 20.0},
            {"kind": "labor", "name": "Malowanie", "unit": "m2",
             "quantity": 20, "unit_price": 25.0},
            {"kind": "extra", "name": "Transport", "unit": "kpl",
             "quantity": 1, "unit_price": 100.0},
        ]
        r = s.put(f"{API}/estimates/{eid}", json={
            "items": items,
            "markup_percent": 10, "margin_percent": 5,
            "discount_percent": 0, "vat_percent": 23,
        })
        assert r.status_code == 200
        t = r.json()["totals"]
        # materials=200, labor=500, extra=100, subtotal=800
        assert t["materials_cost"] == 200.0
        assert t["labor_cost"] == 500.0
        assert t["extra_cost"] == 100.0
        assert t["subtotal"] == 800.0
        # markup=80, margin=40 => before_discount=920, net=920, vat=211.6, gross=1131.6
        assert t["markup"] == 80.0
        assert t["margin"] == 40.0
        assert t["net"] == 920.0
        assert abs(t["vat"] - 211.6) < 0.05
        assert abs(t["gross"] - 1131.6) < 0.05
        assert t["profit"] == 120.0  # net-subtotal

    def test_pdf_hides_internals(self, s):
        _login(s)
        eid = state["estimate_id"]
        token = state["token"]
        r = requests.get(f"{API}/estimates/{eid}/pdf?token={token}", timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"
        # Extract text (PDF streams are FlateDecode compressed)
        import io as _io
        import pypdf
        reader = pypdf.PdfReader(_io.BytesIO(r.content))
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
        # Client-facing must contain
        assert "Warto" in text, f"missing 'Wartość netto' in PDF text:\n{text[:500]}"
        assert "DO ZAP" in text, "missing 'DO ZAPŁATY'"
        # Internal-only terms MUST NOT appear
        assert "Narzut" not in text, "PDF leaks 'Narzut'"
        assert "Marża" not in text and "Marza" not in text, "PDF leaks 'Marża'"
        assert "Zysk" not in text, "PDF leaks 'Zysk'"
        # Nor the internal cost labels
        assert "Koszt zakupu" not in text


    def test_zz_second_user_cannot_read_estimate(self, s):
        # register a fresh throwaway user
        email = f"test_u2_{uuid.uuid4().hex[:6]}@budkoszt.pl"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "tester123", "name": "U2"
        })
        assert r.status_code == 200
        u2_token = r.json()["token"]
        state["u2_token"] = u2_token
        state["u2_email"] = email
        h = {"Authorization": f"Bearer {u2_token}"}
        # estimate scoped to user 1
        eid = state["estimate_id"]
        assert eid, "need estimate from earlier test"
        r1 = requests.get(f"{API}/estimates/{eid}", headers=h)
        assert r1.status_code == 404
        # client
        r2 = requests.get(f"{API}/clients/{state['client_id']}", headers=h)
        assert r2.status_code == 404
        # project
        r3 = requests.get(f"{API}/projects/{state['project_id']}", headers=h)
        assert r3.status_code == 404
        # update/delete also 404
        r4 = requests.put(f"{API}/estimates/{eid}",
                          json={"status": "sent"}, headers=h)
        assert r4.status_code == 404
        r5 = requests.delete(f"{API}/estimates/{eid}", headers=h)
        # DELETE endpoint is idempotent update_one; verify user 1 can still see it
        assert r5.status_code == 200  # returns ok=True regardless
        r6 = s.get(f"{API}/estimates/{eid}")
        assert r6.status_code == 200, "user1 estimate must NOT be deleted by u2"


# ----------------------- Cleanup -----------------------
class TestZCleanup:
    def test_cleanup(self, s):
        _login(s)
        if state["project_id"]:
            s.delete(f"{API}/projects/{state['project_id']}")
        if state["client_id"]:
            s.delete(f"{API}/clients/{state['client_id']}")
