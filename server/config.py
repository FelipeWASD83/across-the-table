"""Paths, version and the settings file (data/config.json)."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "app"
DATA = Path(os.environ.get("ACROSS_THE_TABLE_DATA") or (ROOT / "data"))
PORT = 8084

# What each difficulty means. The model and effort can be changed in Settings; the play style cannot.
DIFFICULTIES = ("easy", "medium", "hard")
DEFAULT_MODELS = {"easy": "claude-haiku-5-5", "medium": "claude-sonnet-5-5", "hard": "claude-opus-5-5"}
DEFAULT_EFFORTS = {"easy": "low", "medium": "medium", "hard": "high"}

MODELS = [
    ("claude-haiku-5-5", "Claude Haiku 5.5"),
    ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
    ("claude-opus-5-5", "Claude Opus 5.5"),
    ("claude-fable-5-2", "Claude Fable 5.2"),
    ("gpt-6-luna", "GPT-6 Luna"),
    ("gpt-6.1-sol", "GPT-6.1 Sol"),
    ("gpt-6-astra", "GPT-6 Astra"),
]
EFFORTS = ("low", "medium", "high", "xhigh", "max")

DEFAULTS = {
    "models": dict(DEFAULT_MODELS),
    "efforts": dict(DEFAULT_EFFORTS),
    "fallback": "auto",
}

_lock = threading.Lock()


def version_info() -> dict:
    try:
        return json.loads((ROOT / "versao.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


VERSION = version_info().get("versao", "0.0.0")


def _settings_file() -> Path:
    return DATA / "config.json"


def _clean(saved: dict) -> dict:
    models = dict(DEFAULT_MODELS)
    efforts = dict(DEFAULT_EFFORTS)
    for level in DIFFICULTIES:
        model = str(((saved.get("models") or {}).get(level)) or "").strip()
        if model:
            models[level] = model[:80]
        effort = (saved.get("efforts") or {}).get(level)
        if effort in EFFORTS:
            efforts[level] = effort
    fallback = str(saved.get("fallback") or "auto").strip()[:80] or "auto"
    return {"models": models, "efforts": efforts, "fallback": fallback}


def load() -> dict:
    try:
        saved = json.loads(_settings_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    return _clean(saved if isinstance(saved, dict) else {})


def save(changes: dict) -> dict:
    with _lock:
        current = load()
        if isinstance(changes.get("models"), dict):
            current["models"].update({k: v for k, v in changes["models"].items() if k in DIFFICULTIES})
        if isinstance(changes.get("efforts"), dict):
            current["efforts"].update({k: v for k, v in changes["efforts"].items() if k in DIFFICULTIES})
        if "fallback" in changes:
            current["fallback"] = changes["fallback"]
        current = _clean(current)
        DATA.mkdir(parents=True, exist_ok=True)
        tmp = _settings_file().with_suffix(".tmp")
        tmp.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, _settings_file())
        return current
