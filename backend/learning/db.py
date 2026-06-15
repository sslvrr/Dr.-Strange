"""
SQLite persistence layer for Dr. Strange learning system.
DB lives at backend/dr_strange.db (alongside main.py).
"""
import asyncio
import math
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiosqlite

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_HERE, "dr_strange.db")

_MIN_OUTCOMES = 30


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS signals (
                id          TEXT PRIMARY KEY,
                symbol      TEXT NOT NULL,
                tf          TEXT NOT NULL,
                bar_ts      INTEGER NOT NULL,
                direction   TEXT NOT NULL,
                confidence  REAL NOT NULL,
                atr         REAL,
                ema9        REAL,
                ema21       REAL,
                ema50       REAL,
                cvd         REAL,
                ofi         REAL,
                z_score     REAL,
                fvg_mid     REAL,
                liq_level   REAL,
                created_at  INTEGER NOT NULL,
                UNIQUE (symbol, bar_ts, direction)
            );

            CREATE TABLE IF NOT EXISTS outcomes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                signal_id   TEXT NOT NULL REFERENCES signals(id),
                outcome     TEXT NOT NULL,
                entry_price REAL,
                close_price REAL,
                pips        REAL,
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS weekly_reviews (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                review_ts        INTEGER NOT NULL,
                samples_used     INTEGER NOT NULL,
                adjustments_json TEXT,
                summary          TEXT
            );
        """)
        await db.commit()


async def log_signal(
    signal_id: str,
    symbol: str,
    tf: str,
    bar_ts: int,
    direction: str,
    confidence: int,
    raw: Dict[str, Any],
) -> None:
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT OR IGNORE INTO signals
                   (id, symbol, tf, bar_ts, direction, confidence,
                    atr, ema9, ema21, ema50, cvd, ofi, z_score, fvg_mid, liq_level, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    signal_id, symbol, tf, bar_ts, direction, confidence,
                    raw.get("atr"), raw.get("ema9"), raw.get("ema21"), raw.get("ema50"),
                    raw.get("cvd"), raw.get("ofi"), raw.get("z_score"),
                    raw.get("fvg_mid"), raw.get("liq_level"),
                    int(time.time()),
                ),
            )
            await db.commit()
    except Exception as e:
        print(f"[learning] log_signal error: {e}", flush=True)


async def log_outcome(signal_id: str, outcome: Dict[str, Any]) -> None:
    try:
        entry   = outcome.get("entry", 0.0)
        close_p = outcome.get("close_price", 0.0)
        direction = outcome.get("direction", "LONG")
        pips = (close_p - entry) if direction == "LONG" else (entry - close_p)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT INTO outcomes (signal_id, outcome, entry_price, close_price, pips, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (
                    signal_id,
                    outcome.get("outcome", "UNKNOWN"),
                    entry,
                    close_p,
                    round(pips, 6),
                    int(time.time()),
                ),
            )
            await db.commit()
    except Exception as e:
        print(f"[learning] log_outcome error: {e}", flush=True)


def _next_sunday_2100_utc() -> int:
    """Return unix timestamp of the next Sunday 21:00 UTC."""
    now = datetime.now(timezone.utc)
    days_ahead = (6 - now.weekday()) % 7  # weekday: Mon=0 Sun=6
    if days_ahead == 0 and (now.hour > 21 or (now.hour == 21 and now.minute >= 1)):
        days_ahead = 7
    target = now.replace(hour=21, minute=0, second=0, microsecond=0)
    target = target.replace(day=now.day + days_ahead)
    return int(target.timestamp())


async def get_learning_status() -> Dict[str, Any]:
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row

            cur = await db.execute("SELECT COUNT(*) as n FROM outcomes")
            row = await cur.fetchone()
            resolved = row["n"] if row else 0

            cur = await db.execute(
                "SELECT review_ts FROM weekly_reviews ORDER BY review_ts DESC LIMIT 1"
            )
            row = await cur.fetchone()
            last_review_ts = row["review_ts"] if row else None
            learning_active = last_review_ts is not None

            # Count active adjustments from latest review
            cur = await db.execute(
                "SELECT adjustments_json FROM weekly_reviews ORDER BY review_ts DESC LIMIT 1"
            )
            row = await cur.fetchone()
            adjustment_count = 0
            if row and row["adjustments_json"]:
                import json
                try:
                    adjustment_count = len(json.loads(row["adjustments_json"]))
                except Exception:
                    pass

            return {
                "samples":          resolved,
                "samples_needed":   _MIN_OUTCOMES,
                "learning_active":  learning_active,
                "last_review_ts":   last_review_ts,
                "next_review_ts":   _next_sunday_2100_utc(),
                "adjustment_count": adjustment_count,
            }
    except Exception as e:
        print(f"[learning] get_learning_status error: {e}", flush=True)
        return {
            "samples": 0, "samples_needed": _MIN_OUTCOMES,
            "learning_active": False, "last_review_ts": None,
            "next_review_ts": _next_sunday_2100_utc(), "adjustment_count": 0,
        }


async def get_all_resolved() -> List[Dict[str, Any]]:
    """Return all outcomes joined with signal features for analysis."""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("""
                SELECT s.symbol, s.tf, s.direction, s.confidence,
                       s.atr, s.ema9, s.ema21, s.ema50, s.cvd, s.ofi,
                       s.z_score, s.fvg_mid, s.liq_level,
                       o.outcome, o.pips, s.id as signal_id,
                       r.regime_label
                FROM outcomes o
                JOIN signals s ON o.signal_id = s.id
                LEFT JOIN (
                    SELECT id, 'UNKNOWN' as regime_label FROM signals
                ) r ON r.id = s.id
            """)
            rows = await cur.fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        print(f"[learning] get_all_resolved error: {e}", flush=True)
        return []


async def save_weekly_review(samples_used: int, adjustments: list, summary: str) -> None:
    import json
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT INTO weekly_reviews (review_ts, samples_used, adjustments_json, summary)
                   VALUES (?,?,?,?)""",
                (int(time.time()), samples_used, json.dumps(adjustments), summary),
            )
            await db.commit()
    except Exception as e:
        print(f"[learning] save_weekly_review error: {e}", flush=True)
