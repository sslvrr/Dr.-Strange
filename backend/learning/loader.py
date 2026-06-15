"""
Reads recommendations.json and returns per-(symbol, regime) multipliers.
Cache is refreshed every 60 seconds to pick up new weekly reviews.
"""
import json
import os
import time
from typing import Dict, Optional

_HERE     = os.path.dirname(os.path.abspath(__file__))
RECS_PATH = os.path.join(_HERE, "recommendations.json")

_cache: Optional[dict]  = None
_cache_ts: float        = 0.0
_CACHE_TTL              = 60.0


def _load() -> dict:
    global _cache, _cache_ts
    now = time.time()
    if _cache is not None and now - _cache_ts < _CACHE_TTL:
        return _cache
    try:
        with open(RECS_PATH) as f:
            _cache = json.load(f)
    except Exception:
        _cache = {}
    _cache_ts = now
    return _cache


def get_multiplier(symbol: str, regime: str) -> float:
    """Return confidence multiplier for (symbol, regime). Defaults to 1.0."""
    data = _load()
    if not data or data.get("status") != "ok":
        return 1.0
    for adj in data.get("adjustments", []):
        if adj.get("symbol") == symbol and adj.get("regime") == regime:
            return float(adj.get("multiplier", 1.0))
    return 1.0


def get_report() -> dict:
    """Return the full recommendations dict for the /api/learning/report endpoint."""
    return _load()
