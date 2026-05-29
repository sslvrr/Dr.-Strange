'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  createChart, IChartApi, ISeriesApi,
  LineStyle, CrosshairMode, ColorType, PriceScaleMode,
} from 'lightweight-charts';
import type { OHLCV, QuantilePrediction, AISignal } from '@/types/trading';

export interface TradingChartHandle {
  getNowX: (timestamp: number) => number | null;
}

interface Props {
  history: OHLCV[];
  currentCandle: OHLCV | null;
  predictions: QuantilePrediction[];
  signal?: AISignal;
  symbol: string;
}

const TradingChart = forwardRef<TradingChartHandle, Props>(function TradingChart(
  { history, currentCandle, predictions, signal, symbol }, ref
) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<IChartApi | null>(null);
  const candleRef       = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef       = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ghostRef        = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const upperAreaRef    = useRef<ISeriesApi<'Area'> | null>(null);
  const upperLineRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const medianLineRef   = useRef<ISeriesApi<'Line'> | null>(null);
  const lowerLineRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef   = useRef<any[]>([]);
  const lastSymbolRef   = useRef<string>('');

  useImperativeHandle(ref, () => ({
    getNowX: (timestamp: number) => {
      if (!chartRef.current) return null;
      const x = chartRef.current.timeScale().timeToCoordinate(timestamp as any);
      return x ?? null;
    },
  }));

  // ── Build chart once on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const w = containerRef.current.clientWidth  || 800;
    const h = containerRef.current.clientHeight || 500;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0B0E11' },
        textColor: '#848E9C', fontSize: 10,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: '#1E2329' },
        horzLines: { color: '#1E2329' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#474D57AA', labelBackgroundColor: '#2B2F36' },
        horzLine: { color: '#474D57AA', labelBackgroundColor: '#2B2F36' },
      },
      rightPriceScale: {
        borderColor: '#2B2F36', textColor: '#848E9C',
        mode: PriceScaleMode.Normal,
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: '#2B2F36', timeVisible: true,
        secondsVisible: false, rightOffset: 14,
        lockVisibleTimeRangeOnResize: true,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      width: w, height: h,
    });
    chartRef.current = chart;

    // Real candles — drawn first (bottom layer)
    candleRef.current = chart.addCandlestickSeries({
      upColor: '#02C076', downColor: '#FF433D',
      borderUpColor: '#02C076', borderDownColor: '#FF433D',
      wickUpColor: '#02C076', wickDownColor: '#FF433D',
      priceLineVisible: false,
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } });

    // Forecast area band (behind lines)
    upperAreaRef.current = chart.addAreaSeries({
      topColor: '#00E6FF0D', bottomColor: '#00E6FF05',
      lineColor: 'transparent', lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    upperLineRef.current = chart.addLineSeries({
      color: '#00E6FF', lineWidth: 2, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerRadius: 4, crosshairMarkerVisible: true,
    });

    medianLineRef.current = chart.addLineSeries({
      color: '#FFB800', lineWidth: 3,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerRadius: 5,
      crosshairMarkerBackgroundColor: '#FFB80099',
    });

    lowerLineRef.current = chart.addLineSeries({
      color: '#FF433D', lineWidth: 2, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerRadius: 4, crosshairMarkerVisible: true,
    });

    // Ghost candles — drawn on top of forecast lines, semi-transparent
    // Bullish ghost: teal body · Bearish ghost: purple body
    ghostRef.current = chart.addCandlestickSeries({
      upColor:        '#00E6FF55',
      downColor:      '#A855F755',
      borderUpColor:  '#00E6FFEE',
      borderDownColor:'#A855F7EE',
      wickUpColor:    '#00E6FFCC',
      wickDownColor:  '#A855F7CC',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Resize observer
    let rafId = 0;
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!containerRef.current || !chartRef.current) return;
        const nw = containerRef.current.clientWidth;
        const nh = containerRef.current.clientHeight;
        if (nw === lastW && nh === lastH) return;
        lastW = nw; lastH = nh;
        chartRef.current.applyOptions({ width: nw, height: nh });
      });
    });
    ro.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.remove();
      chartRef.current      = null;
      candleRef.current     = null;
      volumeRef.current     = null;
      ghostRef.current      = null;
      upperAreaRef.current  = null;
      upperLineRef.current  = null;
      medianLineRef.current = null;
      lowerLineRef.current  = null;
      priceLinesRef.current = [];
      lastSymbolRef.current = '';
    };
  }, []);

  // ── History ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || history.length === 0) return;

    if (symbol !== lastSymbolRef.current) {
      lastSymbolRef.current = symbol;
      priceLinesRef.current.forEach(pl => {
        try { candleRef.current?.removePriceLine(pl); } catch {}
      });
      priceLinesRef.current = [];
      upperAreaRef.current?.setData([]);
      upperLineRef.current?.setData([]);
      medianLineRef.current?.setData([]);
      lowerLineRef.current?.setData([]);
      ghostRef.current?.setData([]);
    }

    const sorted = [...history].sort((a, b) => a.time - b.time);
    candleRef.current.setData(sorted as any);
    volumeRef.current?.setData(
      sorted.map((c) => ({
        time:  c.time,
        value: c.volume ?? Math.abs(c.close - c.open) * 300,
        color: c.close >= c.open ? '#02C07633' : '#FF433D33',
      })) as any
    );
    chartRef.current?.timeScale().scrollToRealTime();
  }, [history, symbol]);

  // ── Tick: update the live in-progress candle ─────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !currentCandle) return;
    candleRef.current.update(currentCandle as any);
    volumeRef.current?.update({
      time:  currentCandle.time,
      value: currentCandle.volume ?? Math.abs(currentCandle.close - currentCandle.open) * 300,
      color: currentCandle.close >= currentCandle.open ? '#02C07633' : '#FF433D33',
    } as any);
  }, [currentCandle]);

  // ── Predictions: forecast lines + ghost candles ───────────────────────────
  useEffect(() => {
    if (!upperLineRef.current || predictions.length === 0) return;

    const sorted = [...predictions].sort((a, b) => a.time - b.time);

    // Forecast lines + area
    upperAreaRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.upper })) as any);
    upperLineRef.current.setData(sorted.map((p) => ({ time: p.time, value: p.upper })) as any);
    medianLineRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.median })) as any);
    lowerLineRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.lower })) as any);

    // Ghost candles — open at previous median, close at this median
    // high = upper quantile, low = lower quantile
    if (!ghostRef.current) return;
    const lastRealClose = currentCandle?.close ?? history[history.length - 1]?.close ?? sorted[0].median;
    const ghostBars = sorted.map((p, i) => {
      const open  = i === 0 ? lastRealClose : sorted[i - 1].median;
      const close = p.median;
      return {
        time:  p.time,
        open,
        high:  p.upper,
        low:   p.lower,
        close,
      };
    });
    ghostRef.current.setData(ghostBars as any);
  }, [predictions, currentCandle, history]);

  // ── AI Signal: price lines ────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !signal) return;
    priceLinesRef.current.forEach(pl => {
      try { candleRef.current?.removePriceLine(pl); } catch {}
    });
    priceLinesRef.current = [];

    const add = (price: number, color: string, title: string) => {
      if (!candleRef.current) return;
      priceLinesRef.current.push(
        candleRef.current.createPriceLine({
          price, color, lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title,
        })
      );
    };

    const { entryZone, takeProfit1, takeProfit2, stopLoss } = signal;
    add((entryZone[0]   + entryZone[1])   / 2, '#02C07688', 'Entry');
    add((takeProfit1[0] + takeProfit1[1]) / 2, '#00E6FF88', 'TP1');
    add((takeProfit2[0] + takeProfit2[1]) / 2, '#A855F788', 'TP2');
    add((stopLoss[0]    + stopLoss[1])    / 2, '#FF433D88', 'SL');
  }, [signal]);

  return <div ref={containerRef} className="w-full h-full" />;
});

export default TradingChart;
