'use client';
import { useEffect, useRef, useState } from 'react';
import ConfidenceGauge from '@/components/ui/ConfidenceGauge';
import { useCountdown } from '@/hooks/useCountdown';
import type { MarketRegime } from '@/types/trading';

const LEARNING_LOG = [
  { time: '12:20', event: 'Model retrained on new data', value: '+2.3%',           type: 'pos' },
  { time: '11:45', event: 'Regime change detected',      value: 'Trend→Volatile',  type: 'warn' },
  { time: '11:32', event: 'Added 3 new features',        value: '+1.1%',           type: 'pos' },
  { time: '10:50', event: 'Reduced overfitting',         value: '+0.9%',           type: 'pos' },
  { time: '09:15', event: 'Reinforcement reward',        value: 'Optimized',       type: 'pos' },
];

function logColor(type: string) {
  return type === 'pos' ? '#02C076' : type === 'warn' ? '#FFB800' : '#FF433D';
}

/* ── Mini canvas sparkline ── */
function Spark({ data, color = '#02C076', height = 32 }: { data: number[]; color?: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || data.length < 2) return;
    const ctx = c.getContext('2d')!;
    const w = c.clientWidth || 150, h = height;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
    const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * w, y: h - 2 - ((v - mn) / rng) * (h - 4) }));
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `${color}44`); grad.addColorStop(1, `${color}00`);
    ctx.lineTo(pts[pts.length - 1].x, h); ctx.lineTo(pts[0].x, h);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }, [data, color, height]);
  return <canvas ref={ref} style={{ width: '100%', height }} />;
}

/* ── Panel wrapper ── */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#12161A] border border-[#2B2F36] rounded-lg p-3 flex flex-col gap-2 overflow-hidden">
      <div className="text-[10px] font-bold tracking-widest text-[#848E9C] uppercase flex-shrink-0">{title}</div>
      {children}
    </div>
  );
}

/* ── 1. AI Neural Engine ── */
function NeuralPanel({ confidence }: { confidence: number }) {
  return (
    <Panel title="AI Neural Engine">
      <div className="flex items-center gap-3">
        <div className="brain-glow w-10 h-10 rounded-full bg-gradient-to-br from-[#1a3a6c] to-[#0ea5e9] flex items-center justify-center flex-shrink-0"
          style={{ border: '1px solid #00E6FF33' }}>
          <span className="text-lg">🧠</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] text-[#5E6673] mb-1">Model Ensemble</div>
          {[['Transformer LSTM', 72, '#00E6FF'], ['Temporal Fusion', 18, '#A855F7'], ['XGBoost', 10, '#FFB800']].map(
            ([n, w, c]) => (
              <div key={n as string} className="flex items-center justify-between">
                <span className="text-[9px] text-[#848E9C] truncate">{n}</span>
                <span className="text-[9px] font-mono font-bold ml-1" style={{ color: c as string }}>{w}%</span>
              </div>
            )
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[#848E9C]">Overall Confidence</span>
        <ConfidenceGauge value={confidence} size={52} strokeWidth={5} />
      </div>
    </Panel>
  );
}

/* ── 2. Self-Learning Status ── */
function SelfLearningPanel() {
  const perfData = [62, 64, 61, 67, 70, 68, 74, 78, 76, 80];
  return (
    <Panel title="Self-Learning Status">
      <div className="space-y-1">
        {[
          ['Learning Mode', 'Reinforcement Learning', '#02C076'],
          ['Market Adaptation', 'ACTIVE ✦', '#00E6FF'],
          ['New Data Ingested', '12.4M rows', '#EAECEF'],
          ['Last Retrain', '2h 15m ago', '#EAECEF'],
          ['Performance ∆', '+14.7% (7d)', '#02C076'],
        ].map(([k, v, c]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-[9px] text-[#848E9C]">{k}</span>
            <span className="text-[9px] font-semibold" style={{ color: c }}>{v}</span>
          </div>
        ))}
      </div>
      <Spark data={perfData} color="#02C076" height={28} />
    </Panel>
  );
}

/* ── 3. Model Adaptation ── */
function AdaptationPanel({ regime }: { regime?: MarketRegime }) {
  const data = [40, 48, 52, 50, 58, 62, 60, 68, 72, 70, 76, 80];
  const regimeLabel = regime?.label ?? 'LOADING…';
  const regimeColor = regime?.label === 'BEARISH TREND' ? '#FF433D'
    : regime?.label === 'HIGH VOLATILITY' ? '#A855F7'
    : regime?.label === 'RANGING' ? '#FFB800'
    : '#02C076';
  const regimePct = regime?.confidence ?? 0;
  return (
    <Panel title="Model Adaptation">
      <div>
        <div className="text-[9px] text-[#848E9C] mb-1">Performance (Walk Forward)</div>
        <Spark data={data} color="#00E6FF" height={28} />
        <div className="flex justify-between text-[8px] text-[#5E6673] mt-0.5">
          {['May 18', 'May 20', 'May 22', 'May 24'].map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[9px] mb-0.5">
          <span className="text-[#848E9C]">Regime Adaptation</span>
          <span className="font-semibold" style={{ color: regimeColor }}>{regimeLabel}</span>
        </div>
        <div className="h-1 bg-[#0D1117] rounded-full">
          <div className="h-full rounded-full" style={{ width: `${regimePct}%`, background: regimeColor }} />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[9px] mb-0.5">
          <span className="text-[#848E9C]">Volatility Adaptation</span>
          <span className="font-semibold text-[#FFB800]">High Volatility</span>
        </div>
        <div className="h-1 bg-[#0D1117] rounded-full">
          <div className="h-full rounded-full" style={{ width: '71%', background: '#FFB800' }} />
        </div>
      </div>
    </Panel>
  );
}

/* ── 4. Model Architecture ── */
function ArchitecturePanel() {
  const nodes = [
    { label: 'Market Data', sub: 'OHLCV · Order Book · News' },
    { label: 'Feature Engineering', sub: 'OFI · CVD · Z-score' },
    { label: 'Ensemble Models', chips: ['LSTM', 'TFT', 'XGBoost', 'RL'] },
    { label: 'Prediction Engine', sub: 'Forecast + Probabilities' },
    { label: 'Risk Engine', sub: 'Position Sizing' },
    { label: '▶ Trade Signals', sub: null, highlight: true },
  ];
  return (
    <Panel title="Model Architecture">
      <div className="space-y-1">
        {nodes.map((n, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-full rounded px-2 py-1 text-center"
              style={{
                background: n.highlight ? '#02C07622' : '#1A2030',
                border: `1px solid ${n.highlight ? '#02C07655' : '#2B2F3666'}`,
              }}>
              <div className="text-[9px] font-semibold" style={{ color: n.highlight ? '#02C076' : '#EAECEF' }}>{n.label}</div>
              {n.sub && <div className="text-[8px] text-[#5E6673]">{n.sub}</div>}
              {n.chips && (
                <div className="flex gap-1 justify-center mt-0.5 flex-wrap">
                  {n.chips.map((c) => (
                    <span key={c} className="px-1 py-0.5 rounded text-[8px] font-mono text-[#00E6FF] bg-[#00E6FF11] border border-[#00E6FF33]">{c}</span>
                  ))}
                </div>
              )}
            </div>
            {i < nodes.length - 1 && <div className="w-px h-1.5 bg-[#2B2F36]" />}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ── 5. Forecast Quality ── */
function QualityPanel({ confidence }: { confidence: number }) {
  const metrics = [
    { k: 'Directional Accuracy', v: '68.4%', pct: 68, c: '#02C076' },
    { k: 'Forecast Efficiency',  v: '1.32',  pct: 66, c: '#00E6FF' },
    { k: 'Calibration Score',    v: '0.71',  pct: 71, c: '#A855F7' },
    { k: 'Sharpe (Strategy)',    v: '2.14',  pct: 85, c: '#FFB800' },
    { k: 'Max Drawdown',         v: '-8.6%', pct: 14, c: '#FF433D' },
  ];
  return (
    <Panel title="Forecast Quality">
      <div className="space-y-1.5">
        {metrics.map(({ k, v, pct, c }) => (
          <div key={k}>
            <div className="flex justify-between text-[9px] mb-0.5">
              <span className="text-[#848E9C]">{k}</span>
              <span className="font-mono font-bold" style={{ color: c }}>{v}</span>
            </div>
            <div className="h-0.5 bg-[#1A2030] rounded-full">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1">
        <div>
          <div className="text-[9px] text-[#848E9C]">Overall</div>
          <div className="text-xs font-bold text-[#02C076]">Good</div>
        </div>
        <ConfidenceGauge value={confidence} size={46} strokeWidth={5} color="#02C076" />
      </div>
    </Panel>
  );
}

/* ── 6. Learning Log + Retrain ── */
function LogPanel() {
  const { h, m, s } = useCountdown(4965);
  return (
    <Panel title="Recent Learning Log">
      <div className="space-y-1 flex-1">
        {LEARNING_LOG.map((l, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-[8px] font-mono text-[#5E6673] flex-shrink-0">{l.time}</span>
            <span className="text-[9px] text-[#848E9C] flex-1 truncate">{l.event}</span>
            <span className="text-[9px] font-semibold flex-shrink-0" style={{ color: logColor(l.type) }}>{l.value}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-[#2B2F36] pt-2">
        <div className="text-[9px] text-[#848E9C] mb-1 uppercase tracking-wider">Next Retrain</div>
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {[{ v: h, u: 'HRS' }, { v: m, u: 'MIN' }, { v: s, u: 'SEC' }].map(({ v, u }) => (
              <div key={u} className="text-center">
                <div className="text-sm font-mono font-bold text-[#EAECEF]">{v}</div>
                <div className="text-[7px] text-[#5E6673]">{u}</div>
              </div>
            ))}
          </div>
          <button className="px-2.5 py-1 rounded text-[9px] font-semibold text-white bg-[#2563EB] hover:bg-[#1d4ed8] transition-colors">
            Train Now
          </button>
        </div>
      </div>
    </Panel>
  );
}

/* ── Combined strip ── */
export default function BottomPanels({ confidence, regime }: { confidence?: number; regime?: MarketRegime }) {
  const conf = confidence ?? 72;
  return (
    <div className="grid grid-cols-6 gap-2 px-2 py-2" style={{ height: 196 }}>
      <NeuralPanel confidence={conf} />
      <SelfLearningPanel />
      <AdaptationPanel regime={regime} />
      <ArchitecturePanel />
      <QualityPanel confidence={conf} />
      <LogPanel />
    </div>
  );
}
