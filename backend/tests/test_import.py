"""Testy parsowania/mapowania importu CSV/Excel katalogu."""
import io
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import catalog_import as ci  # noqa: E402


def _csv_bytes(text):
    return text.encode("utf-8")


def test_parse_csv_semicolon():
    csv = "Nazwa;Producent;Cena netto;Jednostka\nPrzewód YDY 3x2,5;Elektrokabel;4,80;mb\n"
    cols, rows = ci.parse_file(_csv_bytes(csv), "cennik.csv")
    assert "Nazwa" in cols and "Cena netto" in cols
    assert rows[0]["Nazwa"].startswith("Przewód")


def test_parse_csv_comma():
    csv = "Nazwa,SKU,Cena\nGniazdo,672510,14.00\n"
    cols, rows = ci.parse_file(_csv_bytes(csv), "c.csv")
    assert set(["Nazwa", "SKU", "Cena"]).issubset(cols)


def test_parse_excel():
    df = pd.DataFrame([{"Nazwa": "Rura PP", "Cena netto": "4,50", "Jednostka": "mb"}])
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    cols, rows = ci.parse_file(buf.getvalue(), "cennik.xlsx")
    assert "Nazwa" in cols
    assert rows[0]["Nazwa"] == "Rura PP"


def test_suggest_mapping_polish_headers():
    cols = ["Nazwa", "Producent", "Nr katalogowy", "EAN", "Cena netto", "Jednostka", "VAT"]
    m = ci.suggest_mapping(cols, "material")
    assert m["Nazwa"] == "name"
    assert m["Producent"] == "manufacturer"
    assert m["Nr katalogowy"] == "sku"
    assert m["EAN"] == "ean"
    assert m["Cena netto"] == "unit_price"
    assert m["Jednostka"] == "unit"
    assert m["VAT"] == "vat_rate"


def test_suggest_mapping_labor():
    cols = ["Nazwa usługi", "Cena robocizny", "Jednostka", "Opis"]
    m = ci.suggest_mapping(cols, "labor")
    assert m["Nazwa usługi"] == "name"
    assert m["Cena robocizny"] == "rate"
    assert m["Jednostka"] == "unit"


def test_build_records_material_valid():
    rows = [{"Nazwa": "Przewód YDY 3x2,5", "Cena": "4,80", "JM": "mb", "VAT": "23"}]
    mapping = {"Nazwa": "name", "Cena": "unit_price", "JM": "unit", "VAT": "vat_rate"}
    recs, errs = ci.build_records(rows, mapping, "material")
    assert len(recs) == 1 and not errs
    assert recs[0]["unit_price"] == 4.80
    assert recs[0]["vat_rate"] == 23.0
    assert recs[0]["unit"] == "mb"


def test_build_records_skips_missing_name():
    rows = [{"Nazwa": "", "Cena": "5"}, {"Nazwa": "OK", "Cena": "5"}]
    mapping = {"Nazwa": "name", "Cena": "unit_price"}
    recs, errs = ci.build_records(rows, mapping, "material")
    assert len(recs) == 1
    assert any("Brak nazwy" in e["error"] for e in errs)


def test_build_records_bad_price_skipped():
    rows = [{"Nazwa": "X", "Cena": "abc"}]
    mapping = {"Nazwa": "name", "Cena": "unit_price"}
    recs, errs = ci.build_records(rows, mapping, "material")
    assert len(recs) == 0
    assert any("Niepoprawna cena" in e["error"] for e in errs)


def test_build_records_price_defaults_zero_when_absent():
    rows = [{"Nazwa": "X"}]
    mapping = {"Nazwa": "name"}
    recs, errs = ci.build_records(rows, mapping, "material")
    assert recs[0]["unit_price"] == 0.0


def test_build_records_dedup_by_sku():
    rows = [
        {"Nazwa": "A", "SKU": "111", "Cena": "5"},
        {"Nazwa": "A kopia", "SKU": "111", "Cena": "6"},
    ]
    mapping = {"Nazwa": "name", "SKU": "sku", "Cena": "unit_price"}
    recs, errs = ci.build_records(rows, mapping, "material")
    assert len(recs) == 1
    assert any("Duplikat" in e["error"] for e in errs)


def test_build_records_labor_types():
    rows = [{"Nazwa": "Montaż", "Stawka": "80", "min": "70", "max": "90", "mat": "tak"}]
    mapping = {"Nazwa": "name", "Stawka": "rate", "min": "rate_min", "max": "rate_max", "mat": "includes_materials"}
    recs, errs = ci.build_records(rows, mapping, "labor")
    assert recs[0]["rate"] == 80.0
    assert recs[0]["rate_min"] == 70.0
    assert recs[0]["includes_materials"] is True


def test_price_parsing_with_currency():
    rows = [{"Nazwa": "X", "Cena": "1 234,50 zł"}]
    mapping = {"Nazwa": "name", "Cena": "unit_price"}
    recs, _ = ci.build_records(rows, mapping, "material")
    assert recs[0]["unit_price"] == 1234.50
