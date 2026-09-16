"""Parsowanie i mapowanie plików CSV/Excel dla importu katalogu.

Funkcje CZYSTE (bez DB) — łatwe do testów. Zapis do bazy wykonuje server.py.
Nie usuwa żadnych danych; jedynie tworzy nowe lub aktualizuje istniejące pozycje.
"""
import io
import math

import pandas as pd

# Kanoniczne pola docelowe
MATERIAL_FIELDS = [
    "name", "manufacturer", "sku", "ean", "main_category", "subcategory",
    "description", "specs", "unit", "unit_price", "vat_rate",
    "price_source_label", "source_url", "notes", "status",
]
LABOR_FIELDS = [
    "name", "main_category", "subcategory", "description", "unit", "rate",
    "rate_min", "rate_max", "includes_materials", "price_source_label", "notes", "status",
]

REQUIRED = {"material": ["name", "unit_price"], "labor": ["name", "rate"]}

# Aliasy nagłówków (po normalizacji: lower + strip) -> pole kanoniczne
HEADER_ALIASES = {
    "nazwa": "name", "name": "name", "nazwa produktu": "name", "nazwa materiału": "name",
    "nazwa materialu": "name", "nazwa usługi": "name", "nazwa uslugi": "name", "produkt": "name",
    "producent": "manufacturer", "manufacturer": "manufacturer", "marka": "manufacturer",
    "nr katalogowy": "sku", "numer katalogowy": "sku", "sku": "sku", "model": "sku",
    "kod producenta": "sku", "symbol": "sku", "indeks": "sku",
    "ean": "ean", "kod ean": "ean", "kod kreskowy": "ean", "barcode": "ean",
    "kategoria": "main_category", "kategoria główna": "main_category", "kategoria glowna": "main_category",
    "main category": "main_category", "branża": "main_category", "branza": "main_category",
    "podkategoria": "subcategory", "subcategory": "subcategory", "grupa": "subcategory",
    "opis": "description", "description": "description",
    "parametry": "specs", "parametry techniczne": "specs", "specs": "specs", "specyfikacja": "specs",
    "jednostka": "unit", "jm": "unit", "j.m.": "unit", "unit": "unit", "jednostka miary": "unit",
    "cena": "unit_price", "cena netto": "unit_price", "cena jednostkowa": "unit_price",
    "unit_price": "unit_price", "price": "unit_price", "cena netto (pln)": "unit_price",
    "cena materiału": "unit_price", "cena materialu": "unit_price",
    "stawka": "rate", "cena robocizny": "rate", "rate": "rate", "stawka netto": "rate",
    "cena usługi": "rate", "cena uslugi": "rate",
    "vat": "vat_rate", "stawka vat": "vat_rate", "vat_rate": "vat_rate", "vat %": "vat_rate", "podatek": "vat_rate",
    "cena min": "rate_min", "stawka min": "rate_min", "rate_min": "rate_min", "min": "rate_min",
    "cena max": "rate_max", "stawka max": "rate_max", "rate_max": "rate_max", "max": "rate_max",
    "zawiera materiały": "includes_materials", "zawiera materialy": "includes_materials",
    "includes_materials": "includes_materials", "z materiałem": "includes_materials",
    "źródło": "price_source_label", "zrodlo": "price_source_label", "źródło ceny": "price_source_label",
    "zrodlo ceny": "price_source_label", "price_source": "price_source_label", "source": "price_source_label",
    "link": "source_url", "url": "source_url", "source_url": "source_url", "link do źródła": "source_url",
    "uwagi": "notes", "notes": "notes", "komentarz": "notes",
    "status": "status",
}


def _norm(h) -> str:
    return str(h or "").strip().lower()


def parse_file(data: bytes, filename: str):
    """Zwraca (columns:list[str], rows:list[dict]) z pliku CSV lub Excel."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(data), dtype=str, engine="openpyxl")
    else:
        # CSV: autodetekcja separatora
        try:
            df = pd.read_csv(io.BytesIO(data), dtype=str, sep=None, engine="python", encoding="utf-8-sig")
        except Exception:
            df = pd.read_csv(io.BytesIO(data), dtype=str, sep=";", encoding="utf-8-sig")
    df = df.where(pd.notnull(df), None)
    columns = [str(c) for c in df.columns]
    rows = df.to_dict(orient="records")
    # oczyść NaN -> None
    clean = []
    for r in rows:
        clean.append({str(k): (None if (v is None or (isinstance(v, float) and math.isnan(v))) else str(v).strip()) for k, v in r.items()})
    return columns, clean


def suggest_mapping(columns, kind="material"):
    """Zaproponuj mapowanie kolumna_pliku -> pole kanoniczne na podstawie nazw."""
    fields = MATERIAL_FIELDS if kind == "material" else LABOR_FIELDS
    mapping = {}
    for col in columns:
        canon = HEADER_ALIASES.get(_norm(col))
        if canon and canon in fields and canon not in mapping.values():
            mapping[col] = canon
    return mapping


def _to_float(v):
    if v is None:
        return None
    s = str(v).strip().lower().replace("zł", "").replace("pln", "").replace(" ", "").replace("\u00a0", "")
    s = s.replace(",", ".")
    if s == "":
        return None
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def _to_bool(v):
    if v is None:
        return False
    return str(v).strip().lower() in ("1", "true", "tak", "yes", "y", "t", "x")


def _norm_status(v):
    if v is None:
        return "active"
    return "inactive" if str(v).strip().lower() in ("inactive", "nieaktywny", "nieaktywna", "0", "nie") else "active"


def build_records(rows, mapping, kind="material"):
    """Zamień wiersze na rekordy katalogowe. Zwraca (records, errors).

    mapping: {kolumna_pliku: pole_kanoniczne}
    Waliduje wymagane pola, pomija błędne wiersze z komunikatem.
    """
    records, errors = [], []
    price_field = "unit_price" if kind == "material" else "rate"
    inv_seen = set()  # dedup w obrębie pliku po sku/ean/name

    for i, row in enumerate(rows):
        rec = {}
        for col, canon in mapping.items():
            if canon:
                rec[canon] = row.get(col)

        name = (rec.get("name") or "").strip()
        if not name:
            errors.append({"row": i + 1, "error": "Brak nazwy — pominięto"})
            continue

        price = _to_float(rec.get(price_field))
        if rec.get(price_field) not in (None, "") and price is None:
            errors.append({"row": i + 1, "error": f"Niepoprawna cena: '{rec.get(price_field)}' — pominięto"})
            continue
        rec[price_field] = price if price is not None else 0.0

        # typy pól liczbowych / logicznych
        if kind == "material":
            vat = _to_float(rec.get("vat_rate"))
            rec["vat_rate"] = vat if vat is not None else 23.0
        else:
            rec["rate_min"] = _to_float(rec.get("rate_min"))
            rec["rate_max"] = _to_float(rec.get("rate_max"))
            rec["includes_materials"] = _to_bool(rec.get("includes_materials"))
        rec["status"] = _norm_status(rec.get("status"))
        rec["name"] = name

        # klucz dedup
        key = (rec.get("sku") or "").strip().lower() or (rec.get("ean") or "").strip().lower() or name.lower()
        if key in inv_seen:
            errors.append({"row": i + 1, "error": f"Duplikat w pliku: '{name}' — pominięto"})
            continue
        inv_seen.add(key)

        records.append(rec)

    return records, errors
