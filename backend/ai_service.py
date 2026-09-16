import base64
import json
import os
import re
import tempfile

from emergentintegrations.llm.chat import (
    FileContentWithMimeType,
    ImageContent,
    LlmChat,
    UserMessage,
)

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
GEMINI_MODEL = "gemini-3.1-pro-preview"

TRADE_LABELS = {
    "elektryka": "instalacje elektryczne",
    "teletechnika": "instalacje teletechniczne (RTV-SAT, audio)",
    "sieci_lan": "sieci komputerowe / LAN",
    "cctv": "monitoring CCTV",
    "alarmy": "systemy alarmowe",
    "kontrola_dostepu": "kontrola dostępu",
    "domofony": "domofony i wideodomofony",
    "automatyka": "automatyka budynkowa / smart home",
    "pv": "fotowoltaika (PV)",
    "hydraulika": "instalacje sanitarne / hydraulika",
    "kanalizacja": "instalacje kanalizacyjne",
    "co": "centralne ogrzewanie",
    "hvac": "wentylacja i klimatyzacja (HVAC)",
    "gaz": "instalacje gazowe",
    "wykonczenia": "prace wykończeniowe (płytki, malowanie, gładzie, panele)",
    "ogolnobudowlana": "prace ogólnobudowlane",
    "mieszane": "prace mieszane budowlano-instalacyjne",
}
TRADE_KEYS = list(TRADE_LABELS.keys())

SYSTEM_MESSAGE = (
    "Jesteś doświadczonym kosztorysantem budowlano-instalacyjnym w Polsce. "
    "Analizujesz zdjęcia z budowy oraz opis głosowy/tekstowy i rozpoznajesz ZAKRES PRAC. "
    "Twoim zadaniem jest wypisać potrzebne materiały i robociznę wraz z ILOŚCIAMI i JEDNOSTKAMI. "
    "ZASADY BEZWZGLĘDNE: "
    "1) NIE WYMYŚLAJ materiałów, prac ani ilości. Jeśli czegoś nie widać/nie powiedziano — nie dodawaj tego. "
    "2) NIE PODAJESZ CEN — ceny pochodzą z katalogu użytkownika, nie od Ciebie. "
    "3) Rozróżniaj podstawę ILOŚCI (quantity_basis): 'read' = ilość wprost odczytana/policzona ze zdjęcia lub podana w opisie; "
    "'estimated' = ilość oszacowana, gdy nie ma pewnych danych. Dla 'estimated' obniż confidence. "
    "4) Rozpoznawaj parametry techniczne i umieszczaj je w nazwie (przekrój np. 3x2,5; liczba żył; średnica fi/DN; moc W/kW; napięcie V; model). "
    "5) Jeśli brakuje istotnych danych do jednoznacznego rozpoznania pozycji — ustaw \"needs_confirmation\": true. "
    "6) Nie traktuj wysokiego confidence jako gwarancji — przy wątpliwościach obniżaj confidence i oznaczaj needs_confirmation. "
    "Zawsze odpowiadasz WYŁĄCZNIE poprawnym obiektem JSON, bez komentarzy, bez bloków markdown. "
    "Jednostki: m2, mb, szt, kpl, godz, m3, pkt. "
    "Rodzaje pozycji (kind): 'material' (materiał), 'labor' (robocizna), 'extra' (koszty dodatkowe)."
)

OUTPUT_SPEC = """
Zwróć obiekt JSON o strukturze:
{
  "scope_summary": "krótkie podsumowanie rozpoznanego zakresu prac (2-4 zdania po polsku)",
  "rooms": ["lista rozpoznanych pomieszczeń/miejsc"],
  "transcription": "jeśli było nagranie głosowe - transkrypcja po polsku, inaczej pusty string",
  "items": [
    {
      "kind": "material | labor | extra",
      "name": "precyzyjna nazwa materiału lub rodzaju pracy po polsku z parametrami (np. 'przewód YDY 3x2,5', 'oprawa LED 18W', 'układanie płytek')",
      "unit": "jednostka (m2, mb, szt, kpl, godz, m3, pkt)",
      "quantity": liczba (ilość),
      "quantity_basis": "read | estimated (read = odczytana/podana wprost; estimated = oszacowana)",
      "confidence": liczba 0.0-1.0 (jak pewny jesteś rozpoznania i ilości),
      "needs_confirmation": true/false (true, gdy brak istotnych danych do jednoznacznego rozpoznania),
      "note": "krótka uwaga lub podstawa oszacowania ilości"
    }
  ]
}
NIE PODAWAJ pola z ceną. Podaj kompletną listę: materiały, robociznę i ewentualne koszty dodatkowe.
Podawaj dokładne, konkretne nazwy materiałów (typ, przekrój, wymiar, moc), aby dało się je dopasować do katalogu.
Jeśli ilości nie da się ustalić — ustaw quantity_basis='estimated', obniż confidence i rozważ needs_confirmation=true.
NIE dodawaj pozycji, których nie ma na zdjęciach ani w opisie.
Jeśli rozpoznasz producenta lub model — dopisz go w polu "note". Jeśli istnieją typowe zamienniki, możesz je wskazać w "note" (bez podawania cen).
"""


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    return json.loads(text)


async def analyze_site(session_id, description, images, audio, trade):
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=SYSTEM_MESSAGE,
    ).with_model("gemini", GEMINI_MODEL)

    file_contents = []
    for data, _mime in images:
        file_contents.append(ImageContent(image_base64=base64.b64encode(data).decode("utf-8")))

    tmp_paths = []
    if audio is not None:
        audio_bytes, audio_mime = audio
        suffix = ".m4a"
        if "mp3" in (audio_mime or ""):
            suffix = ".mp3"
        elif "wav" in (audio_mime or ""):
            suffix = ".wav"
        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(audio_bytes)
        tmp_paths.append(path)
        file_contents.append(FileContentWithMimeType(file_path=path, mime_type=audio_mime or "audio/m4a"))

    trade_label = TRADE_LABELS.get(trade, "prace budowlano-instalacyjne")
    parts = [
        f"Branża zlecenia: {trade_label}.",
        f"Liczba dołączonych zdjęć: {len(images)}.",
    ]
    if audio is not None:
        parts.append("Dołączono nagranie głosowe z opisem zakresu prac - najpierw je przepisz, potem uwzględnij.")
    if description:
        parts.append(f"Opis tekstowy od wykonawcy: {description}")
    parts.append(OUTPUT_SPEC)
    prompt = "\n\n".join(parts)

    try:
        response = await chat.send_message(UserMessage(text=prompt, file_contents=file_contents))
    finally:
        for p in tmp_paths:
            try:
                os.remove(p)
            except OSError:
                pass

    data = _extract_json(response)
    items = []
    for it in data.get("items", []):
        try:
            conf = it.get("confidence", None)
            conf = float(conf) if conf is not None else None
            if conf is not None:
                conf = max(0.0, min(1.0, conf))
            basis = str(it.get("quantity_basis", "estimated")).strip().lower()
            if basis not in ("read", "estimated"):
                basis = "estimated"
            items.append(
                {
                    "kind": it.get("kind", "material"),
                    "name": str(it.get("name", "")).strip() or "Pozycja",
                    "unit": str(it.get("unit", "szt")).strip() or "szt",
                    "quantity": float(it.get("quantity", 1) or 1),
                    "quantity_basis": basis,
                    "confidence": conf,
                    "needs_confirmation": bool(it.get("needs_confirmation", False)),
                    "note": str(it.get("note", "")).strip(),
                }
            )
        except (ValueError, TypeError):
            continue
    return {
        "scope_summary": str(data.get("scope_summary", "")).strip(),
        "rooms": data.get("rooms", []) or [],
        "transcription": str(data.get("transcription", "")).strip(),
        "items": items,
    }



# ============================ EDYCJA GŁOSEM ============================
VOICE_SYSTEM = (
    "Jesteś asystentem kosztorysanta budowlano-instalacyjnego w Polsce. "
    "Zamieniasz polecenie głosowe lub tekstowe wykonawcy na USTRUKTURYZOWANE AKCJE (JSON). "
    "NIE wykonujesz akcji — tylko je proponujesz do potwierdzenia. "
    "NIE wymyślasz cen: cenę podajesz TYLKO, jeśli użytkownik wyraźnie ją wypowiedział. "
    "Odpowiadasz WYŁĄCZNIE poprawnym obiektem JSON, bez markdown, bez komentarzy."
)

_VOICE_SPEC_CATALOG = """
Kontekst: KATALOG cen użytkownika (materiały i robocizna).
Zwróć JSON:
{
  "transcription": "dokładna transkrypcja polecenia po polsku (jeśli było audio, inaczej powtórz tekst)",
  "actions": [
    // Zmiana ceny konkretnej pozycji:
    {"op":"set_price","item_kind":"material|labor","query":"nazwa/fraza szukanej pozycji, np. 'YDY 3x2,5'","unit":"opcjonalna jednostka np. m","new_price": liczba},
    // Zbiorcza zmiana procentowa (np. 'podnieś robociznę w elektryce o 10%'):
    {"op":"bump_prices","item_kind":"material|labor|all","trade":"klucz branży lub pusty","percent": liczba_dodatnia_lub_ujemna},
    // Dodanie nowej pozycji do katalogu:
    {"op":"add_item","item_kind":"material|labor","name":"nazwa","unit":"jednostka","price": liczba_lub_null,"trade":"klucz branży lub pusty"},
    // Usunięcie pozycji z katalogu:
    {"op":"delete_item","item_kind":"material|labor","query":"nazwa/fraza"}
  ]
}
"""

_VOICE_SPEC_ESTIMATE = """
Kontekst: KOSZTORYS (bieżąca lista pozycji wyceny).
Zwróć JSON:
{
  "transcription": "dokładna transkrypcja polecenia po polsku (jeśli było audio, inaczej powtórz tekst)",
  "actions": [
    // Dodanie pozycji do kosztorysu (np. 'dodaj 20 punktów elektrycznych po 85 zł'):
    {"op":"add_item","item_kind":"material|labor|extra","name":"nazwa","unit":"jednostka","quantity": liczba,"price": liczba_lub_null},
    // Zmiana ceny jednostkowej istniejącej pozycji:
    {"op":"set_price","query":"nazwa/fraza pozycji","new_price": liczba},
    // Zmiana ilości istniejącej pozycji:
    {"op":"set_qty","query":"nazwa/fraza pozycji","quantity": liczba},
    // Zbiorcza zmiana cen o procent:
    {"op":"bump_prices","item_kind":"material|labor|all","percent": liczba},
    // Usunięcie pozycji z kosztorysu:
    {"op":"delete_item","query":"nazwa/fraza pozycji lub 'ostatnia'/'ta'"}
  ]
}
"""


async def parse_voice_command(text=None, audio=None, context="catalog", extra_context=""):
    """Zamienia polecenie (audio lub tekst) na listę proponowanych akcji.

    Zwraca: {"transcription": str, "actions": [dict, ...]}
    NIE zapisuje żadnych zmian.
    """
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"voice_{context}",
        system_message=VOICE_SYSTEM,
    ).with_model("gemini", GEMINI_MODEL)

    file_contents = []
    tmp_paths = []
    if audio is not None:
        audio_bytes, audio_mime = audio
        suffix = ".m4a"
        if "mp3" in (audio_mime or ""):
            suffix = ".mp3"
        elif "wav" in (audio_mime or ""):
            suffix = ".wav"
        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(audio_bytes)
        tmp_paths.append(path)
        file_contents.append(FileContentWithMimeType(file_path=path, mime_type=audio_mime or "audio/m4a"))

    spec = _VOICE_SPEC_ESTIMATE if context == "estimate" else _VOICE_SPEC_CATALOG
    parts = [
        "Dostępne klucze branż (trade): " + ", ".join(TRADE_KEYS) + ".",
    ]
    if extra_context:
        parts.append(extra_context)
    if audio is not None:
        parts.append("Najpierw przepisz nagranie głosowe, potem zbuduj akcje.")
    if text:
        parts.append(f"Polecenie tekstowe: {text}")
    parts.append(spec)
    prompt = "\n\n".join(parts)

    try:
        response = await chat.send_message(UserMessage(text=prompt, file_contents=file_contents))
    finally:
        for p in tmp_paths:
            try:
                os.remove(p)
            except OSError:
                pass

    data = _extract_json(response)
    actions = []
    for a in data.get("actions", []):
        if isinstance(a, dict) and a.get("op"):
            actions.append(a)
    return {
        "transcription": str(data.get("transcription", "")).strip(),
        "actions": actions,
    }
