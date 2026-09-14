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
    "hydraulika": "instalacje sanitarne / hydraulika",
    "wykonczenia": "prace wykończeniowe (płytki, malowanie, gładzie, panele)",
    "ogolnobudowlana": "prace ogólnobudowlane",
    "mieszane": "prace mieszane budowlano-instalacyjne",
}

SYSTEM_MESSAGE = (
    "Jesteś doświadczonym kosztorysantem budowlano-instalacyjnym w Polsce. "
    "Analizujesz zdjęcia z budowy oraz opis głosowy/tekstowy i rozpoznajesz ZAKRES PRAC. "
    "Twoim zadaniem jest wypisać potrzebne materiały i robociznę wraz z ILOŚCIAMI i JEDNOSTKAMI. "
    "NIE PODAJESZ CEN — ceny pochodzą z katalogu użytkownika, nie od Ciebie. "
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
      "name": "precyzyjna nazwa materiału lub rodzaju pracy po polsku (np. 'przewód YDY 3x2,5', 'układanie płytek')",
      "unit": "jednostka (m2, mb, szt, kpl, godz, m3, pkt)",
      "quantity": liczba (szacunkowa ilość),
      "confidence": liczba 0.0-1.0 (jak pewny jesteś rozpoznania i ilości),
      "note": "krótka uwaga lub podstawa oszacowania ilości"
    }
  ]
}
NIE PODAWAJ pola z ceną. Podaj kompletną listę: materiały, robociznę i ewentualne koszty dodatkowe.
Podawaj dokładne, konkretne nazwy materiałów (typ, przekrój, wymiar), aby dało się je dopasować do katalogu.
Jeśli ilości nie da się ustalić ze zdjęć, oszacuj rozsądnie na podstawie opisu i obniż confidence.
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
            items.append(
                {
                    "kind": it.get("kind", "material"),
                    "name": str(it.get("name", "")).strip() or "Pozycja",
                    "unit": str(it.get("unit", "szt")).strip() or "szt",
                    "quantity": float(it.get("quantity", 1) or 1),
                    "confidence": conf,
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
