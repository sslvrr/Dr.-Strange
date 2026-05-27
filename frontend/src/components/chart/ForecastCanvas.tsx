'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { TradingChartHandle } from './TradingChart';

interface Props {
  chartRef: RefObject<TradingChartHandle | null>;
  separatorTime: number; // Unix timestamp of the current live bar
}

export default function ForecastCanvas({ chartRef, separatorTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const x = chartRef.current?.getNowX(separatorTime);
    if (x == null || x < 10) return;

    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.clientWidth;
    const h   = canvas.clientHeight;
    if (!w || !h) return;

    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Dashed vertical separator
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(132, 142, 156, 0.30)';
    ctx.lineWidth = 1;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h - 26);
    ctx.stroke();
    ctx.restore();

    // Labels
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(132, 142, 156, 0.50)';
    ctx.fillText('◀ HISTORICAL (PRINTED)', x - 8, 8);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0, 230, 255, 0.60)';
    ctx.fillText('AI FORECAST ▶', x + 8, 8);
  }, [chartRef, separatorTime]);

  // Redraw when separatorTime changes (new bar) and after a short delay for chart init
  useEffect(() => {
    draw();
    const t = setTimeout(draw, 400);
    return () => clearTimeout(t);
  }, [draw]);

  // Redraw on container resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 5 }}
    />
  );
}
