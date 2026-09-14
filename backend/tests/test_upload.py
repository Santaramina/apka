"""Tests for image normalization used by /api/upload (HEIC/HEIF -> JPEG safety net)."""
import io
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import image_utils  # noqa: E402


def _jpeg_bytes():
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(b, format="JPEG")
    return b.getvalue()


def _png_bytes():
    b = io.BytesIO()
    Image.new("RGBA", (8, 8), (10, 200, 10, 255)).save(b, format="PNG")
    return b.getvalue()


def _webp_bytes():
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 10, 200)).save(b, format="WEBP")
    return b.getvalue()


def _heic_bytes():
    import pillow_heif

    pillow_heif.register_heif_opener()
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (100, 100, 100)).save(b, format="HEIF")
    return b.getvalue()


def test_sniff_jpeg():
    assert image_utils.sniff_image_type(_jpeg_bytes()) == "image/jpeg"


def test_sniff_png():
    assert image_utils.sniff_image_type(_png_bytes()) == "image/png"


def test_sniff_webp():
    assert image_utils.sniff_image_type(_webp_bytes()) == "image/webp"


def test_sniff_heic():
    assert image_utils.sniff_image_type(_heic_bytes()) == "image/heic"


def test_sniff_unknown():
    assert image_utils.sniff_image_type(b"not-an-image-at-all") is None


def test_normalize_jpeg_passthrough():
    data = _jpeg_bytes()
    out, mime = image_utils.normalize_image(data, "image/jpeg")
    assert mime == "image/jpeg"
    assert out == data  # unchanged


def test_normalize_png_passthrough():
    data = _png_bytes()
    out, mime = image_utils.normalize_image(data, "image/png")
    assert mime == "image/png"
    assert out == data


def test_normalize_heic_converts_to_jpeg():
    data = _heic_bytes()
    out, mime = image_utils.normalize_image(data, "image/heic")
    assert mime == "image/jpeg"
    assert image_utils.sniff_image_type(out) == "image/jpeg"


def test_normalize_mislabeled_heic_as_jpeg():
    # iOS bug scenario: HEIC bytes declared as image/jpeg -> still converted correctly.
    data = _heic_bytes()
    out, mime = image_utils.normalize_image(data, "image/jpeg")
    assert mime == "image/jpeg"
    assert image_utils.sniff_image_type(out) == "image/jpeg"


def test_normalize_garbage_raises():
    import pytest

    with pytest.raises(ValueError):
        image_utils.normalize_image(b"totally-not-an-image", "image/jpeg")
