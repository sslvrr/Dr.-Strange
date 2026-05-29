export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface QuantilePrediction {
  time: number;
  upper: number;
  median: number;
  lower: number;
}

export interface AssetTicker {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
}

export interface AISignal {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  entryZone: [number, number];
  takeProfit1: [number, number];
  takeProfit2: [number, number];
  stopLoss: [number, number];
  riskReward: number;
  validUntil: string;
}

export interface MarketRegime {
  label: 'BULLISH TREND' | 'BEARISH TREND' | 'RANGING' | 'HIGH VOLATILITY';
  confidence: number;
}

export interface ModelWeight {
  name: string;
  weight: number;
}

export interface LearningLog {
  time: string;
  event: string;
  value: string;
  type: 'positive' | 'negative' | 'neutral';
}

export interface Metrics {
  tick_count: number;
  elapsed_secs: number;
  rows_ingested: number;
  perf_pct: number;
  directional_accuracy: number;
  last_retrain_secs_ago: number;
}

export interface IntelRow {
  label: string;
  value: string;
  type: 'positive' | 'negative' | 'neutral' | 'warning';
}

export interface MarketIntel {
  market_intel: IntelRow[];
  liquidity: IntelRow[];
}

export interface WsMessage {
  type: 'HISTORY' | 'TICK' | 'SIGNAL' | 'REGIME' | 'INTEL';
  data?: OHLCV[];
  candle?: OHLCV;
  predictions?: QuantilePrediction[];
  signal?: AISignal;
  regime?: MarketRegime;
  metrics?: Metrics;
  intel?: MarketIntel;
}

export interface AssetConfig {
  symbol: string;
  exchange: string;
  timeframe: string;
  basePrice: number;
}

export const ASSET_CONFIGS: Record<string, AssetConfig> = {
  BTCUSDT: { symbol: 'BTCUSDT', exchange: 'BINANCE', timeframe: '1h', basePrice: 64892 },
  ETHUSDT: { symbol: 'ETHUSDT', exchange: 'BINANCE', timeframe: '1h', basePrice: 3512 },
  SOLUSDT: { symbol: 'SOLUSDT', exchange: 'BINANCE', timeframe: '1h', basePrice: 152.61 },
  EURUSD:  { symbol: 'EURUSD',  exchange: 'OANDA',   timeframe: '1h', basePrice: 1.08245 },
  AAPL:    { symbol: 'AAPL',    exchange: 'NASDAQ',  timeframe: '1h', basePrice: 193.42 },
  GOLD:    { symbol: 'GOLD',    exchange: 'COMEX',   timeframe: '1h', basePrice: 2357.80 },
};

export const TICKER_DATA: AssetTicker[] = [
  { symbol: 'BTCUSDT', price: 64892.1, change: 883.4, changePct: 1.35 },
  { symbol: 'ETHUSDT', price: 3512.6,  change: 75.8,  changePct: 2.21 },
  { symbol: 'SOLUSDT', price: 152.61,  change: 5.12,  changePct: 3.52 },
  { symbol: 'EURUSD',  price: 1.08245, change: 0.0012, changePct: 0.11 },
  { symbol: 'AAPL',    price: 193.42,  change: -0.45, changePct: -0.23 },
  { symbol: 'GOLD',    price: 2357.80, change: 8.92,  changePct: 0.38 },
];
