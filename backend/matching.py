"""Dopasowywanie pozycji rozpoznanych przez AI do katalogu użytkownika.

ZASADA: w kosztorysie lepszy jest BRAK automatycznego dopasowania niż BŁĘDNE.
Parametry techniczne (przekrój, liczba żył, średnica, wymiar, napięcie, moc,
pojemność, jednostka) mają PIERWSZEŃSTWO nad podobieństwem tekstowym.

Publiczne API:
    match_catalog(name, unit, candidates) -> dict
        candidates: [{"id","name","unit","price"}...]
        zwraca:
        {
          "matched": bool,               # pewne, automatyczne dopasowanie
          "requires_confirmation": bool, # są kandydaci, ale wymagają potwierdzenia
          "best": {...}|None,            # najlepszy kandydat gdy matched
          "score": float,
          "candidate_matches": [{"catalog_id","catalog_name","unit","unit_price","score"}...]
        }

Bez zależności zewnętrznych.
"""
import re

AUTO_THRESHOLD = 0.72      # pewne dopasowanie automatyczne
CANDIDATE_THRESHOLD = 0.30  # minimalny wynik, by pokazać kandydata do potwierdzenia
MAX_CANDIDATES = 4

_STOP = {"do", "z", "i", "na", "w", "oraz", "typ", "dla", "od", "the", "a", "o"}

# --- normalizacja jednostek -------------------------------------------------
_UNIT_CANON = {
    "m": "m", "mb": "m", "mkw": "m2", "m2": "m2", "m²": "m2", "m^2": "m2",
    "m3": "m3", "m³": "m3", "m^3": "m3",
    "szt": "szt", "szt.": "szt", "sztuk": "szt", "sztuki": "szt", "sztuka": "szt",
    "kpl": "kpl", "kpl.": "kpl", "komplet": "kpl",
    "kg": "kg", "l": "l", "litr": "l", "pkt": "pkt", "punkt": "pkt",
    "godz": "godz", "godz.": "godz", "h": "godz", "rbg": "godz", "rbh": "godz",
    "cm": "cm", "mm": "mm",
}


def canon_unit(u: str) -> str:
    if not u:
        return ""
    key = u.strip().lower().replace(" ", "")
    return _UNIT_CANON.get(key, key)


def units_compatible(a: str, b: str) -> bool:
    ca, cb = canon_unit(a), canon_unit(b)
    if not ca or not cb:
        return True  # brak jednostki po którejś stronie — nie blokuj (potwierdzenie i tak zadecyduje)
    return ca == cb


# --- ekstrakcja parametrów technicznych ------------------------------------
_CORES = re.compile(r"(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)")            # 3x1,5  5x2.5
_DIAM = re.compile(r"(?:fi|φ|ø|dn|Ø)\s*(\d+(?:[.,]\d+)?)", re.IGNORECASE)  # fi20 DN25
_MEAS = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mm|cm|m2|m²|m3|m³|kg|kw|kv|v|w|l|ah|mah)\b", re.IGNORECASE)


def _f(s: str) -> str:
    return str(float(s.replace(",", "."))).rstrip("0").rstrip(".")


def extract_params(name: str):
    """Zwraca (specs, reszta_nazwy_bez_parametrów).

    specs: dict klasa -> set(wartości kanonicznych).
    Klasy: 'cores' (żyłyxprzekrój), 'dia' (średnica mm), oraz jednostki miar (mm/cm/m2/kg/...).
    """
    specs: dict = {}
    text = " " + (name or "").lower() + " "

    def add(cls, val):
        specs.setdefault(cls, set()).add(val)

    def consume(pattern, handler):
        nonlocal text
        out = []
        for m in pattern.finditer(text):
            handler(m)
            out.append((m.start(), m.end()))
        # usuń dopasowania z tekstu (od końca)
        for s, e in reversed(out):
            text = text[:s] + " " + text[e:]

    consume(_CORES, lambda m: add("cores", f"{int(m.group(1))}x{_f(m.group(2))}"))
    consume(_DIAM, lambda m: add("dia", _f(m.group(1))))

    def _meas(m):
        val = _f(m.group(1))
        unit = m.group(2).lower().replace("²", "2").replace("³", "3")
        if unit == "mm":
            add("dia", val)  # 20 mm ~ fi20 (średnica)
        else:
            add(unit, val)
    consume(_MEAS, _meas)

    return specs, text


def _tokens(text: str):
    out = []
    for t in re.split(r"[^\wąćęłńóśźż]+", text, flags=re.UNICODE):
        t = t.strip()
        if len(t) >= 2 and t not in _STOP and not t.isdigit():
            out.append(t)
    return out


def _lev(a: str, b: str) -> int:
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return 2
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[lb]


def _tok_eq(x: str, y: str) -> bool:
    if x == y:
        return True
    # tolerancja literówek tylko dla dłuższych tokenów
    if min(len(x), len(y)) >= 4 and _lev(x, y) <= 1:
        return True
    # producent/typ z sufiksem, np. ydy / ydyp
    if min(len(x), len(y)) >= 3 and (x.startswith(y) or y.startswith(x)) and abs(len(x) - len(y)) <= 1:
        return True
    return False


def _word_sim(aw, bw) -> float:
    if not aw or not bw:
        return 0.0
    inter = sum(1 for w in aw if any(_tok_eq(w, x) for x in bw))
    if inter == 0:
        return 0.0
    union = len(aw) + len(bw) - inter
    jaccard = inter / union if union else 0.0
    containment = inter / min(len(aw), len(bw))
    return 0.5 * jaccard + 0.5 * containment


def _spec_state(qa: dict, qb: dict):
    """Zwraca (conflict, param_state) porównując parametry zapytania (qa) z kandydatem (qb)."""
    conflict = False
    for cls, vals in qa.items():
        other = qb.get(cls)
        if other and vals.isdisjoint(other):
            conflict = True
    # także sprawdź klasy obecne u kandydata a różne u zapytania
    for cls, vals in qb.items():
        other = qa.get(cls)
        if other and vals.isdisjoint(other):
            conflict = True
    if conflict:
        return True, "conflict"
    q_classes = set(qa.keys())
    if not q_classes:
        return False, "none"
    # czy każdy parametr zapytania jest potwierdzony u kandydata
    verified = all(qb.get(cls) and not vals.isdisjoint(qb.get(cls, set())) for cls, vals in qa.items())
    return False, ("verified" if verified else "partial")


def pair_score(a_name: str, a_unit: str, b_name: str, b_unit: str):
    """Zwraca (score, conflict, param_state, unit_ok)."""
    sa, ra = extract_params(a_name)
    sb, rb = extract_params(b_name)
    conflict, state = _spec_state(sa, sb)
    if conflict:
        return 0.0, True, state, units_compatible(a_unit, b_unit)
    word = _word_sim(_tokens(ra), _tokens(rb))
    score = word
    # premia za potwierdzone parametry techniczne
    shared = sum(1 for cls, vals in sa.items() if sb.get(cls) and not vals.isdisjoint(sb[cls]))
    if shared:
        score = min(1.0, score + 0.12 * shared)
    return score, False, state, units_compatible(a_unit, b_unit)


def match_catalog(name: str, unit: str, candidates):
    scored = []
    for c in candidates:
        s, conflict, state, unit_ok = pair_score(name, unit, c.get("name", ""), c.get("unit", ""))
        if conflict:
            continue  # różny parametr techniczny — nigdy nie proponuj
        scored.append((s, state, unit_ok, c))
    scored.sort(key=lambda x: -x[0])

    candidate_matches = []
    for s, state, unit_ok, c in scored[:MAX_CANDIDATES]:
        if s < CANDIDATE_THRESHOLD:
            continue
        candidate_matches.append(
            {
                "catalog_id": c.get("id"),
                "catalog_name": c.get("name"),
                "unit": c.get("unit"),
                "unit_price": c.get("price"),
                "score": round(s, 2),
            }
        )

    result = {
        "matched": False,
        "requires_confirmation": False,
        "best": None,
        "score": round(scored[0][0], 2) if scored else 0.0,
        "candidate_matches": candidate_matches,
    }

    if scored:
        s, state, unit_ok, c = scored[0]
        can_auto = s >= AUTO_THRESHOLD and unit_ok and state in ("none", "verified")
        # jeśli dwa najlepsze wyniki są blisko siebie — bezpieczniej poprosić o potwierdzenie
        if can_auto and len(scored) > 1 and scored[1][0] >= s - 0.05 and scored[1][0] >= AUTO_THRESHOLD:
            can_auto = False
        if can_auto:
            result["matched"] = True
            result["best"] = {
                "catalog_id": c.get("id"),
                "catalog_name": c.get("name"),
                "unit": c.get("unit"),
                "unit_price": c.get("price"),
                "score": round(s, 2),
            }
        elif candidate_matches:
            result["requires_confirmation"] = True

    return result


# --- zgodność wsteczna (stare wywołania / testy) ---------------------------
def score(a: str, b: str) -> float:
    s, conflict, _state, _unit = pair_score(a, "", b, "")
    return 0.0 if conflict else round(s, 2)


def best_match(name: str, candidates, name_key: str = "name", threshold: float = AUTO_THRESHOLD):
    norm = [{"id": c.get("material_id") or c.get("labor_id") or c.get("id"), "name": c.get(name_key, ""), "unit": c.get("unit", ""), "price": c.get("unit_price", c.get("rate", 0)), "_orig": c} for c in candidates]
    res = match_catalog(name, "", norm)
    if res["matched"]:
        for n in norm:
            if n["id"] == res["best"]["catalog_id"]:
                return n["_orig"], res["best"]["score"]
    return None, res["score"]
