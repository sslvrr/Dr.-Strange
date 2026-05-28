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
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef     = useRef<ISeriesApi<'Histogram'> | null>(null);
  const upperAreaRef  = useRef<ISeriesApi<'Area'> | null>(null);
  const upperLineRef  = useRef<ISeriesApi<'Line'> | null>(null);
  const medianLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lowerLineRef  = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const lastSymbolRef = useRef<string>('');

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

    // Use real dimensions; fall back to sensible defaults if layout hasn't settled
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
        secondsVisible: false, rightOffset: 12,
        lockVisibleTimeRangeOnResize: true,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      width: w, height: h,
    });
    chartRef.current = chart;

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

    upperAreaRef.current = chart.addAreaSeries({
      topColor: '#00E6FF1A', bottomColor: '#00E6FF05',
      lineColor: 'transparent', lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    upperLineRef.current = chart.addLineSeries({
      color: '#00E6FF', lineWidth: 2, lineStyle: LineStyle.Dashed,
      title: '↑ 90%', priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerRadius: 4,
    });

    medianLineRef.current = chart.addLineSeries({
      color: '#FFB800', lineWidth: 3,
      title: '● 50%', priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBackgroundColor: '#FFB80099',
    });

    lowerLineRef.current = chart.addLineSeries({
      color: '#FF433D', lineWidth: 2, lineStyle: LineStyle.Dashed,
      title: '↓ 10%', priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerRadius: 4,
    });

    // Resize observer — keeps chart sized to its container
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
      upperAreaRef.current  = null;
      upperLineRef.current  = null;
      medianLineRef.current = null;
      lowerLineRef.current  = null;
      priceLinesRef.current = [];
      lastSymbolRef.current = '';
    };
  }, []); // runs once

  // ── History: set all candles when history arrives or symbol switches ─────
  useEffect(() => {
    if (!candleRef.current || history.length === 0) return;

    // Symbol switched — clear forecast series and price lines
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

    // Scroll to show the most recent bar with forecast space on the right
    chartRef.current?.timeScale().scrollToRealTime();
  }, [history, symbol]);

  // ── Tick: update the live (in-progress) candle only ─────────────────────
  useEffect(() => {
    if (!candleRef.current || !currentCandle) return;
    candleRef.current.update(currentCandle as any);
    volumeRef.current?.update({
      time:  currentCandle.time,
      value: currentCandle.volume ?? Math.abs(currentCandle.close - currentCandle.open) * 300,
      color: currentCandle.close >= currentCandle.open ? '#02C07633' : '#FF433D33',
    } as any);
  }, [currentCandle]);

  // ── Predictions: redraw forecast paths ───────────────────────────────────
  useEffect(() => {
    if (!upperLineRef.current || predictions.length === 0) return;
    const sorted = [...predictions].sort((a, b) => a.time - b.time);
    upperAreaRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.upper })) as any);
    upperLineRef.current.setData(sorted.map((p) => ({ time: p.time, value: p.upper })) as any);
    medianLineRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.median })) as any);
    lowerLineRef.current?.setData(sorted.map((p) => ({ time: p.time, value: p.lower })) as any);
  }, [predictions]);

  // ── AI Signal: Entry / SL / TP price lines ───────────────────────────────
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
