# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

```bash
# Backend (port 8001)
cd backend && source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# Frontend (port 3000)
cd frontend && npm run dev

# TypeScript check (no emit)
cd frontend && npx tsc --noEmit

# Lint
cd frontend && npm run lint

# Docker full stack (backend on 8000, frontend on 3000)
cd docker && docker compose up --build
```

The backend venv is at `backend/venv/`. OANDA credentials live in `backend/.env` — never hardcode them. The frontend connects to `ws://${window.location.hostname}:8001` at runtime, so the WS URL adapts automatically to whatever host the browser is loaded from.

## Architecture

### Data flow

```
Exchange REST  →  _seed_engine()  →  send HISTORY (120 bars)
Exchange WS    →  per-tick update  →  send TICK (candle + predictions)
                                   →  send SIGNAL / REGIME / INTEL (every 30 ticks)
```

Every browser tab gets its own WebSocket connection: `GET /ws/stream/{SYMBOL}?tf=1h`. The backend creates a fresh `LivePredictor` per connection — there is no shared state between connections. Timeframe is a query param; the `TF_MAP` dict translates it to the correct Binance interval / OANDA granularity / Yahoo interval / bar_seconds.

### Backend (`backend/main.py`) — single file, ~1000 lines

Three data pipelines, all producing the same WS message schema:
- **Binance** (BTCUSDT/ETHUSDT/SOLUSDT): REST klines for history, then `wss://stream.binance.us:9443/ws/{symbol}@kline_{interval}` for live ticks.
- **OANDA** (EURUSD/GOLD): REST candles for history, then OANDA pricing SSE stream aggregated into bars on the backend. Tick volume is hardcoded `1000.0` — OANDA doesn't provide real traded volume.
- **Yahoo** (AAPL): REST for history and polled every 2s for live price. Data is 15-min delayed. Volume is hardcoded `100_000.0`.

Key engine classes:
- `FeatureEngine` — maintains rolling close/high/low/vol history. Computes true ATR, EMA(9/21/50), CVD, OFI, swing structure (pivot HH/HL), FVG detection, and nearest liquidity pools. All methods use real OHLCV — no simulation.
- `MarketRegimeDetector` — 20-bar price momentum + volume spike detection → BULLISH/BEARISH/RANGING/HIGH VOLATILITY.
- `LivePredictor` — wraps both engines; produces predictions (8-bar quantile paths using ICT-aware structural drift + FVG/liquidity attractors), AI signal (EMA crossover direction, ATR-based zones), and intel dict.
- `_metrics()` in `_stream_*` functions returns **fabricated** numbers for `rows_ingested`, `perf_pct`, `directional_accuracy`, `last_retrain_secs_ago` — these feed the bottom panels and must not be used for trading decisions.

### Frontend (`frontend/src/`)

`page.tsx` owns all state: `selectedSymbol`, `timeframe`, `livePrices`. It calls `useAssetStream(symbol, timeframe)` which holds a single WebSocket and exposes `{history, currentCandle, predictions, signal, regime, metrics, intel, status}`.

**Critical hook behaviour:** `useAssetStream` reconnects whenever `symbol` OR `timeframe` changes (both are in the `useCallback` dep array). On change it clears `history/predictions/signal/regime/intel` immediately so the loading overlay appears, then sets them again once the new `HISTORY` message arrives. Do **not** add `connect` to additional effects — that causes reconnect loops.

`TradingChart.tsx` is the most complex frontend file. It uses a single `createChart()` call (mount-only effect) and manages 7 series refs. Ghost candles (forecast OHLCV) live in `ghostRef` — a second CandlestickSeries rendered after the forecast lines so it draws on top. When `symbol` changes, the check `if (symbol !== lastSymbolRef.current)` in the history effect clears all series before setting new data.

`IndicatorPanels.tsx` renders RSI and MACD on raw `<canvas>` elements (not lightweight-charts). The MACD computation intentionally stores full float precision — do not add `.toFixed()` during computation, only in `fmtMacd()` at display time. EURUSD/GOLD MACD values are on the order of `0.0001`, so display precision is adaptive.

### What is and isn't real data

**Real (safe for trading confluence):** OHLCV candles from all sources, RSI, MACD, EMA(9/21) crossover direction, true ATR, swing structure (HH/HL pivots), FVG midpoints, equal-high/low liquidity levels, Binance funding rate (cached 60s from `fapi.binance.com`).

**Approximate:** CVD direction for OANDA/Yahoo is directionally correct but magnitude is fake (constant volume per tick). Binance CVD uses close-to-close as trade direction — a proxy, not real aggTrades.

**Fabricated — do not rely on:** All six bottom-panel metrics (`rows_ingested`, `directional_accuracy`, `perf_pct`, `last_retrain_secs_ago`, model weights LSTM/TFT/XGBoost, "Self-Learning Active", "Reinforcement Learning", the learning log events, the retrain countdown). These are hardcoded formulas that climb over time and have no connection to actual model performance.

### WS message types

| Type | Payload | Frequency |
|------|---------|-----------|
| `HISTORY` | `data: OHLCV[]` (120 bars) | Once on connect |
| `SIGNAL` | `signal: AISignal` | On connect + every 30 ticks |
| `REGIME` | `regime: MarketRegime` | On connect + every 30 ticks |
| `INTEL` | `intel: MarketIntel` | On connect + every 30 ticks |
| `TICK` | `candle, predictions, metrics` | Every ~1s (throttled) |

### Adding a new symbol

1. Add to `ASSET_REGISTRY` in `main.py` with correct `base_price`, `volatility` (≈ 1H ATR), `tick_size`.
2. Add to the appropriate source set (`BINANCE_SYMBOLS` / `OANDA_SYMBOLS` / `YAHOO_SYMBOLS`).
3. Add instrument mapping if OANDA (`OANDA_INSTRUMENT`) or ticker if Yahoo (`YAHOO_TICKER`).
4. Add to `ASSET_CONFIGS` and `TICKER_DATA` in `frontend/src/types/trading.ts`.
