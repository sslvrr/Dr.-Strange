'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { OHLCV, QuantilePrediction, AISignal, MarketRegime, Metrics, MarketIntel, PredictionOutcome, WsMessage } from '@/types/trading';

export type ConnectionStatus = 'connecting' | 'live' | 'disconnected' | 'error';

const STORAGE_KEY = 'ds_predictions_v1';
const MAX_STORED  = 200;

function loadOutcomes(): PredictionOutcome[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveOutcomes(outcomes: PredictionOutcome[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(outcomes.slice(-MAX_STORED)));
  } catch {}
}

interface StreamState {
  history: OHLCV[];
  currentCandle: OHLCV | null;
  predictions: QuantilePrediction[];
  signal: AISignal | null;
  regime: MarketRegime | null;
  metrics: Metrics | null;
  intel: MarketIntel | null;
  status: ConnectionStatus;
  simulated: boolean;
}

// Outcomes are stored separately so they persist across symbol switches
let _globalOutcomes: PredictionOutcome[] = [];

export function useAssetStream(symbol: string, timeframe: string = '1h') {
  const wsRef        = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(false);
  const connIdRef    = useRef(0);

  const [state, setState] = useState<StreamState>({
    history: [], currentCandle: null, predictions: [],
    signal: null, regime: null, metrics: null, intel: null,
    status: 'connecting', simulated: false,
  });

  const [outcomes, setOutcomes] = useState<PredictionOutcome[]>(() => {
    // Load from localStorage on first render (client only)
    if (typeof window !== 'undefined') {
      _globalOutcomes = loadOutcomes();
      return _globalOutcomes;
    }
    return [];
  });

  const addOutcome = useCallback((o: PredictionOutcome) => {
    _globalOutcomes = [o, ..._globalOutcomes].slice(0, MAX_STORED);
    saveOutcomes(_globalOutcomes);
    setOutcomes([..._globalOutcomes]);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }

    const id = ++connIdRef.current;
    setState((s) => ({ ...s, status: 'connecting' }));

    const wsBase = `ws://${window.location.hostname}:8001`;
    const ws = new WebSocket(`${wsBase}/ws/stream/${symbol}?tf=${timeframe}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (id !== connIdRef.current || !mountedRef.current) return;
      setState((s) => ({ ...s, status: 'live' }));
    };

    ws.onmessage = (event) => {
      if (id !== connIdRef.current || !mountedRef.current) return;
      try {
        const payload: WsMessage = JSON.parse(event.data);
        if (payload.type === 'HISTORY' && payload.data) {
          setState((s) => ({ ...s, history: payload.data!, currentCandle: null, predictions: [], simulated: !!(payload as any).simulated }));
        } else if (payload.type === 'TICK') {
          if (payload.outcome) addOutcome(payload.outcome);
          setState((s) => ({
            ...s,
            currentCandle: payload.candle ?? s.currentCandle,
            predictions:   payload.predictions ?? s.predictions,
            metrics:       payload.metrics ?? s.metrics,
          }));
        } else if (payload.type === 'SIGNAL' && payload.signal) {
          setState((s) => ({ ...s, signal: payload.signal! }));
        } else if (payload.type === 'REGIME' && payload.regime) {
          setState((s) => ({ ...s, regime: payload.regime! }));
        } else if (payload.type === 'INTEL' && payload.intel) {
          setState((s) => ({ ...s, intel: payload.intel! }));
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (id !== connIdRef.current || !mountedRef.current) return;
      setState((s) => ({ ...s, status: 'disconnected' }));
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      if (id !== connIdRef.current || !mountedRef.current) return;
      setState((s) => ({ ...s, status: 'error' }));
    };
  }, [symbol, timeframe, addOutcome]);

  // Clear stale chart data when symbol or timeframe changes (keep outcomes — they're global)
  const prevKeyRef = useRef(`${symbol}:${timeframe}`);
  useEffect(() => {
    const key = `${symbol}:${timeframe}`;
    if (key !== prevKeyRef.current) {
      prevKeyRef.current = key;
      setState((s) => ({
        ...s,
        history: [], currentCandle: null, predictions: [],
        signal: null, regime: null, intel: null, simulated: false,
      }));
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };
  }, [connect]);

  return { ...state, outcomes };
}
