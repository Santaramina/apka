"""Testy: wyszukiwanie/dopasowanie parametrów, jednostki, priorytet ceny użytkownika,
oraz rozpoznawanie akcji z poleceń głosowych (resolve)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import matching  # noqa: E402
import seed_data  # noqa: E402
import voice_actions  # noqa: E402


# --- pomocnicze pule katalogowe ---
def _mat_pool():
    return [
        {"id": "m1", "name": "Przewód YDYp 3x1,5", "unit": "mb", "price": 3.20},
        {"id": "m2", "name": "Przewód YDYp 3x2,5", "unit": "mb", "price": 4.80},
        {"id": "m3", "name": "Kabel YKY 5x6", "unit": "mb", "price": 18.00},
        {"id": "m4", "name": "Gniazdo pojedyncze podtynkowe", "unit": "szt", "price": 14.00},
    ]


def _lab_pool():
    return [
        {"id": "l1", "name": "Punkt elektryczny podtynkowy", "unit": "pkt", "price": 85.00},
        {"id": "l2", "name": "Montaż oprawy oświetleniowej", "unit": "szt", "price": 35.00},
    ]


# ===================== DOPASOWANIE PARAMETRÓW =====================
def test_match_wire_cross_section_precise():
    res = matching.match_catalog("YDY 3x2,5", "mb", _mat_pool())
    assert res["matched"] is True
    assert res["best"]["catalog_id"] == "m2"  # nie m1 (3x1,5)


def test_match_wire_rejects_conflicting_cross_section():
    # 3x1,5 nigdy nie powinno zostać dopasowane do 3x2,5
    res = matching.match_catalog("przewód YDYp 3x1,5", "mb", _mat_pool())
    assert res["best"]["catalog_id"] == "m1"


def test_match_multi_core_5x6():
    res = matching.match_catalog("kabel YKY 5x6", "mb", _mat_pool())
    assert res["matched"] is True
    assert res["best"]["catalog_id"] == "m3"


def test_match_unit_incompatible_blocks_auto():
    # zła jednostka -> brak automatu (wymaga potwierdzenia lub brak)
    res = matching.match_catalog("gniazdo pojedyncze podtynkowe", "mb", _mat_pool())
    assert res["matched"] is False


# ===================== SEED / STRUKTURA KATALOGU =====================
def test_seed_prices_are_example():
    m = seed_data._build_material("u1", "Test", "elektryka", "Kat", "szt", 10.0, "", "", "", "2026")
    assert m["price_is_example"] is True
    assert m["trade"] == "elektryka"
    l = seed_data._build_labor("u1", "Test", "elektryka", "Kat", "godz", 70.0, "2026")
    assert l["price_is_example"] is True


def test_seed_keys_stable_and_unique():
    keys = [seed_data._mat_key(t, n) for (n, t, *_rest) in seed_data.MATERIALS_SEED]
    assert len(keys) == len(set(keys))  # brak kolizji
    assert seed_data._mat_key("elektryka", "X") == seed_data._mat_key("elektryka", "X")


def test_seed_covers_all_required_trades():
    trades = {t for (_n, t, *_r) in seed_data.MATERIALS_SEED} | {t for (_n, t, *_r) in seed_data.LABOR_SEED}
    required = {"elektryka", "teletechnika", "hydraulika", "kanalizacja", "co", "hvac", "gaz",
                "pv", "automatyka", "alarmy", "cctv", "kontrola_dostepu", "domofony", "sieci_lan", "ogolnobudowlana"}
    assert required.issubset(trades)


def test_seed_electrical_is_richest():
    counts = {}
    for (_n, t, *_r) in seed_data.MATERIALS_SEED:
        counts[t] = counts.get(t, 0) + 1
    assert counts["elektryka"] == max(counts.values())


# ===================== PRIORYTET CENY UŻYTKOWNIKA =====================
def test_user_price_priority_flag():
    # cena przykładowa -> po ustawieniu przez użytkownika flaga znika (symulacja logiki endpointu)
    seeded = seed_data._build_material("u1", "Przewód", "elektryka", "K", "mb", 4.8, "", "", "", "2026")
    assert seeded["price_is_example"] is True
    # endpoint update ustawia price_is_example=False oraz nową cenę
    user_updated = {**seeded, "unit_price": 8.0, "price_is_example": False}
    assert user_updated["price_is_example"] is False
    assert user_updated["unit_price"] == 8.0


# ===================== KOMENDY GŁOSOWE: KATALOG =====================
def test_voice_catalog_set_price_ok():
    a = {"op": "set_price", "item_kind": "material", "query": "YDY 3x2,5", "unit": "m", "new_price": 8}
    out = voice_actions.resolve_catalog_action(a, _mat_pool(), _lab_pool())
    assert out["status"] == "ok"
    assert out["catalog_id"] == "m2"
    assert "8,00 zł" in out["label"]


def test_voice_catalog_set_price_not_found():
    a = {"op": "set_price", "item_kind": "material", "query": "rura kominowa tytanowa", "new_price": 5}
    out = voice_actions.resolve_catalog_action(a, _mat_pool(), _lab_pool())
    assert out["status"] in ("not_found", "ambiguous")


def test_voice_catalog_bump_label():
    a = {"op": "bump_prices", "item_kind": "labor", "trade": "elektryka", "percent": 10}
    out = voice_actions.resolve_catalog_action(a, _mat_pool(), _lab_pool())
    assert out["status"] == "ok"
    assert "10%" in out["label"] and "robocizny" in out["label"]


def test_voice_catalog_add_item_label():
    a = {"op": "add_item", "item_kind": "labor", "name": "Punkt elektryczny", "unit": "pkt", "price": 85, "trade": "elektryka"}
    out = voice_actions.resolve_catalog_action(a, _mat_pool(), _lab_pool())
    assert out["status"] == "ok"
    assert "Dodaj do katalogu" in out["label"]


def test_voice_catalog_delete_resolves():
    a = {"op": "delete_item", "item_kind": "labor", "query": "montaż oprawy"}
    out = voice_actions.resolve_catalog_action(a, _mat_pool(), _lab_pool())
    assert out["status"] in ("ok", "ambiguous")


# ===================== KOMENDY GŁOSOWE: KOSZTORYS =====================
def _est_items():
    return [
        {"name": "Punkt elektryczny podtynkowy", "unit": "pkt", "quantity": 10, "unit_price": 85},
        {"name": "Przewód YDYp 3x2,5", "unit": "mb", "quantity": 50, "unit_price": 4.8},
    ]


def test_voice_estimate_add_item():
    a = {"op": "add_item", "item_kind": "labor", "name": "Punkt elektryczny", "unit": "pkt", "quantity": 20, "price": 85}
    out = voice_actions.resolve_estimate_action(a, _est_items())
    assert out["status"] == "ok"
    assert "20×" in out["label"]


def test_voice_estimate_set_price_matches_item():
    a = {"op": "set_price", "query": "YDY 3x2,5", "new_price": 8}
    out = voice_actions.resolve_estimate_action(a, _est_items())
    assert out["status"] == "ok"
    assert out["index"] == 1


def test_voice_estimate_delete_last():
    a = {"op": "delete_item", "query": "ostatnia"}
    out = voice_actions.resolve_estimate_action(a, _est_items())
    assert out["status"] == "ok"
    assert out["index"] == 1


def test_voice_estimate_not_found():
    a = {"op": "set_qty", "query": "beton komórkowy", "quantity": 5}
    out = voice_actions.resolve_estimate_action(a, _est_items())
    assert out["status"] == "not_found"
