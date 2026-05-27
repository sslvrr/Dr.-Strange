'use client';
import { useState } from 'react';
import { TrendingUp, TrendingDown, Activity, Zap, BookOpen, AlertTriangle } from 'lucide-react';
import ConfidenceGauge from '@/components/ui/ConfidenceGauge';
import type { AISignal } from '@/types/trading';

const MOCK_SIGNAL: AISignal = {
  direction: 'LONG',
  confidence: 72,
  entryZone: [63800, 64300],
  takeProfit1: [65800, 66400],
  takeProfit2: [67200, 67800],
  stopLoss: [62400, 62800],
  riskReward: 2.61,
  validUntil: '25 May 2024 12:30 UTC',
};

interface LiquidityRow {
  label: string;
  value: string;
  type: 'positive' | 'negative' | 'neutral' | 'warning';
  icon: React.ReactNode;
}

const LIQUIDITY_DATA: LiquidityRow[] = [
  { label: 'Whale Activity',    value: 'High',      type: 'positive', icon: <Activity size={12} /> },
  { label: 'Order Book Bias',   value: 'Buy Side ↑', type: 'positive', icon: <TrendingUp size={12} /> },
  { label: 'Funding Rate',      value: '0.010%',    type: 'neutral',  icon: <Zap size={12} /> },
  { label: 'Options Gamma',     value: 'Positive ↑', type: 'positive', icon: <BookOpen size={12} /> },
  { label: 'Volatility (24h)',  value: 'High',      type: 'warning',  icon: <Activity size={12} /> },
  { label: 'Liquidation Risk',  value: 'Moderate',  type: 'warning',  icon: <AlertTriangle size={12} /> },
];

const MARKET_INTEL: LiquidityRow[] = [
  { label: 'Smart Money Flow',  value: 'Bullish',   type: 'positive', icon: <TrendingUp size={12} /> },
  { label: 'Dark Pool Vol',     value: 'Elevated',  type: 'warning',  icon: <Activity size={12} /> },
  { label: 'OI Change (24h)',   value: '+8.4%',     type: 'positive', icon: <TrendingUp size={12} /> },
  { label: 'CVD Trend',         value: 'Positive',  type: 'positive', icon: <BookOpen size={12} /> },
  { label: 'Fear & Greed',      value: '68 Greed',  type: 'positive', icon: <Zap size={12} /> },
  { label: 'Macro Sentiment',   value: 'Risk On',   type: 'positive', icon: <TrendingUp size={12} /> },
];

function colorByType(type: LiquidityRow['type']) {
  switch (type) {
    case 'positive': return '#02C076';
    case 'negative': return '#FF433D';
    case 'warning':  return '#FFB800';
    default:         return '#EAECEF';
  }
}

export default function AISignalPanel({ signal = MOCK_SIGNAL }: { signal?: AISignal }) {
  const [tab, setTab] = useState<'intel' | 'liquidity'>('intel');

  const isLong = signal.direction === 'LONG';
  const dirColor = isLong ? '#02C076' : '#FF433D';
  const dirLabel = isLong ? 'LONG SETUP' : 'SHORT SETUP';

  const fmt = (v: number) =>
    v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(5).replace(/\.?0+$/, '');

  const rows = [
    { label: 'Entry Zone',   value: `${fmt(signal.entryZone[0])} – ${fmt(signal.entryZone[1])}`,     color: '#02C076' },
    { label: 'Take Profit 1', value: `${fmt(signal.takeProfit1[0])} – ${fmt(signal.takeProfit1[1])}`, color: '#02C076' },
    { label: 'Take Profit 2', value: `${fmt(signal.takeProfit2[0])} – ${fmt(signal.takeProfit2[1])}`, color: '#02C076' },
    { label: 'Stop Loss',    value: `${fmt(signal.stopLoss[0])} – ${fmt(signal.stopLoss[1])}`,        color: '#FF433D' },
  ];

  const tabRows = tab === 'intel' ? MARKET_INTEL : LIQUIDITY_DATA;

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ gap: 0 }}>
      {/* AI Signal Header */}
      <div className="border-b border-[#2B2F36] px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold tracking-widest text-[#848E9C] uppercase">AI Signal</span>
        </div>
        <div className="flex items-center gap-3">
          {isLong ? (
            <span className="text-2xl">🐂</span>
          ) : (
            <span className="text-2xl">🐻</span>
          )}
          <span className="text-xl font-bold tracking-wide" style={{ color: dirColor }}>
            {dirLabel}
          </span>
        </div>
      </div>

      {/* Signal Rows */}
      <div className="px-4 py-3 border-b border-[#2B2F36] space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs text-[#848E9C]">{row.label}</span>
            <span className="text-xs font-mono font-semibold" style={{ color: row.color }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Risk/Reward + Confidence */}
      <div className="px-4 py-3 border-b border-[#2B2F36]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[#848E9C]">Risk / Reward</span>
          <span className="text-sm font-mono font-bold text-[#EAECEF]">1 : {signal.riskReward}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-[#848E9C] mb-1">Confidence</div>
            <div className="text-xs text-[#5E6673]">Valid Until: {signal.validUntil}</div>
          </div>
          <ConfidenceGauge value={signal.confidence} size={72} strokeWidth={7} />
        </div>
      </div>

      {/* Market Intelligence / Liquidity tabs */}
      <div className="flex border-b border-[#2B2F36]">
        {(['intel', 'liquidity'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[10px] font-semibold tracking-wider uppercase transition-colors ${
              tab === t
                ? 'text-[#EAECEF] border-b-2 border-[#00E6FF]'
                : 'text-[#848E9C] hover:text-[#EAECEF]'
            }`}
          >
            {t === 'intel' ? 'Market Intel' : 'Liquidity'}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 space-y-2 flex-1">
        {tabRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[#848E9C]">
              <span style={{ color: colorByType(row.type) }}>{row.icon}</span>
              <span className="text-xs">{row.label}</span>
            </div>
            <span className="text-xs font-semibold" style={{ color: colorByType(row.type) }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
