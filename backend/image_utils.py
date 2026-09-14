"""Image format detection + HEIC/HEIF -> JPEG conversion (server-side safety net).

The frontend already normalizes photos to JPEG, but iOS can occasionally deliver
HEIC/HEIF bytes. Gemini / object storage should always receive a widely supported
format, so we sniff the REAL bytes (not the declared MIME) and convert when needed.
"""
import io

from PIL import Image

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    _HEIF_OK = True
except Exception:  # pragma: no cover - defensive
    _HEIF_OK = False


_HEIF_BRANDS = {
    b"heic",
    b"heix",
    b"hevc",
    b"hevm",
    b"hevs",
    b"heim",
    b"heis",
    b"mif1",
    b"msf1",
    b"heif",
}


def sniff_image_type(data: bytes) -> str | None:
    """Return a canonical mime for the image bytes, or None if not a known image."""
    if len(data) < 12:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    # ISO-BMFF: box size (4) + 'ftyp' (4) + major brand (4)
    if data[4:8] == b"ftyp":
        brand = data[8:12].lower()
        if brand in _HEIF_BRANDS:
            return "image/heic"
    return None


def to_jpeg(data: bytes) -> bytes:
    """Convert arbitrary (incl. HEIC/HEIF) image bytes to JPEG."""
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return out.getvalue()


def normalize_image(data: bytes, declared_type: str) -> tuple[bytes, str]:
    """Return (bytes, mime) safe for storage + AI.

    - Detects real format from bytes.
    - Converts HEIC/HEIF (and anything unexpected but Pillow-readable) to JPEG.
    - Raises ValueError if the bytes are not a recognizable/decodable image.
    """
    real = sniff_image_type(data)
    if real in ("image/jpeg", "image/png", "image/webp"):
        return data, real
    if real == "image/heic" or real is None:
        # HEIC/HEIF, or a declared image whose header we don't recognize -> try decode.
        try:
            return to_jpeg(data), "image/jpeg"
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Nie udało się odczytać obrazu ({declared_type})") from exc
    return data, real
