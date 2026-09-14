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
    "Analizujesz zdjęcia z budowy, opis głosowy/tekstowy zakresu prac i przygotowujesz "
    "wstępny kosztorys. Zawsze odpowiadasz WYŁĄCZNIE poprawnym obiektem JSON, bez komentarzy, "
    "bez bloków markdown. Ceny podajesz w PLN (netto), realistyczne dla polskiego rynku. "
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
      "name": "nazwa pozycji po polsku",
      "unit": "jednostka (m2, mb, szt, kpl, godz, m3, pkt)",
      "quantity": liczba (szacunkowa ilość),
      "unit_price": liczba (szacunkowa cena jednostkowa netto w PLN),
      "note": "krótka uwaga lub podstawa oszacowania"
    }
  ]
}
Podaj kompletną listę: materiały, robociznę i ewentualne koszty dodatkowe.
Jeśli czegoś nie da się ustalić ze zdjęć, oszacuj rozsądnie na podstawie opisu.
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
            items.append(
                {
                    "kind": it.get("kind", "material"),
                    "name": str(it.get("name", "")).strip() or "Pozycja",
                    "unit": str(it.get("unit", "szt")).strip() or "szt",
                    "quantity": float(it.get("quantity", 1) or 1),
                    "unit_price": float(it.get("unit_price", 0) or 0),
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
