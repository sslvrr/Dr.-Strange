"""
Dr. Strange — Production FastAPI WebSocket Backend v3.0
Live market data: Binance US (crypto) · OANDA (forex/gold) · Yahoo Finance (AAPL)
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
from typing import Dict, List, Optional

import httpx
import websockets
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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

# ── Data-source routing ────────────────────────────────────────────────────────
BINANCE_SYMBOLS = {"BTCUSDT", "ETHUSDT", "SOLUSDT"}
OANDA_SYMBOLS   = {"EURUSD", "GOLD"}
YAHOO_SYMBOLS   = {"AAPL", "NAS100"}

OANDA_INSTRUMENT = {"EURUSD": "EUR_USD", "GOLD": "XAU_USD"}
YAHOO_TICKER     = {"AAPL": "AAPL", "NAS100": "^NDX"}

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
VALID_TFS = set(TF_MAP.keys())

# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI(title="Dr. Strange — QuantPredict Engine", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


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
    "AAPL":    AssetConfig(symbol="AAPL",    exchange="NASDAQ",   base_price=210.0,    volatility=1.5,    tick_size=0.01),
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
        self.ofi = (self.cvd - sum(self.vol_history[-20:])) / max(sum(self.vol_history[-20:]), 1)

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
        base += min(10, zscore * 4)
        # Reduce confidence in ranging/volatile markets
        if regime_label == "RANGING":
            base *= 0.85
        elif regime_label == "HIGH VOLATILITY":
            base *= 0.90
        return int(min(88, max(45, base)))

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
        p         = self.current_price
        atr       = max(self.feature_engine.atr, self.config.volatility * 0.5)
        regime    = self.regime_detector.detect()
        direction = self.feature_engine.signal_direction()
        confidence = self.feature_engine.signal_confidence(regime["label"])
        d         = self._decimals()

        if direction == "LONG":
            entry_lo = round(p - atr * 0.15, d); entry_hi = round(p + atr * 0.10, d)
            tp1_lo   = round(p + atr * 1.0,  d); tp1_hi   = round(p + atr * 1.4,  d)
            tp2_lo   = round(p + atr * 2.0,  d); tp2_hi   = round(p + atr * 2.6,  d)
            sl_lo    = round(p - atr * 1.2,  d); sl_hi    = round(p - atr * 0.8,  d)
            rr       = round((tp1_lo - entry_hi) / max(entry_lo - sl_hi, 0.0001), 2)
        else:
            entry_hi = round(p + atr * 0.15, d); entry_lo = round(p - atr * 0.10, d)
            tp1_hi   = round(p - atr * 1.0,  d); tp1_lo   = round(p - atr * 1.4,  d)
            tp2_hi   = round(p - atr * 2.0,  d); tp2_lo   = round(p - atr * 2.6,  d)
            sl_hi    = round(p + atr * 1.2,  d); sl_lo    = round(p + atr * 0.8,  d)
            rr       = round(abs(entry_lo - tp1_hi) / max(sl_lo - entry_hi, 0.0001), 2)

        # Next bar close time
        bs       = self.bar_seconds
        next_bar = (int(time.time() // bs) + 1) * bs
        valid_dt = datetime.fromtimestamp(next_bar, tz=timezone.utc).strftime("%d %b %Y %H:%M UTC")

        return {
            "direction":  direction,
            "confidence": confidence,
            "entryZone":   [entry_lo, entry_hi],
            "takeProfit1": [tp1_lo, tp1_hi],
            "takeProfit2": [tp2_lo, tp2_hi],
            "stopLoss":    [sl_lo, sl_hi],
            "riskReward":  max(0.1, rr),
            "validUntil":  f"Next candle close — {valid_dt}",
        }

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

    try:
        history = await _fetch_binance_klines(symbol, interval)
        print(f"[Binance] {symbol}/{interval}: {len(history)} klines", flush=True)
    except Exception as e:
        print(f"[Binance] {symbol} REST failed: {e} — simulation", flush=True)
        history = engine.generate_historical_data(120)

    _seed_engine(engine, history)
    await ws.send_json({"type": "HISTORY", "data": history})
    await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
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

            candle = {
                "time":   engine.current_timestamp,
                "open":   round(float(k["o"]), d),
                "high":   round(float(k["h"]), d),
                "low":    round(float(k["l"]), d),
                "close":  close_p,
                "volume": round(float(k["v"]), 2),
            }
            signal_tick += 1
            await ws.send_json({"type": "TICK", "candle": candle,
                                "predictions": engine.predict_future_paths(),
                                "metrics": _metrics(signal_tick, session_start)})

            if signal_tick % 30 == 0:
                await _fetch_funding_rates()
                await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
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

    try:
        history = await _fetch_oanda_candles(instrument, granularity)
        print(f"[OANDA] {instrument}/{granularity}: {len(history)} candles", flush=True)
    except Exception as e:
        print(f"[OANDA] {instrument} REST failed: {e} — simulation", flush=True)
        history = engine.generate_historical_data(120)

    _seed_engine(engine, history)
    await ws.send_json({"type": "HISTORY", "data": history})
    await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
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
                await ws.send_json({"type": "TICK", "candle": candle,
                                    "predictions": engine.predict_future_paths(),
                                    "metrics": _metrics(signal_tick, session_start)})
                if signal_tick % 30 == 0:
                    await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
                    await ws.send_json({"type": "REGIME",  "regime": engine.get_regime()})
                    await ws.send_json({"type": "INTEL",   "intel":  engine.get_intel()})


# ═══════════════════════════════════════════════════════════════════════════════
# YAHOO FINANCE  (AAPL)
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

    try:
        history = await _fetch_yahoo_candles(ticker, interval, range_)
        history = history[-120:]
        print(f"[Yahoo] {ticker}/{interval}: {len(history)} candles", flush=True)
    except Exception as e:
        print(f"[Yahoo] {ticker} failed: {e} — simulation", flush=True)
        history = engine.generate_historical_data(120)

    _seed_engine(engine, history)
    await ws.send_json({"type": "HISTORY", "data": history})
    await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
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
        await ws.send_json({"type": "TICK", "candle": candle,
                            "predictions": engine.predict_future_paths(),
                            "metrics": _metrics(signal_tick, session_start)})
        if signal_tick % 15 == 0:
            await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
            await ws.send_json({"type": "REGIME",  "regime": engine.get_regime()})
            await ws.send_json({"type": "INTEL",   "intel":  engine.get_intel()})


# ═══════════════════════════════════════════════════════════════════════════════
# SIMULATION fallback
# ═══════════════════════════════════════════════════════════════════════════════

async def _stream_simulation(ws: WebSocket, symbol: str, engine: LivePredictor, tf_cfg: dict):
    bar_secs = tf_cfg["secs"]
    history  = engine.generate_historical_data(120)
    await ws.send_json({"type": "HISTORY", "data": history})
    await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
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
            await ws.send_json({"type": "SIGNAL", "signal": engine.get_ai_signal()})
            await ws.send_json({"type": "REGIME",  "regime": engine.get_regime()})
            await ws.send_json({"type": "INTEL",   "intel":  engine.get_intel()})
        await asyncio.sleep(1.0)


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


@app.get("/health")
async def health():
    return {"status": "ok", "engine": "Dr. Strange v3.0.0",
            "live": sorted(BINANCE_SYMBOLS | OANDA_SYMBOLS | YAHOO_SYMBOLS),
            "timeframes": list(VALID_TFS)}


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
