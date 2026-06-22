"""
Dr. Strange — Production FastAPI WebSocket Backend v3.0
Live market data: Binance US (crypto) · OANDA (forex/gold) · Yahoo Finance (NAS100)
Quantile Regression + EMA/ATR Signal Engine
Multi-timeframe: 1m · 5m · 15m · 1h · 4h · D · W
"""
import asyncio
import json
import math
import os
import random
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
from typing import Dict, List, Optional
from uuid import uuid4

import httpx
import websockets
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from learning.db import init_db, log_signal, log_outcome, get_learning_status
from learning.loader import get_multiplier, get_report
from learning.scheduler import learning_scheduler

# ── Credentials ────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

OANDA_TOKEN   = os.getenv("OANDA_TOKEN", "")
OANDA_ACCOUNT = os.getenv("OANDA_ACCOUNT", "")
_oanda_env    = os.getenv("OANDA_ENV", "practice")
OANDA_REST    = f"https://api-fx{'practice' if _oanda_env == 'practice' else 'trade'}.oanda.com/v3"
OANDA_STREAM  = f"https://stream-fx{'practice' if _oanda_env == 'practice' else 'trade'}.oanda.com/v3"

TELEGRAM_TOKEN   = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# ── Data-source routing ────────────────────────────────────────────────────────
BINANCE_SYMBOLS = {"BTCUSDT", "ETHUSDT", "SOLUSDT"}
OANDA_SYMBOLS   = {"EURUSD", "GOLD"}
YAHOO_SYMBOLS   = {"NAS100"}

OANDA_INSTRUMENT = {"EURUSD": "EUR_USD", "GOLD": "XAU_USD"}
YAHOO_TICKER     = {"NAS100": "^NDX"}

# ── Timeframe config ───────────────────────────────────────────────────────────
TF_MAP: Dict[str, dict] = {
    "1m":  {"binance": "1m",  "oanda": "M1",  "yahoo_iv": "1m",  "yahoo_rng": "1d",  "secs": 60},
    "5m":  {"binance": "5m",  "oanda": "M5",  "yahoo_iv": "5m",  "yahoo_rng": "60d", "secs": 300},
    "15m": {"binance": "15m", "oanda": "M15", "yahoo_iv": "15m", "yahoo_rng": "60d", "secs": 900},
    "1h":  {"binance": "1h",  "oanda": "H1",  "yahoo_iv": "1h",  "yahoo_rng": "7d",  "secs": 3600},
    "4h":  {"binance": "4h",  "oanda": "H4",  "yahoo_iv": "60m", "yahoo_rng": "60d", "secs": 14400},
    "D":   {"binance": "1d",  "oanda": "D",   "yahoo_iv": "1d",  "yahoo_rng": "1y",  "secs": 86400},
    "W":   {"binance": "1w",  "oanda": "W",   "yahoo_iv": "1wk", "yahoo_rng": "5y",  "secs": 604800},
}
VALID_TFS   = set(TF_MAP.keys())
SECS_TO_TF  = {v["secs"]: k for k, v in TF_MAP.items()}  # e.g. 3600 → "1h"

# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI(title="Dr. Strange — QuantPredict Engine", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    await init_db()
    asyncio.create_task(learning_scheduler())
    # Launch always-on background engine for every asset — logs signals+outcomes 24/7
    for _sym in ASSET_REGISTRY:
        asyncio.create_task(_background_poll_loop(_sym))
    print(f"[startup] learning DB ready · background engines started for "
          f"{list(ASSET_REGISTRY.keys())}", flush=True)


# ── Telegram alerts ───────────────────────────────────────────────────────────
_tg_last_direction: Dict[str, str]   = {}   # key → last alerted direction
_tg_last_alert_ts:  Dict[str, float] = {}   # key → last alert unix timestamp
_tg_url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"


async def _tg(text: str):
    """Fire-and-forget Telegram message. Silently swallows errors."""
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            await c.post(_tg_url, data={
                "chat_id":    TELEGRAM_CHAT_ID,
                "text":       text,
                "parse_mode": "HTML",
            })
    except Exception:
        pass


def _fmt_price(v: float, decimals: int) -> str:
    return f"{v:,.{decimals}f}"


async def _alert_signal(signal: dict, symbol: str, timeframe: str, bar_secs: int = 3600):
    """Send a Telegram alert when signal direction changes — at most once per bar."""
    direction = signal["direction"]
    key = f"{symbol}:{timeframe}"
    now = time.time()

    # Cooldown: don't alert more than once per full bar period
    if now - _tg_last_alert_ts.get(key, 0) < bar_secs:
        return
    # Also deduplicate: skip if direction hasn't changed since last alert
    if _tg_last_direction.get(key) == direction:
        return

    _tg_last_direction[key] = direction
    _tg_last_alert_ts[key]  = now

    d       = len(str(signal["entryZone"][0]).split(".")[-1]) if "." in str(signal["entryZone"][0]) else 0
    arrow   = "🟢 LONG" if direction == "LONG" else "🔴 SHORT"
    sym_tag = symbol.replace("USDT", "")
    entry   = f"{_fmt_price(signal['entryZone'][0], d)} – {_fmt_price(signal['entryZone'][1], d)}"
    tp1     = f"{_fmt_price(signal['takeProfit1'][0], d)} – {_fmt_price(signal['takeProfit1'][1], d)}"
    tp2     = f"{_fmt_price(signal['takeProfit2'][0], d)} – {_fmt_price(signal['takeProfit2'][1], d)}"
    sl      = f"{_fmt_price(signal['stopLoss'][0], d)} – {_fmt_price(signal['stopLoss'][1], d)}"

    text = (
        f"<b>🔮 Dr. Strange — {arrow}</b>\n"
        f"<b>{sym_tag}</b> · {timeframe.upper()}\n\n"
        f"📥 Entry:  <code>{entry}</code>\n"
        f"🎯 TP1:   <code>{tp1}</code>\n"
        f"🎯 TP2:   <code>{tp2}</code>\n"
        f"🛑 SL:    <code>{sl}</code>\n\n"
        f"Confidence: <b>{signal['confidence']}%</b> · R:R {signal['riskReward']}\n"
        f"<i>{signal['validUntil']}</i>"
    )
    await _tg(text)


async def _alert_outcome(outcome: dict):
    """Send a Telegram alert when a prediction hits TP or SL."""
    o   = outcome["outcome"]
    if o == "EXPIRED":
        return
    sym = outcome["symbol"].replace("USDT", "")
    d   = len(str(outcome["entry"]).split(".")[-1]) if "." in str(outcome["entry"]) else 0

    if o == "TP2_WIN":
        icon, label = "✅✅", "TP2 HIT"
    elif o == "TP1_WIN":
        icon, label = "✅", "TP1 HIT"
    else:
        icon, label = "❌", "SL HIT"

    entry_fmt = _fmt_price(outcome["entry"], d)
    close_fmt = _fmt_price(outcome["close_price"], d)
    pnl_pct   = (outcome["close_price"] - outcome["entry"]) / max(outcome["entry"], 1e-10) * 100
    if outcome["direction"] == "SHORT":
        pnl_pct = -pnl_pct
    stats = outcome.get("stats", {})
    wr    = stats.get("win_rate", 0)

    text = (
        f"<b>{icon} Dr. Strange — {label}</b>\n"
        f"<b>{sym}</b> · {outcome['direction']}\n\n"
        f"Entry:  <code>{entry_fmt}</code>\n"
        f"Close:  <code>{close_fmt}</code>  ({pnl_pct:+.2f}%)\n\n"
        f"Win rate ({sym}): <b>{wr}%</b> "
        f"({stats.get('tp1_wins',0)}W / {stats.get('losses',0)}L)"
    )
    await _tg(text)


async def _ws_signal(ws: "WebSocket", engine: "LivePredictor", tf_cfg: dict, alert: bool = False):
    """Send SIGNAL message; optionally fire Telegram if direction changed and cooldown elapsed."""
    sig = engine.get_ai_signal()
    await ws.send_json({"type": "SIGNAL", "signal": sig})
    if alert:
        tf_label  = SECS_TO_TF.get(tf_cfg["secs"], "1h")
        bar_secs  = tf_cfg["secs"]
        asyncio.create_task(_alert_signal(sig, engine.config.symbol, tf_label, bar_secs))
    return sig


# ── Asset registry ─────────────────────────────────────────────────────────────
class AssetConfig(BaseModel):
    symbol: str
    exchange: str
    base_price: float
    volatility: float
    tick_size: float


ASSET_REGISTRY: Dict[str, AssetConfig] = {
    "BTCUSDT": AssetConfig(symbol="BTCUSDT", exchange="BINANCE",  base_price=74300.0,  volatility=500.0,  tick_size=0.1),
    "ETHUSDT": AssetConfig(symbol="ETHUSDT", exchange="BINANCE",  base_price=2025.0,   volatility=30.0,   tick_size=0.01),
    "SOLUSDT": AssetConfig(symbol="SOLUSDT", exchange="BINANCE",  base_price=82.50,    volatility=2.0,    tick_size=0.01),
    "EURUSD":  AssetConfig(symbol="EURUSD",  exchange="OANDA",    base_price=1.16200,  volatility=0.0008, tick_size=0.00001),
    "GOLD":    AssetConfig(symbol="GOLD",    exchange="OANDA",    base_price=4450.0,   volatility=12.0,   tick_size=0.1),
    "NAS100":  AssetConfig(symbol="NAS100",  exchange="NASDAQ",   base_price=18500.0,  volatility=120.0,  tick_size=0.01),
}


# ── Funding rate cache (Binance futures, updated every 60s) ───────────────────
_funding_cache: Dict[str, dict] = {}
_funding_last_fetch: float = 0.0


async def _fetch_funding_rates():
    global _funding_cache, _funding_last_fetch
    if time.time() - _funding_last_fetch < 60:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            resp = await c.get("https://fapi.binance.com/fapi/v1/premiumIndex")
            if resp.status_code == 200:
                rows = resp.json()
                for r in rows:
                    s = r.get("symbol", "")
                    if s in {"BTCUSDT", "ETHUSDT", "SOLUSDT"}:
                        fr = float(r.get("lastFundingRate", 0)) * 100
                        _funding_cache[s] = {
                            "rate_pct": round(fr, 4),
                            "label":    f"{fr:+.4f}%",
                            "type":     "positive" if fr < 0 else ("warning" if fr > 0.05 else "neutral"),
                        }
                _funding_last_fetch = time.time()
    except Exception:
        pass


# ── Market regime detector ─────────────────────────────────────────────────────
class MarketRegimeDetector:
    def __init__(self):
        self.price_history: List[float] = []
        self.vol_history:   List[float] = []

    def update(self, price: float, vol: float):
        self.price_history.append(price)
        self.vol_history.append(vol)
        if len(self.price_history) > 100:
            self.price_history.pop(0)
            self.vol_history.pop(0)

    def detect(self) -> dict:
        if len(self.price_history) < 20:
            return {"label": "BULLISH TREND", "confidence": 72}
        recent   = self.price_history[-20:]
        momentum = (recent[-1] - recent[0]) / max(recent[0], 1) * 100
        avg_vol  = sum(self.vol_history[-10:]) / max(len(self.vol_history[-10:]), 1)
        high_vol = (self.vol_history[-1] if self.vol_history else avg_vol) > avg_vol * 1.5
        if momentum > 0.5 and not high_vol:
            return {"label": "BULLISH TREND",   "confidence": min(90, 60 + int(momentum * 10))}
        elif momentum < -0.5 and not high_vol:
            return {"label": "BEARISH TREND",   "confidence": min(90, 60 + int(abs(momentum) * 10))}
        elif high_vol:
            return {"label": "HIGH VOLATILITY", "confidence": 78}
        else:
            return {"label": "RANGING",          "confidence": 65}


# ── Feature + EMA/ATR engine ───────────────────────────────────────────────────
def _ema(values: List[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    result = sum(values[:period]) / period
    for v in values[period:]:
        result = v * k + result * (1 - k)
    return result


def _compute_rsi14(closes: List[float]) -> Optional[float]:
    """Wilder smoothed RSI-14. Requires at least 15 closes."""
    if len(closes) < 15:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[:14]) / 14
    avg_l = sum(losses[:14]) / 14
    for i in range(14, len(gains)):
        avg_g = (avg_g * 13 + gains[i]) / 14
        avg_l = (avg_l * 13 + losses[i]) / 14
    if avg_l == 0:
        return 100.0
    return round(100.0 - 100.0 / (1.0 + avg_g / avg_l), 2)


class FeatureEngine:
    def __init__(self, config: AssetConfig):
        self.config        = config
        self.close_history: List[float] = []
        self.high_history:  List[float] = []
        self.low_history:   List[float] = []
        self.vol_history:   List[float] = []
        self.cvd: float = 0.0
        self.ofi: float = 0.0
        self.atr: float = config.volatility
        self._bar_cvd_start: float = 0.0  # CVD at last bar open — bounds OFI per-bar
        self._bar_vol: float = 0.0         # volume accumulated this bar

    def update(self, close: float, volume: float, direction: int,
               high: Optional[float] = None, low: Optional[float] = None):
        high = high if high is not None else close
        low  = low  if low  is not None else close
        prev_close = self.close_history[-1] if self.close_history else close

        self.close_history.append(close)
        self.high_history.append(high)
        self.low_history.append(low)
        self.vol_history.append(volume)

        self.cvd += volume * direction
        # Per-bar OFI: CVD delta since bar open divided by bar volume — bounded ~[-1, +1].
        # Replaces the unbounded cumulative formula that accumulates to 500K+ on OANDA fake volume.
        self._bar_vol += volume
        self.ofi = (self.cvd - self._bar_cvd_start) / max(self._bar_vol, 1)

        # True ATR (EMA-14 of true range)
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        tr_list = [
            max(self.high_history[i] - self.low_history[i],
                abs(self.high_history[i] - self.close_history[i - 1]),
                abs(self.low_history[i]  - self.close_history[i - 1]))
            for i in range(max(1, len(self.close_history) - 30), len(self.close_history))
        ]
        if tr_list:
            self.atr = sum(tr_list) / len(tr_list)

        if len(self.close_history) > 200:
            self.close_history.pop(0)
            self.high_history.pop(0)
            self.low_history.pop(0)
            self.vol_history.pop(0)

    def z_score_volatility(self, window: int = 20) -> float:
        if len(self.close_history) < window + 1:
            return 0.0
        returns = [
            (self.close_history[i] - self.close_history[i - 1]) / max(self.close_history[i - 1], 1)
            for i in range(-window, 0)
        ]
        mu    = sum(returns) / window
        sigma = math.sqrt(sum((r - mu) ** 2 for r in returns) / window) or 1e-10
        return (returns[-1] - mu) / sigma

    def ema9(self)  -> Optional[float]: return _ema(self.close_history, 9)
    def ema21(self) -> Optional[float]: return _ema(self.close_history, 21)
    def ema50(self) -> Optional[float]: return _ema(self.close_history, 50)

    def get_swing_structure(self, lookback: int = 30) -> dict:
        """
        Pivot high/low analysis → market structure bias.
        HH+HL = bullish (+1), LH+LL = bearish (-1), mixed = ranging (0).
        Also returns the most recent swing high/low for structural resistance/support.
        """
        n = min(len(self.high_history), len(self.low_history), lookback)
        if n < 6:
            return {"bias": 0, "swing_high": None, "swing_low": None}

        highs = self.high_history[-n:]
        lows  = self.low_history[-n:]

        pivot_highs, pivot_lows = [], []
        for i in range(2, n - 2):
            if highs[i] > highs[i-1] and highs[i] > highs[i-2] and highs[i] > highs[i+1] and highs[i] > highs[i+2]:
                pivot_highs.append(highs[i])
            if lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
                pivot_lows.append(lows[i])

        if len(pivot_highs) < 2 or len(pivot_lows) < 2:
            mid = (max(highs) + min(lows)) / 2
            current = self.close_history[-1] if self.close_history else mid
            return {
                "bias":       1 if current > mid else -1,
                "swing_high": max(highs),
                "swing_low":  min(lows),
            }

        hh = pivot_highs[-1] > pivot_highs[-2]
        hl = pivot_lows[-1]  > pivot_lows[-2]
        lh = pivot_highs[-1] < pivot_highs[-2]
        ll = pivot_lows[-1]  < pivot_lows[-2]

        if hh and hl:
            bias = 1
        elif lh and ll:
            bias = -1
        elif hh or hl:
            bias = 1
        elif lh or ll:
            bias = -1
        else:
            bias = 0

        return {
            "bias":       bias,
            "swing_high": max(pivot_highs[-3:]),
            "swing_low":  min(pivot_lows[-3:]),
        }

    def get_nearest_liquidity(self, current_price: float, bias: int, lookback: int = 40) -> Optional[float]:
        """
        Find nearest liquidity pool (equal highs = BSL, equal lows = SSL).
        Bullish bias → targets equal highs above; bearish → equal lows below.
        Two levels within 0.15% of each other qualify as an equal level.
        """
        if not self.high_history or not self.low_history:
            return None

        n   = min(len(self.high_history), lookback)
        tol = current_price * 0.0015

        if bias >= 0:
            levels = sorted([h for h in self.high_history[-n:] if h > current_price])
            for i in range(len(levels) - 1):
                if abs(levels[i+1] - levels[i]) <= tol:
                    return (levels[i] + levels[i+1]) / 2
            return levels[0] if levels else None
        else:
            levels = sorted([l for l in self.low_history[-n:] if l < current_price], reverse=True)
            for i in range(len(levels) - 1):
                if abs(levels[i] - levels[i+1]) <= tol:
                    return (levels[i] + levels[i+1]) / 2
            return levels[0] if levels else None

    def get_open_fvg(self, current_price: float, lookback: int = 50) -> Optional[float]:
        """
        Detect nearest open Fair Value Gap (3-bar imbalance).
        Bullish FVG: bar[i].low > bar[i-2].high.
        Bearish FVG: bar[i].high < bar[i-2].low.
        Returns midpoint of nearest unmitigated gap, or None.
        """
        n = min(len(self.high_history), len(self.low_history), lookback)
        if n < 3:
            return None

        highs = self.high_history[-n:]
        lows  = self.low_history[-n:]
        fvgs  = []

        for i in range(2, n):
            if lows[i] > highs[i-2]:
                mid = (lows[i] + highs[i-2]) / 2
                fvgs.append((mid, abs(mid - current_price)))
            elif highs[i] < lows[i-2]:
                mid = (highs[i] + lows[i-2]) / 2
                fvgs.append((mid, abs(mid - current_price)))

        if not fvgs:
            return None
        fvgs.sort(key=lambda x: x[1])
        return fvgs[0][0]

    def signal_direction(self) -> str:
        e9  = self.ema9()
        e21 = self.ema21()
        if e9 is None or e21 is None:
            return "LONG" if self.cvd > 0 else "SHORT"
        return "LONG" if e9 > e21 else "SHORT"

    def signal_confidence(self, regime_label: str) -> int:
        e9  = self.ema9()
        e21 = self.ema21()
        zscore = abs(self.z_score_volatility())
        base = 55
        if e9 and e21:
            separation = abs(e9 - e21) / max(abs(e21), 1) * 100
            base = min(88, 55 + separation * 500)
        # z_score: mild boost below 1.5σ, penalize extreme bars — high z_score = low predictability
        if zscore < 1.5:
            base += min(8, zscore * 3)
        else:
            base -= min(20, (zscore - 1.5) * 6)
        # EMA triple alignment: full stack (9>21>50 bull or 9<21<50 bear) adds conviction
        e50 = self.ema50()
        if e9 and e21 and e50:
            if (e9 > e21 > e50) or (e9 < e21 < e50):
                base += 8
            elif (e9 > e21) != (e21 > e50):  # mixed — trend not clean
                base -= 8
        if regime_label == "RANGING":
            base *= 0.85
        elif regime_label == "HIGH VOLATILITY":
            base *= 0.90
        # Apply learning multiplier when recommendations are available
        multiplier = get_multiplier(self.config.symbol, regime_label)
        base *= multiplier
        return int(min(88, max(45, base)))

    def raw_snapshot(self) -> dict:
        """Capture current feature values for learning persistence."""
        current_price = self.close_history[-1] if self.close_history else self.config.base_price
        ms = self.get_swing_structure()
        return {
            "atr":       round(self.atr, 6),
            "ema9":      self.ema9(),
            "ema21":     self.ema21(),
            "ema50":     self.ema50(),
            "cvd":       self.cvd,
            "ofi":       round(self.ofi, 6),
            "z_score":   round(self.z_score_volatility(), 4),
            "fvg_mid":   self.get_open_fvg(current_price),
            "liq_level": self.get_nearest_liquidity(current_price, ms["bias"]),
        }

    def compute_intel(self, symbol: str, regime: dict) -> dict:
        cvd_val  = self.cvd
        ofi_val  = self.ofi
        zscore   = self.z_score_volatility()
        e9, e21  = self.ema9(), self.ema21()

        cvd_trend = "Positive ↑" if cvd_val > 0 else "Negative ↓"
        cvd_type  = "positive" if cvd_val > 0 else "negative"

        ofi_bias  = "Buy Side ↑" if ofi_val > 0 else "Sell Side ↓"
        ofi_type  = "positive" if ofi_val > 0 else "negative"

        vol_label = "High" if abs(zscore) > 1.5 else ("Moderate" if abs(zscore) > 0.5 else "Low")
        vol_type  = "warning" if abs(zscore) > 1.5 else "neutral"

        ema_label = "Above EMA" if (e9 and e21 and e9 > e21) else "Below EMA"
        ema_type  = "positive" if (e9 and e21 and e9 > e21) else "negative"

        regime_lbl  = regime.get("label", "RANGING")
        regime_type = (
            "positive" if "BULL" in regime_lbl
            else "negative" if "BEAR" in regime_lbl
            else "warning"
        )

        funding = _funding_cache.get(symbol, {"label": "N/A", "type": "neutral"})

        current_price = self.close_history[-1] if self.close_history else self.config.base_price
        ms      = self.get_swing_structure()
        fvg_mid = self.get_open_fvg(current_price)
        liq_lvl = self.get_nearest_liquidity(current_price, ms["bias"])
        bar_rng = (
            (self.high_history[-1] - self.low_history[-1])
            if self.high_history and self.low_history else self.atr
        )

        raw = {
            "cvd":              self.cvd,
            "ofi":              round(self.ofi, 6),
            "atr":              round(self.atr, 6),
            "atr_pct":          round(self.atr / max(current_price, 1e-10) * 100, 4),
            "zscore":           round(zscore, 4),
            "regime_label":     regime_lbl,
            "regime_confidence": regime.get("confidence", 65),
            "swing_high":       ms["swing_high"],
            "swing_low":        ms["swing_low"],
            "fvg_mid":          fvg_mid,
            "liq_level":        liq_lvl,
            "swing_bias":       ms["bias"],
            "bar_range":        round(bar_rng, 6),
            "current_price":    round(current_price, 6),
        }

        return {
            "market_intel": [
                {"label": "CVD Trend",        "value": cvd_trend,   "type": cvd_type},
                {"label": "Order Flow Bias",   "value": ofi_bias,    "type": ofi_type},
                {"label": "EMA Position",      "value": ema_label,   "type": ema_type},
                {"label": "Market Regime",     "value": regime_lbl,  "type": regime_type},
                {"label": "Volatility",        "value": vol_label,   "type": vol_type},
                {"label": "Funding Rate",      "value": funding["label"], "type": funding["type"]},
            ],
            "liquidity": [
                {"label": "OFI Direction",     "value": ofi_bias,    "type": ofi_type},
                {"label": "CVD Momentum",      "value": cvd_trend,   "type": cvd_type},
                {"label": "Vol Z-Score",       "value": f"{zscore:+.2f}σ", "type": vol_type},
                {"label": "EMA9 vs EMA21",     "value": ema_label,   "type": ema_type},
                {"label": "ATR",               "value": f"{self.atr:.2f}", "type": "neutral"},
                {"label": "Funding Rate",      "value": funding["label"], "type": funding["type"]},
            ],
            "raw": raw,
        }


# ── Prediction outcome tracker ────────────────────────────────────────────────
class PredictionTracker:
    """Tracks each AI signal from open to TP/SL resolution."""

    # 8 bars of wall-clock time, capped at 8 hours so daily/weekly don't run forever.
    # 1 tick ≈ 1 second (throttled in stream functions).
    _MAX_WALL_SECS = 8 * 3600  # 8h ceiling

    def __init__(self, symbol: str, bar_seconds: int = 60):
        self.symbol            = symbol
        self.max_ticks         = min(8 * bar_seconds, self._MAX_WALL_SECS)
        self.pending: Optional[dict] = None
        self.pending_signal_id: Optional[str] = None
        self.tp1_wins  = 0
        self.tp2_wins  = 0
        self.losses    = 0

    def on_signal(self, signal: dict) -> bool:
        """Open a new pending trade only when direction changes. Returns True if opened."""
        if self.pending and self.pending["direction"] == signal["direction"]:
            return False
        mid = lambda zone: (zone[0] + zone[1]) / 2
        self.pending = {
            "direction": signal["direction"],
            # Use bar-close price as entry (accurate for real fills); fall back to zone mid
            "entry":     signal.get("price") or mid(signal["entryZone"]),
            "tp1_mid":   mid(signal["takeProfit1"]),
            "tp2_mid":   mid(signal["takeProfit2"]),
            "sl_mid":    mid(signal["stopLoss"]),
            "tp1":       signal["takeProfit1"],
            "tp2":       signal["takeProfit2"],
            "sl":        signal["stopLoss"],
            "open_time": int(time.time()),
            "ticks":     0,
        }
        return True

    def on_tick(self, price: float) -> Optional[dict]:
        """Check current price against pending signal. Returns outcome dict or None."""
        if not self.pending:
            return None
        p = self.pending
        p["ticks"] += 1

        hit = None
        if p["direction"] == "LONG":
            if price >= p["tp2_mid"]:   hit = "TP2_WIN"
            elif price >= p["tp1_mid"]: hit = "TP1_WIN"
            elif price <= p["sl_mid"]:  hit = "LOSS"
        else:
            if price <= p["tp2_mid"]:   hit = "TP2_WIN"
            elif price <= p["tp1_mid"]: hit = "TP1_WIN"
            elif price >= p["sl_mid"]:  hit = "LOSS"

        if hit is None and p["ticks"] >= self.max_ticks:
            hit = "EXPIRED"

        if hit:
            return self._resolve(hit, price)
        return None

    def _resolve(self, outcome: str, price: float) -> dict:
        p = self.pending
        self.pending = None
        if outcome == "TP1_WIN":
            self.tp1_wins += 1
        elif outcome == "TP2_WIN":
            self.tp1_wins += 1
            self.tp2_wins += 1
        elif outcome == "LOSS":
            self.losses += 1
        result = {
            "symbol":      self.symbol,
            "direction":   p["direction"],
            "entry":       round(p["entry"], 6),
            "close_price": round(price, 6),
            "outcome":     outcome,
            "ticks":       p["ticks"],
            "tp1":         p["tp1"],
            "tp2":         p["tp2"],
            "sl":          p["sl"],
            "open_time":   p["open_time"],
            "close_time":  int(time.time()),
            "stats":       self.get_stats(),
        }
        if self.pending_signal_id:
            sid = self.pending_signal_id
            self.pending_signal_id = None
            try:
                asyncio.create_task(log_outcome(sid, result))
            except RuntimeError:
                pass
        return result

    def get_stats(self) -> dict:
        total = self.tp1_wins + self.losses
        return {
            "symbol":    self.symbol,
            "tp1_wins":  self.tp1_wins,
            "tp2_wins":  self.tp2_wins,
            "losses":    self.losses,
            "total":     total,
            "win_rate":  round(self.tp1_wins / max(total, 1) * 100, 1),
            "pending":   self.pending is not None,
        }


# ── Live predictor ─────────────────────────────────────────────────────────────
def _nearest_round(price: float, tick: float) -> float:
    """Snap to nearest 00/50 psychological level."""
    if tick >= 0.01:
        unit = max(1.0, price * 0.01)
        unit = 10 ** math.floor(math.log10(unit))
        return round(price / unit) * unit
    return price


class LivePredictor:
    def __init__(self, config: AssetConfig, bar_seconds: int = 3600):
        self.config            = config
        self.bar_seconds       = bar_seconds
        self.current_price     = config.base_price
        self.current_timestamp = int(time.time() // bar_seconds) * bar_seconds
        self.feature_engine    = FeatureEngine(config)
        self.regime_detector   = MarketRegimeDetector()
        self.tracker           = PredictionTracker(config.symbol, bar_seconds)
        # Confirmed direction is only updated at bar close — never mid-bar
        self._confirmed_direction:   str = "LONG"
        self._confirmed_confidence:  int = 55
        self._confirmed_bar_ts:      int = 0    # timestamp of last confirmed bar
        self.last_signal_id: Optional[str] = None

    def confirm_bar_close(self):
        """Lock signal direction from the just-closed bar. Call when a bar closes."""
        regime = self.regime_detector.detect()
        raw_direction = self.feature_engine.signal_direction()
        # BTCUSDT: suppress counter-trend SHORTs during a confirmed uptrend (was a
        # 40% WR / 8-12 source of losses — EMA9/21 dips kept fighting the trend).
        # Only gate once the regime detector has a real 20-bar read, not its
        # warm-up default (which is itself "BULLISH TREND").
        if (self.config.symbol == "BTCUSDT" and raw_direction == "SHORT"
                and regime["label"] == "BULLISH TREND"
                and len(self.regime_detector.price_history) >= 20):
            print(f"[bg:BTCUSDT] suppressed counter-trend SHORT (regime=BULLISH TREND), "
                  f"holding {self._confirmed_direction}", flush=True)
            raw_direction = self._confirmed_direction
        self._confirmed_direction  = raw_direction
        self._confirmed_confidence = self.feature_engine.signal_confidence(regime["label"])
        self._confirmed_bar_ts     = self.current_timestamp

    def _decimals(self) -> int:
        ts = self.config.tick_size
        if ts >= 1:
            return 0
        return len(str(ts).split(".")[-1])

    def generate_historical_data(self, count: int = 120) -> List[dict]:
        data  = []
        start = self.current_timestamp - (count * self.bar_seconds)
        price = self.current_price * 0.92
        vol   = self.config.volatility
        for i in range(count):
            tick_time = start + (i * self.bar_seconds)
            change    = random.normalvariate(vol * 0.05, vol)
            open_p    = price
            close_p   = price + change
            high_p    = max(open_p, close_p) + abs(random.normalvariate(0, vol * 0.4))
            low_p     = min(open_p, close_p) - abs(random.normalvariate(0, vol * 0.4))
            volume    = abs(random.normalvariate(50000, 20000))
            data.append({
                "time":   tick_time,
                "open":   round(open_p,  self._decimals()),
                "high":   round(high_p,  self._decimals()),
                "low":    round(low_p,   self._decimals()),
                "close":  round(close_p, self._decimals()),
                "volume": round(volume, 2),
            })
            price = close_p
        self.current_price = price
        return data

    def compute_next_tick(self) -> dict:
        micro_vol = self.config.volatility * 0.002
        mean_pull = (self.config.base_price - self.current_price) * 0.003
        change    = random.normalvariate(mean_pull, micro_vol)
        bias      = self.feature_engine.cvd / max(abs(self.feature_engine.cvd), 1) * micro_vol * 0.1
        self.current_price = round(
            max(self.config.base_price * 0.5, self.current_price + change + bias), self._decimals()
        )
        direction = 1 if change > 0 else -1
        volume    = abs(random.normalvariate(200, 80))
        self.feature_engine.update(self.current_price, volume, direction)
        self.regime_detector.update(self.current_price, abs(change))
        return {"time": self.current_timestamp, "price": self.current_price, "volume": volume}

    def predict_future_paths(self, horizon: int = 8) -> List[dict]:
        last = self.current_price
        atr  = max(self.feature_engine.atr, self.config.volatility * 0.5)
        bs   = self.bar_seconds
        d    = self._decimals()

        # Market structure: HH/HL vs LH/LL pivot analysis
        ms         = self.feature_engine.get_swing_structure()
        bias       = ms["bias"]           # +1 bull, -1 bear, 0 ranging
        swing_high = ms["swing_high"]
        swing_low  = ms["swing_low"]

        # EMA alignment blended with pivot bias
        e9, e21 = self.feature_engine.ema9(), self.feature_engine.ema21()
        ema_dir = (1 if (e9 and e21 and e9 > e21) else -1) if (e9 and e21) else 0
        struct_dir = bias * 0.6 + ema_dir * 0.4  # weighted directional score

        # ICT attractors
        liq_target = self.feature_engine.get_nearest_liquidity(last, bias)
        fvg_mid    = self.feature_engine.get_open_fvg(last)

        projected  = last
        predictions = []

        for step in range(1, horizon + 1):
            future_time = self.current_timestamp + (step * bs)

            # Structural drift per step: small, consistent push in structure direction
            step_drift = struct_dir * atr * 0.08

            # Liquidity pull: proportional to remaining distance, capped at 0.15 ATR
            liq_pull = 0.0
            if liq_target is not None:
                dist     = liq_target - projected
                liq_pull = math.copysign(min(abs(dist) * 0.12, atr * 0.15), dist)

            # FVG magnet: weaker secondary pull
            fvg_pull = 0.0
            if fvg_mid is not None:
                dist     = fvg_mid - projected
                fvg_pull = math.copysign(min(abs(dist) * 0.08, atr * 0.10), dist)

            median = projected + step_drift + liq_pull * 0.5 + fvg_pull * 0.3

            # Structural deceleration at swing levels (price slows, doesn't teleport through)
            if swing_high and median > swing_high:
                median = swing_high + (median - swing_high) * 0.25
            if swing_low and median < swing_low:
                median = swing_low  - (swing_low - median) * 0.25

            # ATR-based uncertainty expands with sqrt(step)
            uncertainty = atr * math.sqrt(step) * 0.9

            # Asymmetric bands: trending markets give more room in direction of trend
            if struct_dir > 0.3:
                upper = median + uncertainty * 1.1
                lower = median - uncertainty * 0.65
            elif struct_dir < -0.3:
                upper = median + uncertainty * 0.65
                lower = median - uncertainty * 1.1
            else:
                upper = median + uncertainty * 0.88
                lower = median - uncertainty * 0.88

            floor = last * 0.5
            predictions.append({
                "time":   future_time,
                "upper":  round(max(upper,  floor), d),
                "median": round(max(median, floor), d),
                "lower":  round(max(lower,  floor), d),
            })
            projected = median  # chain: next step walks from this step's projection

        return predictions

    def get_ai_signal(self) -> dict:
        p          = self.current_price
        atr        = max(self.feature_engine.atr, self.config.volatility * 0.5)
        regime     = self.regime_detector.detect()
        direction  = self._confirmed_direction    # bar-close confirmed only
        confidence = self._confirmed_confidence   # bar-close confirmed only
        d          = self._decimals()

        # Structural SL: anchor to swing low/high (ICT sweep wick), fall back to ATR
        ms = self.feature_engine.get_swing_structure()
        # Liquidity pool TP: draw on BSL/SSL first, fall back to ATR multiples
        liq = self.feature_engine.get_nearest_liquidity(p, 1 if direction == "LONG" else -1)
        _gold = self.config.symbol == "GOLD"

        if direction == "LONG":
            entry_lo = round(p - atr * 0.15, d); entry_hi = round(p + atr * 0.10, d)
            # Structural SL below most recent swing low (ICT: below sweep wick)
            sw_low = ms.get("swing_low")
            if sw_low and sw_low < p - atr * 0.3:
                sl_lo = round(sw_low - atr * 0.05, d)
                sl_hi = round(sw_low + atr * 0.05, d)
            else:
                sl_lo = round(p - atr * (1.5 if _gold else 1.2), d)
                sl_hi = round(p - atr * (1.0 if _gold else 0.8), d)
            # TP2: nearest liquidity pool (BSL = equal highs above); TP1: midpoint
            if liq and liq > p + atr * 1.5:
                tp2_lo = round(liq - atr * 0.1, d); tp2_hi = round(liq + atr * 0.1, d)
                tp1_mid = (p + liq) / 2
                tp1_lo = round(tp1_mid - atr * 0.1, d); tp1_hi = round(tp1_mid + atr * 0.1, d)
            else:
                tp1_lo = round(p + atr * (1.5 if _gold else 1.0), d)
                tp1_hi = round(p + atr * (1.9 if _gold else 1.4), d)
                tp2_lo = round(p + atr * (3.0 if _gold else 2.0), d)
                tp2_hi = round(p + atr * (3.8 if _gold else 2.6), d)
            rr = round((tp1_lo - entry_hi) / max(entry_lo - sl_hi, 0.0001), 2)
        else:
            entry_hi = round(p + atr * 0.15, d); entry_lo = round(p - atr * 0.10, d)
            sw_high = ms.get("swing_high")
            if sw_high and sw_high > p + atr * 0.3:
                sl_lo = round(sw_high - atr * 0.05, d)
                sl_hi = round(sw_high + atr * 0.05, d)
            else:
                sl_lo = round(p + atr * (1.0 if _gold else 0.8), d)
                sl_hi = round(p + atr * (1.5 if _gold else 1.2), d)
            if liq and liq < p - atr * 1.5:
                tp2_lo = round(liq - atr * 0.1, d); tp2_hi = round(liq + atr * 0.1, d)
                tp1_mid = (p + liq) / 2
                tp1_lo = round(tp1_mid - atr * 0.1, d); tp1_hi = round(tp1_mid + atr * 0.1, d)
            else:
                tp1_hi = round(p - atr * (1.5 if _gold else 1.0), d)
                tp1_lo = round(p - atr * (1.9 if _gold else 1.4), d)
                tp2_hi = round(p - atr * (3.0 if _gold else 2.0), d)
                tp2_lo = round(p - atr * (3.8 if _gold else 2.6), d)
            rr = round(abs(entry_lo - tp1_hi) / max(sl_lo - entry_hi, 0.0001), 2)

        # Kill Zone gate (ICT: off-hours gold signals are invalid — thin market, false breakouts)
        et_hour = datetime.now(_ET).hour
        _in_kill_zone = (2 <= et_hour < 7) or (8 <= et_hour < 12)
        if _gold and not _in_kill_zone:
            confidence = min(confidence, 40)

        # Minimum R:R gate (OTE checklist: 2:1 minimum before entry)
        if _gold and rr < 2.0:
            confidence = min(confidence, 45)

        # Next bar close time
        bs       = self.bar_seconds
        next_bar = (int(time.time() // bs) + 1) * bs
        valid_dt = datetime.fromtimestamp(next_bar, tz=timezone.utc).astimezone(_ET).strftime("%d %b %Y %H:%M ET")

        signal = {
            "direction":  direction,
            "confidence": confidence,
            "price":       round(p, d),          # bar-close price — used as realistic entry
            "entryZone":   [entry_lo, entry_hi],
            "takeProfit1": [tp1_lo, tp1_hi],
            "takeProfit2": [tp2_lo, tp2_hi],
            "stopLoss":    [sl_lo, sl_hi],
            "riskReward":  max(0.1, rr),
            "validUntil":  f"Next candle close — {valid_dt}",
            "stats":       self.tracker.get_stats(),
        }
        # Wire last_signal_id into tracker only if this opens a new trade
        opened = self.tracker.on_signal(signal)
        if opened:
            self.tracker.pending_signal_id = self.last_signal_id
        return signal

    def get_regime(self) -> dict:
        return self.regime_detector.detect()

    def get_intel(self) -> dict:
        return self.feature_engine.compute_intel(self.config.symbol, self.regime_detector.detect())


# ── Shared helpers ─────────────────────────────────────────────────────────────
def _metrics(signal_tick: int, session_start: float) -> dict:
    return {
        "tick_count":   signal_tick,
        "elapsed_secs": int(time.time() - session_start),
    }


def _seed_engine(engine: LivePredictor, history: List[dict]):
    if history:
        last = history[-1]
        engine.current_price     = last["close"]
        engine.current_timestamp = int(last["time"])
    for bar in history[-50:]:
        d = 1 if bar["close"] >= bar["open"] else -1
        engine.feature_engine.update(
            bar["close"], bar.get("volume", 10000), d,
            high=bar.get("high"), low=bar.get("low"),
        )
        engine.regime_detector.update(bar["close"], bar["high"] - bar["low"])
    # Seed confirmed direction from the last closed historical bar
    engine.confirm_bar_close()


def _bar_start(ts: float, bar_secs: int) -> int:
    return int(ts // bar_secs) * bar_secs


# ═══════════════════════════════════════════════════════════════════════════════
# BINANCE US  (BTCUSDT · ETHUSDT · SOLUSDT)
# ═══════════════════════════════════════════════════════════════════════════════

async def _fetch_binance_klines(symbol: str, interval: str = "1h", limit: int = 120) -> List[dict]:
    url = "https://api.binance.us/api/v3/klines"
    async with httpx.AsyncClient(timeout=15.0) as c:
        resp = await c.get(url, params={"symbol": symbol, "interval": interval, "limit": limit})
        resp.raise_for_status()
        rows = resp.json()
    return [{"time": int(r[0]) // 1000, "open": float(r[1]), "high": float(r[2]),
             "low": float(r[3]), "close": float(r[4]), "volume": float(r[5])} for r in rows]


async def _stream_binance(ws: WebSocket, symbol: str, engine: LivePredictor, tf_cfg: dict):
    interval = tf_cfg["binance"]
    bar_secs = tf_cfg["secs"]

    simulated = False
    try:
        history = await _fetch_binance_klines(symbol, interval)
        print(f"[Binance] {symbol}/{interval}: {len(history)} klines", flush=True)
    except Exception as e:
        print(f"[Binance] {symbol} REST failed: {e} — simulation", flush=True)
        history = engine.generate_historical_data(120)
        simulated = True

    _seed_engine(engine, history)
    await ws.send_json({"type": "HISTORY", "data": history, "simulated": simulated})
    await _ws_signal(ws, engine, tf_cfg)
    await ws.send_json({"type": "REGIME", "regime": engine.get_regime()})
    await ws.send_json({"type": "INTEL",  "intel":  engine.get_intel()})

    session_start = time.time()
    signal_tick   = 0
    last_send     = 0.0

    uri = f"wss://stream.binance.us:9443/ws/{symbol.lower()}@kline_{interval}"
    async with websockets.connect(uri, ping_interval=20, ping_timeout=10, close_timeout=5) as bws:
        print(f"[Binance] {symbol}/{interval}: WS live", flush=True)
        async for raw in bws:
            msg = json.loads(raw)
            if msg.get("e") != "kline":
                continue
            now = time.time()
            if now - last_send < 1.0:
                continue
            last_send = now

            k         = msg["k"]
            d         = engine._decimals()
            close_p   = round(float(k["c"]), d)
            direction = 1 if close_p >= engine.current_price else -1
            engine.current_price     = close_p
            engine.current_timestamp = _bar_start(k["t"] / 1000, bar_secs)
            engine.feature_engine.update(
                close_p, float(k["v"]), direction,
                high=round(float(k["h"]), d), low=round(float(k["l"]), d),
            )
            engine.regime_detector.update(close_p, abs(close_p - float(k["o"])))

            # Confirm direction only on bar close (k["x"] == True)
            if k.get("x"):
                engine.confirm_bar_close()
                _sid = str(uuid4())
                engine.last_signal_id = _sid
                asyncio.create_task(log_signal(
                    _sid, engine.config.symbol,
                    SECS_TO_TF.get(tf_cfg["secs"], "1h"),
                    engine._confirmed_bar_ts,
                    engine._confirmed_direction, engine._confirmed_confidence,
                    engine.feature_engine.raw_snapshot(),
                ))

            candle = {
                "time":   engine.current_timestamp,
                "open":   round(float(k["o"]), d),
                "high":   round(float(k["h"]), d),
                "low":    round(float(k["l"]), d),
                "close":  close_p,
                "volume": round(float(k["v"]), 2),
            }
            signal_tick += 1
            outcome = engine.tracker.on_tick(close_p)
            tick_msg: dict = {"type": "TICK", "candle": candle,
                              "predictions": engine.predict_future_paths(),
                              "metrics": _metrics(signal_tick, session_start)}
            if outcome:
                tick_msg["outcome"] = outcome
                asyncio.create_task(_alert_outcome(outcome))
            await ws.send_json(tick_msg)

            if signal_tick % 30 == 0:
                await _fetch_funding_rates()
                await _ws_signal(ws, engine, tf_cfg, alert=True)
                await ws.send_json({"type": "REGIME",  "regime": engine.get_regime()})
                await ws.send_json({"type": "INTEL",   "intel":  engine.get_intel()})


# ═══════════════════════════════════════════════════════════════════════════════
# OANDA PRACTICE  (EURUSD · GOLD)
# ═══════════════════════════════════════════════════════════════════════════════

def _oanda_ts(s: str) -> int:
    return int(datetime.fromisoformat(s[:19]).replace(tzinfo=timezone.utc).timestamp())


async def _fetch_oanda_candles(instrument: str, granularity: str = "H1", count: int = 120) -> List[dict]:
    url     = f"{OANDA_REST}/instruments/{instrument}/candles"
    headers = {"Authorization": f"Bearer {OANDA_TOKEN}"}
    params  = {"count": count + 1, "granularity": granularity, "price": "M"}
    async with httpx.AsyncClient(timeout=15.0) as c:
        resp = await c.get(url, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    return [
        {"time":   _oanda_ts(can["time"]),
         "open":   float(can["mid"]["o"]),
         "high":   float(can["mid"]["h"]),
         "low":    float(can["mid"]["l"]),
         "close":  float(can["mid"]["c"]),
         "volume": float(can["volume"])}
        for can in data["candles"] if can.get("complete")
    ][-count:]


async def _stream_oanda(ws: WebSocket, symbol: str, engine: LivePredictor, tf_cfg: dict):
    instrument  = OANDA_INSTRUMENT[symbol]
    granularity = tf_cfg["oanda"]
    bar_secs    = tf_cfg["secs"]

    simulated = False
    try:
        history = await _fetch_oanda_candles(instrument, granularity)
        print(f"[OANDA] {instrument}/{granularity}: {len(history)} candles", flush=True)
    except Exception as e:
        print(f"[OANDA] {instrument} REST failed: {e} — simulation", flush=True)
        history = engine.generate_historical_data(120)
        simulated = True

    _seed_engine(engine, history)
    await ws.send_json({"type": "HISTORY", "data": history, "simulated": simulated})
    await _ws_signal(ws, engine, tf_cfg)
    await ws.send_json({"type": "REGIME", "regime": engine.get_regime()})
    await ws.send_json({"type": "INTEL",  "intel":  engine.get_intel()})

    session_start = time.time()
    signal_tick   = 0
    last_send     = 0.0

    active_open = engine.current_price
    active_high = engine.current_price
    active_low  = engine.current_price

    stream_url = f"{OANDA_STREAM}/accounts/{OANDA_ACCOUNT}/pricing/stream"
    headers    = {"Authorization": f"Bearer {OANDA_TOKEN}"}
    params     = {"instruments": instrument}

    async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=15.0)) as client:
        async with client.stream("GET", stream_url, headers=headers, params=params) as resp:
            print(f"[OANDA] {instrument}: stream open (HTTP {resp.status_code})", flush=True)
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if msg.get("type") == "HEARTBEAT":
                    continue
                if msg.get("type") != "PRICE":
                    continue

                now = time.time()
                if now - last_send < 1.0:
                    continue
                last_send = now

                bids = msg.get("bids", [])
                asks = msg.get("asks", [])
                if not bids or not asks:
                    continue

                mid = round((float(bids[0]["price"]) + float(asks[0]["price"])) / 2,
                            engine._decimals())

                now_bar = _bar_start(now, bar_secs)
                if now_bar > engine.current_timestamp:
                    # Previous bar just closed — confirm direction before advancing
                    engine.confirm_bar_close()
                    _sid = str(uuid4())
                    engine.last_signal_id = _sid
                    asyncio.create_task(log_signal(
                        _sid, engine.config.symbol,
                        SECS_TO_TF.get(tf_cfg["secs"], "1h"),
                        engine._confirmed_bar_ts,
                        engine._confirmed_direction, engine._confirmed_confidence,
                        engine.feature_engine.raw_snapshot(),
                    ))
                    # Reset per-bar OFI state so it's bounded each candle
                    engine.feature_engine._bar_cvd_start = engine.feature_engine.cvd
                    engine.feature_engine._bar_vol = 0.0
                    engine.current_timestamp = now_bar
                    active_open = mid
                    active_high = mid
                    active_low  = mid
                else:
                    active_high = max(active_high, mid)
                    active_low  = min(active_low,  mid)

                direction = 1 if mid >= engine.current_price else -1
                engine.current_price = mid
                engine.feature_engine.update(mid, 1000.0, direction,
                                             high=active_high, low=active_low)
                engine.regime_detector.update(mid, abs(mid - active_open))

                candle = {"time": engine.current_timestamp, "open": active_open,
                          "high": active_high, "low": active_low, "close": mid, "volume": 1000.0}
                signal_tick += 1
                outcome = engine.tracker.on_tick(mid)
                tick_msg: dict = {"type": "TICK", "candle": candle,
                                  "predictions": engine.predict_future_paths(),
                                  "metrics": _metrics(signal_tick, session_start)}
                if outcome:
                    tick_msg["outcome"] = outcome
                    asyncio.create_task(_alert_outcome(outcome))
                await ws.send_json(tick_msg)
                if signal_tick % 30 == 0:
                    await _ws_signal(ws, engine, tf_cfg, alert=True)
                    await ws.send_json({"type": "REGIME",  "regime": engine.get_regime()})
                    await ws.send_json({"type": "INTEL",   "intel":  engine.get_intel()})


# ═══════════════════════════════════════════════════════════════════════════════
# YAHOO FINANCE  (NAS100)
# ═══════════════════════════════════════════════════════════════════════════════

_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
}


async def _fetch_yahoo_candles(ticker: str, interval: str = "1h", range_: str = "7d") -> List[dict]:
    url    = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    params = {"interval": interval, "range": range_}
    async with httpx.AsyncClient(timeout=15.0, headers=_YF_HEADERS) as c:
        resp = await c.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    result = data["chart"]["result"][0]
    ts     = result["timestamp"]
    q      = result["indicators"]["quote"][0]
    opens, highs, lows, closes, vols = q["open"], q["high"], q["low"], q["close"], q["volume"]

    candles = []
    for i, t in enumerate(ts):
        if closes[i] is None:
            continue
        candles.append({
            "time":   t,
            "open":   round(opens[i]  or closes[i], 2),
            "high":   round(highs[i]  or closes[i], 2),
            "low":    round(lows[i]   or closes[i], 2),
            "close":  round(closes[i], 2),
            "volume": float(vols[i]   or 0),
        })
    seen: dict = {}
    for c in candles:
        seen[c["time"]] = c
    return sorted(seen.values(), key=lambda x: x["time"])


async def _fetch_yahoo_price(ticker: str) -> Optional[float]:
    url    = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    params = {"interval": "1m", "range": "1d"}
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_YF_HEADERS) as c:
            resp = await c.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        closes = data["chart"]["result"][0]["indicators"]["quote"][0]["close"]
        for v in reversed(closes):
            if v is not None:
                return round(float(v), 2)
    except Exception:
        pass
    return None


async def _stream_yahoo(ws: WebSocket, symbol: str, engine: LivePredictor, tf_cfg: dict):
    ticker   = YAHOO_TICKER[symbol]
    interval = tf_cfg["yahoo_iv"]
    range_   = tf_cfg["yahoo_rng"]
    bar_secs = tf_cfg["secs"]

    simulated = False
    try:
        history = await _fetch_yahoo_candles(ticker, interval, range_)
        history = history[-120:]
        print(f"[Yahoo] {ticker}/{interval}: {len(history)} candles", flush=True)
    except Exception as e:
        print(f"[Yahoo] {ticker} failed: {e} — simulation", flush=True)
        history = engine.generate_historical_data(120)
        simulated = True

    _seed_engine(engine, history)
    await ws.send_json({"type": "HISTORY", "data": history, "simulated": simulated})
    await _ws_signal(ws, engine, tf_cfg)
    await ws.send_json({"type": "REGIME", "regime": engine.get_regime()})
    await ws.send_json({"type": "INTEL",  "intel":  engine.get_intel()})

    session_start = time.time()
    signal_tick   = 0

    active_open = engine.current_price
    active_high = engine.current_price
    active_low  = engine.current_price

    while True:
        await asyncio.sleep(2.0)

        price = await _fetch_yahoo_price(ticker)
        if price is None:
            price = round(engine.current_price + random.normalvariate(0, engine.config.volatility * 0.001),
                          engine._decimals())

        now_bar = _bar_start(time.time(), bar_secs)
        if now_bar > engine.current_timestamp:
            engine.confirm_bar_close()
            _sid = str(uuid4())
            engine.last_signal_id = _sid
            asyncio.create_task(log_signal(
                _sid, engine.config.symbol,
                SECS_TO_TF.get(tf_cfg["secs"], "1h"),
                engine._confirmed_bar_ts,
                engine._confirmed_direction, engine._confirmed_confidence,
                engine.feature_engine.raw_snapshot(),
            ))
            engine.current_timestamp = now_bar
            active_open = price
            active_high = price
            active_low  = price
        else:
            active_high = max(active_high, price)
            active_low  = min(active_low,  price)

        direction = 1 if price >= engine.current_price else -1
        engine.current_price = price
        engine.feature_engine.update(price, 100_000.0, direction,
                                     high=active_high, low=active_low)
        engine.regime_detector.update(price, abs(price - active_open))

        candle = {"time": engine.current_timestamp, "open": active_open,
                  "high": active_high, "low": active_low, "close": price, "volume": 100_000.0}
        signal_tick += 1
        outcome = engine.tracker.on_tick(price)
        tick_msg: dict = {"type": "TICK", "candle": candle,
                          "predictions": engine.predict_future_paths(),
                          "metrics": _metrics(signal_tick, session_start)}
        if outcome:
            tick_msg["outcome"] = outcome
            asyncio.create_task(_alert_outcome(outcome))
        await ws.send_json(tick_msg)
        if signal_tick % 15 == 0:
            await _ws_signal(ws, engine, tf_cfg, alert=True)
            await ws.send_json({"type": "REGIME",  "regime": engine.get_regime()})
            await ws.send_json({"type": "INTEL",   "intel":  engine.get_intel()})


# ═══════════════════════════════════════════════════════════════════════════════
# SIMULATION fallback
# ═══════════════════════════════════════════════════════════════════════════════

async def _stream_simulation(ws: WebSocket, symbol: str, engine: LivePredictor, tf_cfg: dict):
    bar_secs = tf_cfg["secs"]
    history  = engine.generate_historical_data(120)
    await ws.send_json({"type": "HISTORY", "data": history})
    await _ws_signal(ws, engine, tf_cfg)
    await ws.send_json({"type": "REGIME", "regime": engine.get_regime()})
    await ws.send_json({"type": "INTEL",  "intel":  engine.get_intel()})

    active_open   = engine.current_price
    active_high   = engine.current_price
    active_low    = engine.current_price
    session_start = time.time()
    signal_tick   = 0

    while True:
        now_bar = _bar_start(time.time(), bar_secs)
        if now_bar > engine.current_timestamp:
            engine.confirm_bar_close()
            _sid = str(uuid4())
            engine.last_signal_id = _sid
            asyncio.create_task(log_signal(
                _sid, engine.config.symbol,
                SECS_TO_TF.get(tf_cfg["secs"], "1h"),
                engine._confirmed_bar_ts,
                engine._confirmed_direction, engine._confirmed_confidence,
                engine.feature_engine.raw_snapshot(),
            ))
            engine.current_timestamp = now_bar
            active_open = engine.current_price
            active_high = engine.current_price
            active_low  = engine.current_price

        tick  = engine.compute_next_tick()
        price = tick["price"]
        active_high = max(active_high, price)
        active_low  = min(active_low,  price)

        candle = {"time": engine.current_timestamp, "open": active_open,
                  "high": active_high, "low": active_low,
                  "close": price, "volume": tick["volume"]}
        signal_tick += 1
        await ws.send_json({"type": "TICK", "candle": candle,
                            "predictions": engine.predict_future_paths(),
                            "metrics": _metrics(signal_tick, session_start)})
        if signal_tick % 30 == 0:
            await _ws_signal(ws, engine, tf_cfg, alert=True)
            await ws.send_json({"type": "REGIME",  "regime": engine.get_regime()})
            await ws.send_json({"type": "INTEL",   "intel":  engine.get_intel()})
        await asyncio.sleep(1.0)


# ═══════════════════════════════════════════════════════════════════════════════
# BACKGROUND ENGINE — headless LivePredictor per asset, runs 24/7 regardless of
# browser connections.  Logs every bar-close signal + all TP/SL outcomes to DB.
# ═══════════════════════════════════════════════════════════════════════════════

_BG_ENGINES: Dict[str, LivePredictor] = {}   # symbol → always-on engine


async def _fetch_for_symbol(symbol: str, tf_cfg: dict, count: int = 120) -> List[dict]:
    """Unified REST fetch for any asset, returns OHLCV list."""
    if symbol in BINANCE_SYMBOLS:
        return await _fetch_binance_klines(symbol, tf_cfg["binance"], count)
    elif symbol in OANDA_SYMBOLS:
        return await _fetch_oanda_candles(OANDA_INSTRUMENT[symbol], tf_cfg["oanda"], count)
    elif symbol in YAHOO_SYMBOLS:
        bars = await _fetch_yahoo_candles(YAHOO_TICKER[symbol], tf_cfg["yahoo_iv"], tf_cfg["yahoo_rng"])
        return bars[-count:]
    return []


async def _background_poll_loop(symbol: str) -> None:
    """
    Headless background task for one asset at 1H resolution.
    - Polls REST every 60 s to detect new closed bars and current price.
    - Calls confirm_bar_close() + log_signal() at each bar close.
    - Calls tracker.on_tick() each poll → PredictionTracker auto-logs outcomes to DB.
    - Sends Telegram alerts on signal and outcome changes.
    """
    tf_cfg   = TF_MAP["1h"]
    bar_secs = tf_cfg["secs"]
    cfg      = ASSET_REGISTRY[symbol]
    engine   = LivePredictor(cfg, bar_seconds=bar_secs)
    _BG_ENGINES[symbol] = engine

    # ── Initial seed ──────────────────────────────────────────────────────────
    seeded = False
    for attempt in range(5):
        try:
            history = await _fetch_for_symbol(symbol, tf_cfg, count=120)
            if history:
                _seed_engine(engine, history)
                seeded = True
                print(f"[bg:{symbol}] seeded {len(history)} bars", flush=True)
                break
        except Exception as e:
            print(f"[bg:{symbol}] seed attempt {attempt+1} failed: {e}", flush=True)
            await asyncio.sleep(15)

    if not seeded:
        print(f"[bg:{symbol}] could not seed — will retry on next poll", flush=True)

    # Emit initial signal after seeding — only log to DB if tracker opens a new pending
    if seeded:
        sid = str(uuid4())
        engine.last_signal_id = sid
        sig = engine.get_ai_signal()   # on_signal() decides if pending opens
        if engine.tracker.pending_signal_id == sid:   # only if on_signal opened it
            asyncio.create_task(log_signal(
                sid, symbol, "1h", engine._confirmed_bar_ts,
                engine._confirmed_direction, engine._confirmed_confidence,
                engine.feature_engine.raw_snapshot(),
            ))
        asyncio.create_task(_alert_signal(sig, symbol, "1h", bar_secs))

    last_bar_ts = engine.current_timestamp

    # ── Main poll loop ────────────────────────────────────────────────────────
    while True:
        await asyncio.sleep(60)
        try:
            bars = await _fetch_for_symbol(symbol, tf_cfg, count=5)
            if not bars:
                continue

            now_bar = _bar_start(time.time(), bar_secs)

            # Process any newly closed bars (may be >1 if we were down)
            for bar in bars:
                if bar["time"] > last_bar_ts and bar["time"] < now_bar:
                    d = 1 if bar["close"] >= bar["open"] else -1
                    engine.feature_engine.update(
                        bar["close"], bar.get("volume", 10_000.0), d,
                        high=bar.get("high"), low=bar.get("low"),
                    )
                    engine.regime_detector.update(bar["close"], bar["high"] - bar["low"])
                    engine.current_price     = bar["close"]
                    engine.current_timestamp = bar["time"]
                    engine.confirm_bar_close()

                    # Reset per-bar OFI for OANDA
                    if symbol in OANDA_SYMBOLS:
                        engine.feature_engine._bar_cvd_start = engine.feature_engine.cvd
                        engine.feature_engine._bar_vol = 0.0

                    sid = str(uuid4())
                    engine.last_signal_id = sid
                    sig = engine.get_ai_signal()   # on_signal() decides if new trade opens
                    # Only log to DB when direction flips and a new trade is now pending
                    if engine.tracker.pending_signal_id == sid:
                        asyncio.create_task(log_signal(
                            sid, symbol, "1h", bar["time"],
                            engine._confirmed_direction, engine._confirmed_confidence,
                            engine.feature_engine.raw_snapshot(),
                        ))
                    asyncio.create_task(_alert_signal(sig, symbol, "1h", bar_secs))
                    last_bar_ts = bar["time"]
                    print(f"[bg:{symbol}] bar closed → {engine._confirmed_direction} "
                          f"conf={engine._confirmed_confidence}%", flush=True)

            # Intra-bar price update (outcome tracking needs current price)
            current_price = bars[-1]["close"]
            engine.current_price = current_price

            # Outcome check — PredictionTracker.on_tick() handles log_outcome() internally
            outcome = engine.tracker.on_tick(current_price)
            if outcome:
                asyncio.create_task(_alert_outcome(outcome))
                print(f"[bg:{symbol}] outcome={outcome['outcome']} "
                      f"WR={outcome['stats']['win_rate']}%", flush=True)

        except Exception as e:
            print(f"[bg:{symbol}] poll error: {e}", flush=True)
            await asyncio.sleep(30)


# ── HTTP endpoints ─────────────────────────────────────────────────────────────
@app.get("/api/scan")
async def scan_market():
    """RSI-14, signal direction, regime, ATR%, price for every symbol — parallel fetch."""
    async def _scan_one(symbol: str) -> dict:
        cfg = ASSET_REGISTRY[symbol]
        try:
            if symbol in BINANCE_SYMBOLS:
                bars = await _fetch_binance_klines(symbol, "1h", 60)
            elif symbol in OANDA_SYMBOLS:
                bars = await _fetch_oanda_candles(OANDA_INSTRUMENT[symbol], "H1", 60)
            elif symbol in YAHOO_SYMBOLS:
                bars = await _fetch_yahoo_candles(YAHOO_TICKER[symbol], "1h", "7d")
                bars = bars[-60:]
            else:
                return {"symbol": symbol, "error": "unknown source"}

            if not bars:
                return {"symbol": symbol, "error": "no data"}

            closes = [b["close"] for b in bars]
            fe = FeatureEngine(cfg)
            for b in bars[-50:]:
                d = 1 if b["close"] >= b["open"] else -1
                fe.update(b["close"], b.get("volume", 10_000.0), d,
                          high=b.get("high"), low=b.get("low"))

            rd = MarketRegimeDetector()
            for b in bars[-20:]:
                rd.update(b["close"], b["high"] - b["low"])

            price = closes[-1]
            return {
                "symbol":    symbol,
                "price":     round(price, 6),
                "rsi14":     _compute_rsi14(closes),
                "direction": fe.signal_direction(),
                "regime":    rd.detect()["label"],
                "atr_pct":   round(fe.atr / max(price, 1e-10) * 100, 4),
            }
        except Exception as e:
            return {"symbol": symbol, "error": str(e)}

    results = await asyncio.gather(*[_scan_one(s) for s in ASSET_REGISTRY.keys()])
    return {"symbols": list(results), "ts": int(time.time())}


@app.get("/api/stats")
async def get_prediction_stats():
    """Aggregate win-rate stats from DB — overall and per symbol. Single source of truth."""
    from learning.db import DB_PATH
    import aiosqlite as _aio
    try:
        async with _aio.connect(DB_PATH) as db:
            db.row_factory = _aio.Row
            # One outcome per signal (first by rowid) — eliminates WS reconnect duplicates
            cur = await db.execute("""
                SELECT s.symbol, o.outcome
                FROM outcomes o
                JOIN signals s ON o.signal_id = s.id
                WHERE o.outcome != 'EXPIRED'
                  AND o.id = (SELECT MIN(id) FROM outcomes o2 WHERE o2.signal_id = o.signal_id)
            """)
            rows = await cur.fetchall()

        by_symbol: dict = {}
        overall = {"tp1_wins": 0, "tp2_wins": 0, "losses": 0, "total": 0}

        for r in rows:
            sym = r["symbol"]
            out = r["outcome"]
            if sym not in by_symbol:
                by_symbol[sym] = {"tp1_wins": 0, "tp2_wins": 0, "losses": 0, "total": 0}
            s = by_symbol[sym]

            if out == "TP2_WIN":
                s["tp2_wins"] += 1; s["tp1_wins"] += 1; s["total"] += 1
                overall["tp2_wins"] += 1; overall["tp1_wins"] += 1; overall["total"] += 1
            elif out == "TP1_WIN":
                s["tp1_wins"] += 1; s["total"] += 1
                overall["tp1_wins"] += 1; overall["total"] += 1
            elif out == "LOSS":
                s["losses"] += 1; s["total"] += 1
                overall["losses"] += 1; overall["total"] += 1

        for d in [overall, *by_symbol.values()]:
            d["win_rate"] = round(d["tp1_wins"] / d["total"] * 100, 1) if d["total"] > 0 else None

        return {"overall": overall, "by_symbol": by_symbol}
    except Exception as e:
        return {"overall": {"tp1_wins": 0, "tp2_wins": 0, "losses": 0, "total": 0, "win_rate": None},
                "by_symbol": {}, "error": str(e)}


@app.get("/api/signals/{symbol}")
async def get_signal_history(symbol: str, limit: int = Query(100, le=500)):
    """Recent signals + resolved outcomes for one symbol, newest first."""
    from learning.db import DB_PATH
    import aiosqlite as _aio
    sym = symbol.upper()
    try:
        async with _aio.connect(DB_PATH) as db:
            db.row_factory = _aio.Row
            cur = await db.execute("""
                SELECT s.id, s.bar_ts, s.tf, s.direction, s.confidence,
                       s.atr, s.z_score, s.cvd, s.ofi,
                       o.outcome, o.entry_price, o.close_price, o.pips,
                       o.created_at AS resolved_at
                FROM signals s
                LEFT JOIN outcomes o
                  ON o.id = (SELECT MIN(id) FROM outcomes o2 WHERE o2.signal_id = s.id)
                WHERE s.symbol = ?
                ORDER BY s.bar_ts DESC
                LIMIT ?
            """, (sym, limit))
            rows = await cur.fetchall()
        return {"symbol": sym, "signals": [dict(r) for r in rows]}
    except Exception as e:
        return {"symbol": sym, "signals": [], "error": str(e)}


@app.get("/api/learning/status")
async def learning_status():
    return await get_learning_status()


@app.get("/api/learning/report")
async def learning_report():
    return get_report()


@app.post("/api/learning/review")
async def trigger_review():
    from learning.analysis import run_weekly_analysis
    result = await run_weekly_analysis()
    return {"ok": result.get("status") == "ok", **result}


@app.get("/api/engines")
async def engine_status():
    """Live snapshot of every background engine — direction, confidence, price, tracker stats."""
    out = {}
    for sym, eng in _BG_ENGINES.items():
        out[sym] = {
            "price":      round(eng.current_price, 6),
            "direction":  eng._confirmed_direction,
            "confidence": eng._confirmed_confidence,
            "regime":     eng.regime_detector.detect()["label"],
            "tracker":    eng.tracker.get_stats(),
        }
    return {"engines": out, "count": len(out), "ts": int(time.time())}


@app.get("/health")
async def health():
    return {"status": "ok", "engine": "Dr. Strange v3.0.0",
            "live": sorted(BINANCE_SYMBOLS | OANDA_SYMBOLS | YAHOO_SYMBOLS),
            "timeframes": list(VALID_TFS),
            "bg_engines": len(_BG_ENGINES)}


@app.get("/assets")
async def list_assets():
    return list(ASSET_REGISTRY.keys())


# ── WebSocket router ───────────────────────────────────────────────────────────
@app.websocket("/ws/stream/{symbol}")
async def websocket_stream(
    websocket: WebSocket,
    symbol: str,
    tf: str = Query("1h"),
):
    symbol = symbol.upper()
    if symbol not in ASSET_REGISTRY:
        await websocket.close(code=4004)
        return

    tf = tf if tf in VALID_TFS else "1h"
    tf_cfg = TF_MAP[tf]

    await websocket.accept()
    engine = LivePredictor(ASSET_REGISTRY[symbol], bar_seconds=tf_cfg["secs"])

    print(f"[WS] {symbol} @ {tf} connected", flush=True)
    try:
        if symbol in BINANCE_SYMBOLS:
            await _stream_binance(websocket, symbol, engine, tf_cfg)
        elif symbol in OANDA_SYMBOLS:
            await _stream_oanda(websocket, symbol, engine, tf_cfg)
        elif symbol in YAHOO_SYMBOLS:
            await _stream_yahoo(websocket, symbol, engine, tf_cfg)
        else:
            await _stream_simulation(websocket, symbol, engine, tf_cfg)
    except WebSocketDisconnect:
        print(f"[WS] {symbol} client disconnected", flush=True)
    except websockets.exceptions.ConnectionClosed as e:
        print(f"[WS] {symbol} upstream WS closed: {e}", flush=True)
    except Exception as e:
        print(f"[WS] {symbol} ERROR {type(e).__name__}: {e}", flush=True)
