# Dr. Strange — AI TradeVision PRO

> Institutional AI Predictive Trading Terminal  
> Real-time · Low-Latency · Quantile Forecast Engine

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 · React 18 · TypeScript · TailwindCSS |
| Charts | TradingView lightweight-charts v4 |
| Backend | FastAPI · Python 3.11 · WebSockets |
| AI Engine | Quantile Regression (OFI + CVD + Z-score features) |
| Infra | Docker Compose |

## Quick Start

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### Docker (full stack)
```bash
cd docker
docker compose up --build
# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

## Architecture

```
Binance/OANDA WS → Feature Engine (OFI, CVD, Z-score)
                 → ONNX Inference (τ0.10, τ0.50, τ0.90)
                 → FastAPI WebSocket → React Dashboard
```

## Assets Supported
- BTCUSDT, ETHUSDT, SOLUSDT (Binance)
- EURUSD (OANDA)
- AAPL (NASDAQ)
- GOLD (COMEX)

## Forecast Output
- **Upper Bound** (τ0.90) — cyan dotted
- **Median Path** (τ0.50) — gold solid
- **Lower Bound** (τ0.10) — red dotted

## Dashboard Panels
1. AI Signal — LONG/SHORT, Entry/TP/SL zones, R:R, Confidence gauge
2. Market Intelligence / Liquidity tabs
3. AI Neural Engine — model ensemble breakdown
4. Self-Learning Status — reinforcement learning loop
5. Model Adaptation — walk-forward performance
6. Model Architecture — end-to-end flow diagram
7. Forecast Quality — accuracy metrics
8. Recent Learning Log + Next Retrain countdown

---
*Built with Gemini architecture (best-in-class) + OpenAI UI concepts + institutional ICT logic*
