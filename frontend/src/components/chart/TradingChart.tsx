'use client';
import { useEffect, useRef } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineStyle,
  CrosshairMode,
  ColorType,
  PriceScaleMode,
} from 'lightweight-charts';
import type { OHLCV, QuantilePrediction } from '@/types/trading';

interface Props {
  history: OHLCV[];
  currentCandle: OHLCV | null;
  predictions: QuantilePrediction[];
  symbol: string;
}

export default function TradingChart({ history, currentCandle, predictions, symbol }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef     = useRef<ISeriesApi<'Histogram'> | null>(null);
  const upperAreaRef  = useRef<ISeriesApi<'Area'> | null>(null);
  const upperLineRef  = useRef<ISeriesApi<'Line'> | null>(null);
  const medianLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lowerLineRef  = useRef<ISeriesApi<'Line'> | null>(null);
  const initDoneRef   = useRef(false);
  const scrolledRef   = useRef(false);

  // Track last prediction timestamps to avoid unnecessary redraws
  const lastPredTimesRef = useRef<string>('');

  // ── Build chart once ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || initDoneRef.current) return;
    initDoneRef.current = true;
    scrolledRef.current = false;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0B0E11' },
        textColor: '#848E9C',
        fontSize: 10,
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
        borderColor: '#2B2F36',
        textColor: '#848E9C',
        // Lock to Normal mode — prevents scale jumps
        mode: PriceScaleMode.Normal,
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: '#2B2F36',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 24,
        lockVisibleTimeRangeOnResize: true,  // prevents horizontal jump on resize
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    chartRef.current = chart;

    // ── Candles (main pane) ───────────────────────────────────────────────
    candleRef.current = chart.addCandlestickSeries({
      upColor: '#02C076', downColor: '#FF433D',
      borderUpColor: '#02C076', borderDownColor: '#FF433D',
      wickUpColor: '#02C076', wickDownColor: '#FF433D',
      priceLineVisible: false,
    });

    // ── Volume (overlaid, small margin at bottom of same pane) ───────────
    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.88, bottom: 0 },
    });

    // ── Forecast: cyan area fill ──────────────────────────────────────────
    upperAreaRef.current = chart.addAreaSeries({
      topColor:    '#00E6FF1A',
      bottomColor: '#00E6FF05',
      lineColor:   'transparent',
      lineWidth:   1,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    });

    // ── Forecast: upper τ0.90 dashed cyan ────────────────────────────────
    upperLineRef.current = chart.addLineSeries({
      color: '#00E6FF', lineWidth: 2, lineStyle: LineStyle.Dashed,
      title: '↑ 90%',
      priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerRadius: 4,
    });

    // ── Forecast: median τ0.50 solid gold ────────────────────────────────
    medianLineRef.current = chart.addLineSeries({
      color: '#FFB800', lineWidth: 3, lineStyle: LineStyle.Solid,
      title: '● 50%',
      priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBackgroundColor: '#FFB80099',
    });

    // ── Forecast: lower τ0.10 dashed red ─────────────────────────────────
    lowerLineRef.current = chart.addLineSeries({
      color: '#FF433D', lineWidth: 2, lineStyle: LineStyle.Dashed,
      title: '↓ 10%',
      priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerRadius: 4,
    });

    // ── Stable resize: debounced, only on actual size change ─────────────
    let rafId = 0;
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!containerRef.current || !chartRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w === lastW && h === lastH) return; // no actual change
        lastW = w; lastH = h;
        chartRef.current.applyOptions({ width: w, height: h });
      });
    });
    ro.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.remove();
      initDoneRef.current   = false;
      scrolledRef.current   = false;
      lastPredTimesRef.current = '';
      candleRef.current     = null;
      volumeRef.current     = null;
      upperAreaRef.current  = null;
      upperLineRef.current  = null;
      medianLineRef.current = null;
      lowerLineRef.current  = null;
    };
  }, []);

  // ── History: load once per symbol ────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || history.length === 0) return;
    const sorted = [...history].sort((a, b) => a.time - b.time);

    candleRef.current.setData(sorted as any);

    volumeRef.current?.setData(
      sorted.map((c) => ({
        time: c.time,
        value: c.volume ?? Math.abs(c.close - c.open) * 300,
        color: c.close >= c.open ? '#02C07633' : '#FF433D33',
      })) as any
    );

    // Scroll once to right edge — only on first history load per symbol
    if (!scrolledRef.current) {
      chartRef.current?.timeScale().scrollToRealTime();
      scrolledRef.current = true;
    }
  }, [history, symbol]);

  // ── Live tick: update only current candle (no layout change) ─────────────
  useEffect(() => {
    if (!candleRef.current || !currentCandle) return;
    candleRef.current.update(currentCandle as any);
    volumeRef.current?.update({
      time: currentCandle.time,
      value: currentCandle.volume ?? Math.abs(currentCandle.close - currentCandle.open) * 300,
      color: currentCandle.close >= currentCandle.open ? '#02C07633' : '#FF433D33',
    } as any);
  }, [currentCandle]);

  // ── Predictions: only redraw when forecast timestamps change ─────────────
  // (every 60 ticks ≈ every 12 seconds, not every 200ms tick)
  useEffect(() => {
    if (!upperLineRef.current || predictions.length === 0) return;

    // Fingerprint by first + last timestamp — predictions shift only when a new bar opens
    const fp = `${predictions[0]?.time}-${predictions[predictions.length - 1]?.time}`;
    if (fp === lastPredTimesRef.current) return; // nothing changed
    lastPredTimesRef.current = fp;

    const sorted = [...predictions].sort((a, b) => a.time - b.time);
    upperAreaRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.upper })) as any);
    upperLineRef.current.setData(sorted.map((p) => ({ time: p.time, value: p.upper })) as any);
    medianLineRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.median })) as any);
    lowerLineRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.lower })) as any);
  }, [predictions]);

  return <div ref={containerRef} className="w-full h-full" />;
}
