'use client';
import { useEffect, useRef } from 'react';
import type { OHLCV } from '@/types/trading';

// ── RSI ────────────────────────────────────────────────────────────────────
function computeRSI(data: OHLCV[], period = 14) {
  const out: { t: number; v: number }[] = [];
  for (let i = period; i < data.length; i++) {
    let g = 0, l = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = data[j].close - data[j - 1].close;
      d > 0 ? (g += d) : (l -= d);
    }
    out.push({ t: data[i].time, v: +(100 - 100 / (1 + g / (l || 1e-10))).toFixed(2) });
  }
  return out;
}

// ── MACD ───────────────────────────────────────────────────────────────────
function ema(vals: number[], p: number) {
  const k = 2 / (p + 1), r = new Array(vals.length).fill(0);
  r[0] = vals[0];
  for (let i = 1; i < vals.length; i++) r[i] = vals[i] * k + r[i - 1] * (1 - k);
  return r;
}
function computeMACD(data: OHLCV[]) {
  const c = data.map((d) => d.close);
  const mv = ema(c, 12).map((v, i) => v - ema(c, 26)[i]);
  const sv = ema(mv, 9);
  const macd: { t: number; m: number; s: number; h: number }[] = [];
  for (let i = 33; i < data.length; i++) {
    macd.push({ t: data[i].time, m: +mv[i].toFixed(2), s: +sv[i].toFixed(2), h: +(mv[i] - sv[i]).toFixed(2) });
  }
  return macd;
}

// ── Canvas painter ─────────────────────────────────────────────────────────
function drawLine(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  color: string, width = 1.5
) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawHRule(ctx: CanvasRenderingContext2D, y: number, color: string, w: number) {
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(0, y); ctx.lineTo(w, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── RSI Panel ──────────────────────────────────────────────────────────────
interface PanelProps { history: OHLCV[]; currentCandle: OHLCV | null }

export function RSIPanel({ history, currentCandle }: PanelProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const data = currentCandle
      ? [...history.filter(h => h.time < currentCandle.time), currentCandle]
      : history;
    if (data.length < 20) return;

    const sorted = [...data].sort((a, b) => a.time - b.time);
    const rsi    = computeRSI(sorted, 14);
    if (rsi.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width  = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0B0E11';
    ctx.fillRect(0, 0, W, H);

    const pad = { l: 4, r: 44, t: 4, b: 4 };
    const cw  = W - pad.l - pad.r;
    const ch  = H - pad.t - pad.b;

    // Overbought / Oversold lines
    const yOf = (v: number) => pad.t + ch - ((v - 0) / 100) * ch;
    drawHRule(ctx, yOf(70), '#FF433D55', W);
    drawHRule(ctx, yOf(50), '#474D5766', W);
    drawHRule(ctx, yOf(30), '#02C07655', W);

    // RSI line
    const pts = rsi.slice(-100).map((r, i, arr) => ({
      x: pad.l + (i / Math.max(arr.length - 1, 1)) * cw,
      y: yOf(r.v),
    }));
    drawLine(ctx, pts, '#A855F7', 1.5);

    // Current value label
    const last = rsi[rsi.length - 1].v;
    ctx.fillStyle = '#A855F7';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(last.toFixed(2), W - pad.r + 4, yOf(last) + 3);

    // Level labels
    ctx.fillStyle = '#474D57';
    ctx.font = '9px JetBrains Mono, monospace';
    [[70, '#FF433D99'], [50, '#474D5799'], [30, '#02C07699']].forEach(([v, c]) => {
      ctx.fillStyle = c as string;
      ctx.fillText(String(v), W - pad.r + 4, yOf(v as number) + 3);
    });
  }, [history, currentCandle]);

  return (
    <div className="flex items-center border-t border-[#1E2329]" style={{ height: 64 }}>
      <div className="flex-shrink-0 px-2 text-[9px] font-mono text-[#848E9C]" style={{ width: 72 }}>
        RSI 14
      </div>
      <canvas ref={ref} className="flex-1" style={{ height: 64 }} />
    </div>
  );
}

// ── MACD Panel ─────────────────────────────────────────────────────────────
export function MACDPanel({ history, currentCandle }: PanelProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const data = currentCandle
      ? [...history.filter(h => h.time < currentCandle.time), currentCandle]
      : history;
    if (data.length < 40) return;

    const sorted = [...data].sort((a, b) => a.time - b.time);
    const macd   = computeMACD(sorted);
    if (macd.length < 2) return;
    const recent = macd.slice(-100);

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width  = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#0B0E11';
    ctx.fillRect(0, 0, W, H);

    const pad = { l: 4, r: 44, t: 4, b: 4 };
    const cw  = W - pad.l - pad.r;
    const ch  = H - pad.t - pad.b;

    const allVals = recent.flatMap((d) => [d.m, d.s, d.h]);
    const mn = Math.min(...allVals), mx = Math.max(...allVals);
    const rng = mx - mn || 1;
    const yOf = (v: number) => pad.t + ch - ((v - mn) / rng) * ch;

    // Zero line
    drawHRule(ctx, yOf(0), '#474D5766', W);

    // Histogram bars
    const bw = Math.max(1, cw / recent.length - 1);
    recent.forEach((d, i) => {
      const x = pad.l + (i / recent.length) * cw;
      const y0 = yOf(0), y1 = yOf(d.h);
      ctx.fillStyle = d.h >= 0 ? '#02C07666' : '#FF433D66';
      ctx.fillRect(x, Math.min(y0, y1), bw, Math.abs(y0 - y1) || 1);
    });

    // MACD line
    drawLine(ctx, recent.map((d, i) => ({
      x: pad.l + (i / Math.max(recent.length - 1, 1)) * cw, y: yOf(d.m),
    })), '#00E6FF', 1.5);

    // Signal line
    drawLine(ctx, recent.map((d, i) => ({
      x: pad.l + (i / Math.max(recent.length - 1, 1)) * cw, y: yOf(d.s),
    })), '#FFB800', 1.2);

    // Value labels
    const last = recent[recent.length - 1];
    ctx.font = '9px JetBrains Mono, monospace';
    [
      [last.m, '#00E6FF', 'MACD'],
      [last.s, '#FFB800', 'Sig'],
    ].forEach(([v, c, label]) => {
      ctx.fillStyle = c as string;
      ctx.fillText(`${label} ${(v as number).toFixed(2)}`, W - pad.r + 4, yOf(v as number) + 3);
    });
  }, [history, currentCandle]);

  return (
    <div className="flex items-center border-t border-[#1E2329]" style={{ height: 64 }}>
      <div className="flex-shrink-0 px-2 text-[9px] font-mono text-[#848E9C]" style={{ width: 72 }}>
        MACD 12,26
      </div>
      <canvas ref={ref} className="flex-1" style={{ height: 64 }} />
    </div>
  );
}
