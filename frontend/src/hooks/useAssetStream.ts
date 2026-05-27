'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { OHLCV, QuantilePrediction, AISignal, MarketRegime, Metrics, WsMessage } from '@/types/trading';

export type ConnectionStatus = 'connecting' | 'live' | 'disconnected' | 'error';

interface StreamState {
  history: OHLCV[];
  currentCandle: OHLCV | null;
  predictions: QuantilePrediction[];
  signal: AISignal | null;
  regime: MarketRegime | null;
  metrics: Metrics | null;
  status: ConnectionStatus;
}

export function useAssetStream(symbol: string) {
  const wsRef          = useRef<WebSocket | null>(null);
  const reconnectRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef     = useRef(false);
  // Each new connection gets a unique ID. onclose/onmessage handlers capture
  // their own ID and bail out if it no longer matches — prevents the React
  // Strict-Mode race where the old socket's onclose fires after the new mount
  // has already set mountedRef back to true, scheduling a spurious reconnect.
  const connIdRef      = useRef(0);

  const [state, setState] = useState<StreamState>({
    history: [],
    currentCandle: null,
    predictions: [],
    signal: null,
    regime: null,
    metrics: null,
    status: 'connecting',
  });

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Tear down any existing socket cleanly
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent old onclose from firing
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }

    const id = ++connIdRef.current; // unique stamp for this connection
    setState((s) => ({ ...s, status: 'connecting', history: [], currentCandle: null, predictions: [] }));

    const wsBase = `ws://${window.location.hostname}:8001`;
    const ws = new WebSocket(`${wsBase}/ws/stream/${symbol}`);
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
          setState((s) => ({ ...s, history: payload.data! }));
        } else if (payload.type === 'TICK') {
          setState((s) => ({
            ...s,
            currentCandle: payload.candle ?? s.currentCandle,
            predictions: payload.predictions ?? s.predictions,
            metrics: payload.metrics ?? s.metrics,
          }));
        } else if (payload.type === 'SIGNAL' && payload.signal) {
          setState((s) => ({ ...s, signal: payload.signal! }));
        } else if (payload.type === 'REGIME' && payload.regime) {
          setState((s) => ({ ...s, regime: payload.regime! }));
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      // Stale close: this socket was superseded by a newer connection — ignore.
      if (id !== connIdRef.current || !mountedRef.current) return;
      setState((s) => ({ ...s, status: 'disconnected' }));
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      if (id !== connIdRef.current || !mountedRef.current) return;
      setState((s) => ({ ...s, status: 'error' }));
    };
  }, [symbol]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      // Null the onclose BEFORE closing so the stale-close guard isn't needed
      // here — we're intentionally tearing down, not reconnecting.
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

  return state;
}
