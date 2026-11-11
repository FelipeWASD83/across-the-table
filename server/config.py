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

# The difficulty changes how Claude is told to play (ai.style); every level uses the same model (decision of
# 10/11/2026: changing model per level still played too well). Only Hard thinks a bit more: Haiku 5.5 with low
# effort for Easy and Medium and medium effort for Hard, as he chose after testing with Haiku.
DIFFICULTIES = ("easy", "medium", "hard")
DEFAULT_MODEL = "claude-haiku-5-5"
DEFAULT_EFFORT = "low"
DEFAULT_EFFORT_HARD = "medium"

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
    # Settings from 1.0.0 had one model per level; they are simply ignored.
    model = str(saved.get("model") or "").strip()[:80] or DEFAULT_MODEL
    effort = saved.get("effort") if saved.get("effort") in EFFORTS else DEFAULT_EFFORT
    effort_hard = saved.get("effort_hard") if saved.get("effort_hard") in EFFORTS else DEFAULT_EFFORT_HARD
    fallback = str(saved.get("fallback") or "auto").strip()[:80] or "auto"
    return {"model": model, "effort": effort, "effort_hard": effort_hard, "fallback": fallback}


def effort_for(cfg: dict, difficulty: str) -> str:
    return cfg["effort_hard"] if difficulty == "hard" else cfg["effort"]


def load() -> dict:
    try:
        saved = json.loads(_settings_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    return _clean(saved if isinstance(saved, dict) else {})


def save(changes: dict) -> dict:
    with _lock:
        current = load()
        for key in ("model", "effort", "effort_hard", "fallback"):
            if key in changes:
                current[key] = changes[key]
        current = _clean(current)
        DATA.mkdir(parents=True, exist_ok=True)
        tmp = _settings_file().with_suffix(".tmp")
        tmp.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, _settings_file())
        return current
