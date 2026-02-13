"""Lightweight i18n module for Courtyard Python scripts.

Usage:
    from i18n import t, init_i18n
    init_i18n("en")  # or "zh-CN", loaded from --lang CLI arg
    print(t("gen.connecting"))  # -> "📡 Connecting to Ollama..."
    print(t("gen.model_info", model="qwen3", mode="qa"))  # interpolation

Locale files are stored in scripts/locales/<lang>.json.
Falls back to English ("en") for missing keys or unsupported languages.
"""

import json
import os

_strings: dict = {}
_fallback: dict = {}
_current_lang: str = "en"

LOCALES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locales")


def _load_locale(lang: str) -> dict:
    """Load a locale JSON file. Returns empty dict if not found."""
    path = os.path.join(LOCALES_DIR, f"{lang}.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def init_i18n(lang: str = "en"):
    """Initialize i18n with the given language code.

    Loads the target language and English as fallback.
    Call this once at script startup before using t().
    """
    global _strings, _fallback, _current_lang
    _current_lang = lang
    _fallback = _load_locale("en")
    if lang == "en":
        _strings = _fallback
    else:
        _strings = _load_locale(lang)


def t(key: str, **kwargs) -> str:
    """Translate a key with optional interpolation.

    Looks up in current language first, falls back to English.
    Supports Python str.format() style placeholders: {name}, {count}, etc.
    Returns the key itself if no translation found.
    """
    text = _strings.get(key) or _fallback.get(key) or key
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError):
            pass  # Return unformatted text if interpolation fails
    return text


def add_lang_arg(parser):
    """Add --lang argument to an argparse parser."""
    parser.add_argument(
        "--lang", default="en",
        help="UI language code (en, zh-CN, etc.)"
    )
