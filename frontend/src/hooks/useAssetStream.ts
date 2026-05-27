'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { OHLCV, QuantilePrediction, AISignal, MarketRegime, WsMessage } from '@/types/trading';

export type ConnectionStatus = 'connecting' | 'live' | 'disconnected' | 'error';

interface StreamState {
  history: OHLCV[];
  currentCandle: OHLCV | null;
  predictions: QuantilePrediction[];
  signal: AISignal | null;
  regime: MarketRegime | null;
  status: ConnectionStatus;
}


export function useAssetStream(symbol: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const [state, setState] = useState<StreamState>({
    history: [],
    currentCandle: null,
    predictions: [],
    signal: null,
    regime: null,
    status: 'connecting',
  });

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState((s) => ({ ...s, status: 'connecting', history: [], currentCandle: null, predictions: [] }));

    // Derive host from page location so Docker browser works via host.docker.internal
    const wsBase = `ws://${window.location.hostname}:8001`;
    const ws = new WebSocket(`${wsBase}/ws/stream/${symbol}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, status: 'live' }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const payload: WsMessage = JSON.parse(event.data);

        if (payload.type === 'HISTORY' && payload.data) {
          setState((s) => ({ ...s, history: payload.data! }));
        } else if (payload.type === 'TICK') {
          setState((s) => ({
            ...s,
            currentCandle: payload.candle ?? s.currentCandle,
            predictions: payload.predictions ?? s.predictions,
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
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, status: 'disconnected' }));
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, status: 'error' }));
    };
  }, [symbol]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}
