"""Service configuration from environment variables (and an optional local .env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Tiny .env reader so the service needs no extra dependency. Real environment variables win."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    model_name: str
    service_token: str
    max_texts: int = 64
    max_text_chars: int = 2000
    cache_size: int = 5000


def load_settings() -> Settings:
    _load_dotenv()
    token = os.environ.get("AI_SERVICE_TOKEN", "")
    if len(token) < 24:
        raise RuntimeError("AI_SERVICE_TOKEN must be set to a random string of at least 24 characters")
    return Settings(
        model_name=os.environ.get("AI_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"),
        service_token=token,
    )
