"""Vercel Python function; React assets are served directly from the CDN."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from config.wsgi import application as app  # noqa: E402, F401
