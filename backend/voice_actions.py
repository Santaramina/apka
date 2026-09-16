"""Rozwiązywanie (resolve) poleceń głosowych na konkretne pozycje katalogu/kosztorysu.

Funkcje są CZYSTE (bez DB) — łatwe do testów. Zapis do bazy wykonuje server.py
dopiero PO potwierdzeniu przez użytkownika.
"""
import matching


def _fmt_price(v):
    try:
        return f"{float(v):.2f}".replace(".", ",") + " zł"
    except (TypeError, ValueError):
        return "—"


def _pool_for(item_kind, mat_pool, lab_pool):
    if item_kind == "labor":
        return lab_pool
    if item_kind == "material":
        return mat_pool
    return mat_pool + lab_pool


def resolve_catalog_action(a: dict, mat_pool: list, lab_pool: list) -> dict:
    """Wzbogaca akcję o: status, label, resolved/candidates. Nie modyfikuje danych."""
    op = a.get("op")
    kind = (a.get("item_kind") or "material").lower()
    out = dict(a)
    out["item_kind"] = kind

    if op == "set_price":
        pool = _pool_for(kind, mat_pool, lab_pool)
        res = matching.match_catalog(a.get("query", ""), a.get("unit", "") or "", pool)
        new_price = a.get("new_price")
        if res["matched"]:
            b = res["best"]
            out["status"] = "ok"
            out["resolved"] = b
            out["catalog_id"] = b["catalog_id"]
            out["label"] = f"Zmień cenę: {b['catalog_name']} → {_fmt_price(new_price)}"
        elif res["candidate_matches"]:
            out["status"] = "ambiguous"
            out["candidates"] = res["candidate_matches"]
            out["label"] = f"Wybierz pozycję do zmiany ceny: „{a.get('query', '')}” → {_fmt_price(new_price)}"
        else:
            out["status"] = "not_found"
            out["label"] = f"Nie znaleziono w katalogu: „{a.get('query', '')}”"

    elif op == "delete_item":
        pool = _pool_for(kind, mat_pool, lab_pool)
        res = matching.match_catalog(a.get("query", ""), "", pool)
        if res["matched"]:
            b = res["best"]
            out["status"] = "ok"
            out["resolved"] = b
            out["catalog_id"] = b["catalog_id"]
            out["label"] = f"Usuń z katalogu: {b['catalog_name']}"
        elif res["candidate_matches"]:
            out["status"] = "ambiguous"
            out["candidates"] = res["candidate_matches"]
            out["label"] = f"Wybierz pozycję do usunięcia: „{a.get('query', '')}”"
        else:
            out["status"] = "not_found"
            out["label"] = f"Nie znaleziono w katalogu: „{a.get('query', '')}”"

    elif op == "bump_prices":
        pct = a.get("percent", 0)
        trade = a.get("trade") or ""
        who = {"labor": "robocizny", "material": "materiałów"}.get(kind, "cen")
        where = f" w branży „{trade}”" if trade else ""
        sign = "+" if (pct or 0) >= 0 else ""
        out["status"] = "ok"
        out["label"] = f"Zmień ceny {who}{where} o {sign}{pct}%"

    elif op == "add_item":
        price = a.get("price")
        price_txt = _fmt_price(price) if price is not None else "cena do ustawienia"
        out["status"] = "ok"
        out["label"] = f"Dodaj do katalogu: {a.get('name', '')} ({a.get('unit', 'szt')}) · {price_txt}"

    else:
        out["status"] = "unknown"
        out["label"] = "Nieznane polecenie"

    return out


def _match_estimate_item(query: str, items: list):
    """Znajdź pozycję kosztorysu po nazwie. Zwraca (index, item) lub (None, None)."""
    if not items:
        return None, None
    q = (query or "").strip().lower()
    if q in ("ostatnia", "ostatnią", "ta", "tę", "te", "ostatni"):
        return len(items) - 1, items[-1]
    pool = [{"id": i, "name": it.get("name", ""), "unit": it.get("unit", ""), "price": 0} for i, it in enumerate(items)]
    res = matching.match_catalog(query or "", "", pool)
    if res["matched"]:
        idx = res["best"]["catalog_id"]
        return idx, items[idx]
    # fallback: proste dopasowanie po fragmencie nazwy
    for i, it in enumerate(items):
        if q and q in (it.get("name", "") or "").lower():
            return i, it
    if res["candidate_matches"]:
        idx = res["candidate_matches"][0]["catalog_id"]
        return idx, items[idx]
    return None, None


def resolve_estimate_action(a: dict, items: list) -> dict:
    op = a.get("op")
    out = dict(a)

    if op == "add_item":
        price = a.get("price")
        qty = a.get("quantity", 1)
        price_txt = _fmt_price(price) if price is not None else "cena z katalogu / do ustawienia"
        out["status"] = "ok"
        out["label"] = f"Dodaj pozycję: {qty}× {a.get('name', '')} ({a.get('unit', 'szt')}) · {price_txt}"

    elif op in ("set_price", "set_qty", "delete_item"):
        idx, it = _match_estimate_item(a.get("query", ""), items)
        if it is None:
            out["status"] = "not_found"
            out["label"] = f"Nie znaleziono pozycji: „{a.get('query', '')}”"
        else:
            out["status"] = "ok"
            out["index"] = idx
            out["resolved_name"] = it.get("name", "")
            if op == "set_price":
                out["label"] = f"Zmień cenę: {it.get('name', '')} → {_fmt_price(a.get('new_price'))}"
            elif op == "set_qty":
                out["label"] = f"Zmień ilość: {it.get('name', '')} → {a.get('quantity')}"
            else:
                out["label"] = f"Usuń z kosztorysu: {it.get('name', '')}"

    elif op == "bump_prices":
        pct = a.get("percent", 0)
        kind = (a.get("item_kind") or "all").lower()
        who = {"labor": "robocizny", "material": "materiałów"}.get(kind, "wszystkich pozycji")
        sign = "+" if (pct or 0) >= 0 else ""
        out["status"] = "ok"
        out["label"] = f"Zmień ceny {who} o {sign}{pct}%"

    else:
        out["status"] = "unknown"
        out["label"] = "Nieznane polecenie"

    return out
