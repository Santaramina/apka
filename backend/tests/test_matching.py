"""Testy jednostkowe dla matching.py — bezpieczeństwo dopasowania w kosztorysach."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import matching  # noqa: E402

CATALOG = [
    {"id": "m1", "name": "Przewód YDYp 3x1,5", "unit": "m", "price": 3.2},
    {"id": "m2", "name": "Przewód YDYp 3x2,5", "unit": "m", "price": 4.8},
    {"id": "m3", "name": "Rura PP fi20", "unit": "m", "price": 4.2},
    {"id": "m4", "name": "Rura PP fi25", "unit": "m", "price": 5.5},
    {"id": "m5", "name": "Płytki gres 60x60", "unit": "m2", "price": 65.0},
    {"id": "m6", "name": "Gniazdo pojedyncze podtynkowe", "unit": "szt", "price": 14.0},
    {"id": "m7", "name": "Gniazdo podwójne podtynkowe", "unit": "szt", "price": 18.0},
]


def _ids(res):
    return [c["catalog_id"] for c in res["candidate_matches"]]


def test_identical_name_auto_match():
    r = matching.match_catalog("Płytki gres 60x60", "m2", CATALOG)
    assert r["matched"] is True
    assert r["best"]["catalog_id"] == "m5"
    assert r["best"]["unit_price"] == 65.0


def test_word_order_still_matches():
    r = matching.match_catalog("3x1,5 przewód YDYp", "m", CATALOG)
    assert r["matched"] is True
    assert r["best"]["catalog_id"] == "m1"


def test_typo_safe_match():
    # 'przewod' bez ogonka oraz 'YDY' zamiast 'YDYp'
    r = matching.match_catalog("przewod YDY 3x2,5", "m", CATALOG)
    assert r["matched"] is True
    assert r["best"]["catalog_id"] == "m2"


def test_cross_section_not_confused():
    # 3x1,5 nie może zostać dopasowane do 3x2,5
    r = matching.match_catalog("YDY 3x1,5", "m", CATALOG)
    assert r["matched"] is True
    assert r["best"]["catalog_id"] == "m1"
    # kandydat z innym przekrojem NIE może się pojawić
    assert "m2" not in _ids(r)


def test_diameter_not_confused():
    r = matching.match_catalog("rura 20 mm", "m", CATALOG)
    assert r["matched"] is True
    assert r["best"]["catalog_id"] == "m3"
    assert "m4" not in _ids(r)  # fi25 wykluczone

    r25 = matching.match_catalog("rura 25 mm", "m", CATALOG)
    assert r25["best"]["catalog_id"] == "m4"
    assert "m3" not in _ids(r25)


def test_cores_count_matters():
    # 3x1,5 vs 5x1,5 — różna liczba żył
    cat = [{"id": "a", "name": "Przewód 5x1,5", "unit": "m", "price": 6.0}]
    r = matching.match_catalog("Przewód 3x1,5", "m", cat)
    assert r["matched"] is False
    assert r["candidate_matches"] == []  # konflikt -> brak kandydata


def test_unit_mismatch_requires_confirmation():
    # ta sama nazwa, inna jednostka -> nie automatyczne
    r = matching.match_catalog("Płytki gres 60x60", "szt", CATALOG)
    assert r["matched"] is False
    assert r["requires_confirmation"] is True
    assert "m5" in _ids(r)


def test_no_catalog_entry_no_match():
    r = matching.match_catalog("Klimatyzator inwerter 3,5 kW", "szt", CATALOG)
    assert r["matched"] is False
    assert r["requires_confirmation"] is False
    assert r["candidate_matches"] == []


def test_several_similar_returns_candidates():
    r = matching.match_catalog("Gniazdo podtynkowe", "szt", CATALOG)
    assert r["matched"] is False
    assert r["requires_confirmation"] is True
    ids = _ids(r)
    assert "m6" in ids and "m7" in ids  # oba warianty jako kandydaci


def test_never_invents_price_only_catalog_values():
    # każda proponowana cena musi pochodzić z katalogu
    prices = {c["price"] for c in CATALOG}
    r = matching.match_catalog("Gniazdo podtynkowe", "szt", CATALOG)
    for cand in r["candidate_matches"]:
        assert cand["unit_price"] in prices
