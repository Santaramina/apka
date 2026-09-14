"""Lekki dopasowywacz nazw pozycji AI do katalogu użytkownika.

Bez dodatkowych zależności — dopasowanie po tokenach (Jaccard + zawieranie),
z zachowaniem oznaczeń wymiarów typu 3x2,5.
"""
import re

_STOP = {"do", "z", "i", "na", "w", "oraz", "typ", "dla", "od", "the", "a"}


def _norm(s: str) -> str:
    s = (s or "").lower().replace(",", ".")
    s = re.sub(r"[^\w\.\sxX/]", " ", s, flags=re.UNICODE)
    return s


def _tokens(s: str):
    out = set()
    for t in re.split(r"\s+", _norm(s)):
        t = t.strip(".")
        if len(t) >= 2 and t not in _STOP:
            out.add(t)
    return out


def score(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    if not inter:
        return 0.0
    jaccard = len(inter) / len(ta | tb)
    containment = len(inter) / min(len(ta), len(tb))
    return 0.5 * jaccard + 0.5 * containment


def best_match(name: str, candidates, name_key: str = "name", threshold: float = 0.4):
    """Zwraca (najlepszy_kandydat_lub_None, wynik)."""
    best = None
    best_score = 0.0
    for c in candidates:
        sc = score(name, c.get(name_key, ""))
        if sc > best_score:
            best_score = sc
            best = c
    if best is not None and best_score >= threshold:
        return best, round(best_score, 2)
    return None, round(best_score, 2)
