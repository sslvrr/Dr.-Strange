# Dr. Strange — Predictive Trading Platform
## Master Architecture & Handoff Document

> Principal Quant Engineer · AI Systems Architect · Institutional Trading UX Designer · Autonomous Execution Developer

---

## PHASE 1 — FULL SYSTEM AUDIT & GAP ANALYSIS

### Original Specification Gaps

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 1 | No real data feed — mock prices only | CRITICAL | Binance/Kraken WS + CCXT fallback |
| 2 | Single-model prediction (statistical math only) | CRITICAL | Ensemble: TFT + LSTM + XGBoost + RL Agent |
| 3 | No quantile regression — single line output | HIGH | Pinball Loss quantile outputs (τ0.10, τ0.50, τ0.90) |
| 4 | No ONNX compilation — Python GIL blocks latency | HIGH | ONNX Runtime inference < 15ms |
| 5 | No market regime detection | HIGH | HMM + volatility clustering regime classifier |
| 6 | No feature engineering pipeline | HIGH | OFI, CVD, Z-score volatility, session OHLCV |
| 7 | No RSI/MACD subplots | MEDIUM | lightweight-charts pane system |
| 8 | No AI signal panel (Entry/TP/SL) | CRITICAL | ICT-aware zone calculator |
| 9 | No self-learning / online retraining | HIGH | Celery async worker + incremental gradient |
| 10 | No Redis pub/sub — direct WS only | MEDIUM | Redis channel fan-out |
| 11 | No database — ephemeral state | HIGH | TimescaleDB for OHLCV + predictions |
| 12 | No risk engine (position sizing, kill switch) | HIGH | Kelly Criterion + max DD circuit breaker |
| 13 | No MLOps tracking | MEDIUM | MLflow experiment tracking |
| 14 | No forecast invalidation | HIGH | Real-time error monitoring + rollback |
| 15 | UI is static SVG — not a real chart lib | CRITICAL | lightweight-charts with custom series plugins |
| 16 | No authentication | MEDIUM | JWT + role-based access |
| 17 | No Docker/K8s manifests | MEDIUM | Docker Compose + Kubernetes HPA |
| 18 | No model confidence calibration | HIGH | Platt scaling + isotonic regression |
| 19 | No liquidity heatmap / order book | HIGH | Level 2 data layer |
| 20 | No whale tracking overlay | LOW | On-chain flow API integration |

---

## PHASE 2 — SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         DR. STRANGE — PRODUCTION ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

                              [ DATA INGESTION LAYER ]
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐
  │  Binance WS  │   │  Kraken WS   │   │  OANDA REST  │   │  Alternative Data    │
  │  (Crypto)    │   │  (Fallback)  │   │  (Forex)     │   │  (News/On-chain)     │
  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────────┬───────────┘
         └──────────────────┴──────────────────┴────────────────────────┘
                                         │
                              [ KAFKA STREAMING BUS ]
                                         │
         ┌──────────────────┬────────────┴────────────┬──────────────────┐
         ▼                  ▼                          ▼                  ▼
  ┌─────────────┐  ┌───────────────┐  ┌──────────────────────┐  ┌───────────────┐
  │  Feature    │  │  TimescaleDB  │  │   ONNX Inference     │  │  Regime       │
  │  Engineer   │  │  (OHLCV+Preds)│  │   Engine (< 15ms)    │  │  Detector     │
  │  (OFI,CVD,  │  │               │  │   TFT+LSTM+XGB+RL    │  │  (HMM+Clust) │
  │   Z-score)  │  │               │  │                      │  │               │
  └──────┬──────┘  └───────────────┘  └──────────┬───────────┘  └───────┬───────┘
         └────────────────────────────────────────┴──────────────────────┘
                                         │
                              [ REDIS PUB/SUB BROKER ]
                                         │
                         ┌───────────────┴────────────────┐
                         ▼                                ▼
                ┌─────────────────┐            ┌──────────────────┐
                │  FastAPI WS     │            │  Risk Engine     │
                │  Gateway        │            │  (Kelly/Max DD)  │
                │  (Python 3.11)  │            │                  │
                └────────┬────────┘            └──────────────────┘
                         │
                ┌────────┴────────┐
                ▼                 ▼
      ┌──────────────┐  ┌──────────────────────┐
      │  Next.js     │  │  Background Workers  │
      │  Dashboard   │  │  Self-Learning Loop  │
      │  (React/TS)  │  │  (Celery + MLflow)   │
      └──────────────┘  └──────────────────────┘
```

### Recommended Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Next.js 14 + React 18 + TypeScript | SSR, app router, type safety |
| Charts | lightweight-charts v4 (TradingView) | Canvas-based, < 1ms render |
| Styling | TailwindCSS + Framer Motion | Dark theme, animations |
| Backend | FastAPI + Python 3.11 | Async WebSocket, speed |
| Streaming | Kafka + Redis Pub/Sub | Fan-out, durability |
| Database | TimescaleDB (Postgres ext) | Time-series optimized |
| AI/ML | PyTorch + ONNX Runtime | Training + fast inference |
| Models | TFT + LSTM + XGBoost + PPO RL | Ensemble diversity |
| Infra | Docker Compose → Kubernetes | Local → cloud scale |
| MLOps | MLflow + DVC | Experiment tracking |
| Monitoring | Prometheus + Grafana | Latency + model drift |

---

## PHASE 3 — AI FORECAST ENGINE

### Model Architecture

```
Input Features (Window=60 bars):
  ├── OHLCV (normalized per session)
  ├── Order Flow Imbalance (OFI) = (bid_volume - ask_volume) / total_volume
  ├── Cumulative Volume Delta (CVD) = Σ(buy_vol - sell_vol)
  ├── Rolling Volatility Z-score = (σ_t - μ_σ) / std_σ  [window=20]
  ├── Session flags (Asian/London/NY open)
  └── Market Regime label (from HMM classifier)

Ensemble Models:
  ├── Temporal Fusion Transformer (TFT)  → weight 72%
  │     Why: handles multi-horizon, learns temporal attention
  │     Latency: ~8ms ONNX | Adv: interpretable attention heads
  │
  ├── Bidirectional LSTM                 → weight 18%
  │     Why: sequential memory, fast inference
  │     Latency: ~3ms ONNX | Adv: good for momentum regimes
  │
  └── XGBoost (tabular features)         → weight 10%
      Why: regime-aware, handles missing data
      Latency: ~1ms | Adv: explainability via SHAP

Output: [τ0.10, τ0.50, τ0.90] × N_steps (default N=8)
Loss: Pinball Loss = Σ_τ [ τ·max(y-ŷ,0) + (1-τ)·max(ŷ-y,0) ]
```

### Forecast Invalidation

- If τ0.50 error > 2σ over last 10 bars → trigger regime shift detection
- If Pinball Loss drift > 30% from baseline → trigger incremental retrain
- Force rollback to previous checkpoint if retrained model degrades directional accuracy > 5%

---

## PHASE 4 — CHART VISUALIZATION ENGINE

Layers rendered on the lightweight-charts canvas:
1. Candlestick series (historical, green/red)
2. Forecast zone separator (dashed vertical line)
3. Bullish path (τ0.90) — cyan dots extending right
4. Bearish path (τ0.10) — red dots extending right
5. Median path (τ0.50) — yellow solid line
6. AI Entry Zone rectangle (green overlay)
7. Stop Loss zone rectangle (red overlay)
8. Take Profit 1 & 2 rectangles (green levels)
9. Volume histogram sub-pane
10. RSI(14) sub-pane with overbought/oversold
11. MACD(12,26) sub-pane with signal + histogram
12. AI Market Regime label overlay
13. Forecast probability labels (62% Bull / 38% Bear)

---

## PHASE 5 — AUTONOMOUS LEARNING ENGINE

### Self-Learning Loop

```python
while True:
    # Every N closed candles
    error = compute_pinball_loss(predictions, actuals)
    if error > DRIFT_THRESHOLD:
        regime = detect_regime(recent_bars=500)
        if regime != current_regime:
            trigger_incremental_train(buffer_size=500)
        else:
            adjust_ensemble_weights(error_by_model)
    log_learning_event(error, regime, timestamp)
    await asyncio.sleep(CHECK_INTERVAL)
```

### Safety Guardrails
- Shadow mode: new model runs in parallel for 2 hours before promotion
- Human override: `/api/model/rollback` endpoint
- Kill switch: `MODEL_FREEZE=true` env var halts all updates
- Max weight delta per cycle: ±5% per model
- Reward function: Sharpe × (1 - max_drawdown) × directional_accuracy

---

## PHASE 6 — EXECUTION ENGINE

| Control | Implementation |
|---------|---------------|
| Position Sizing | Kelly Criterion with f* = (p·b - q) / b, capped at 2% account |
| Stop Loss | AI-generated: Low of entry candle - 1.5×ATR |
| Take Profit | ICT-style: nearest liquidity pool above (TP1), next FVG fill (TP2) |
| Kill Switch | Circuit breaker: 3 consecutive losses or -5% daily DD |
| Slippage | Limit orders only; market order fallback if spread < 0.02% |
| Exposure | Max 6% total open risk; no correlated pairs simultaneously |

---

## PHASE 8 — SPRINT ROADMAP

| Sprint | Duration | Deliverable |
|--------|----------|-------------|
| S0 | Week 1 | Repo skeleton, Docker Compose, dummy WS backend |
| S1 | Week 2 | lightweight-charts dashboard matching target image |
| S2 | Week 3 | Real Binance WS feed + feature engineering |
| S3 | Week 4 | ONNX inference engine + quantile output |
| S4 | Week 5 | Ensemble models training + MLflow |
| S5 | Week 6 | Self-learning loop + regime detection |
| S6 | Week 7 | RSI/MACD subplots + AI signal panel |
| S7 | Week 8 | Risk engine + execution layer |
| S8 | Week 9 | Redis pub/sub + Kafka ingestion |
| S9 | Week 10 | TimescaleDB persistence + replay mode |
| S10 | Week 11 | Auth + multi-user + API keys |
| S11 | Week 12 | K8s manifests + production deployment |

---

## SECURITY FRAMEWORK

- JWT RS256 tokens (15min access + 7d refresh)
- All secrets via environment variables (never hardcoded)
- WebSocket connections authenticated via token query param
- Rate limiting: 100 req/min per IP on REST; WS throttled at 200ms
- CORS: explicit origin whitelist only
- Input validation: Pydantic v2 strict mode on all WS/REST payloads
- HTTPS/WSS enforced in production (Nginx TLS termination)

---

## DEPLOYMENT GUIDE

```bash
# Local development
docker compose up --build

# Backend: http://localhost:8000
# Frontend: http://localhost:3000
# MLflow UI: http://localhost:5000
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3001
```

---

*Generated by Claude Sonnet — Dr. Strange Institutional AI Trading Platform*
