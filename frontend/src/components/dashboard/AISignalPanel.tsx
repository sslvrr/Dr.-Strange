'use client';
import { useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Zap, BookOpen, AlertTriangle } from 'lucide-react';
import ConfidenceGauge from '@/components/ui/ConfidenceGauge';
import type { AISignal, MarketIntel, IntelRow } from '@/types/trading';

const MOCK_SIGNAL: AISignal = {
  direction: 'LONG',
  confidence: 72,
  entryZone: [63800, 64300],
  takeProfit1: [65800, 66400],
  takeProfit2: [67200, 67800],
  stopLoss: [62400, 62800],
  riskReward: 2.61,
  validUntil: 'Awaiting signal…',
};

const ICON_MAP: Record<string, React.ReactNode> = {
  'CVD Trend':       <TrendingUp size={12} />,
  'Order Flow Bias': <Activity size={12} />,
  'EMA Position':    <BookOpen size={12} />,
  'Market Regime':   <Zap size={12} />,
  'Volatility':      <AlertTriangle size={12} />,
  'Funding Rate':    <Zap size={12} />,
  'OFI Direction':   <TrendingDown size={12} />,
  'CVD Momentum':    <TrendingUp size={12} />,
  'Vol Z-Score':     <Activity size={12} />,
  'EMA9 vs EMA21':   <BookOpen size={12} />,
  'ATR':             <Activity size={12} />,
};

function rowIcon(label: string, type: IntelRow['type']) {
  const icon = ICON_MAP[label] ?? <Activity size={12} />;
  return icon;
}

function colorByType(type: IntelRow['type']) {
  switch (type) {
    case 'positive': return '#02C076';
    case 'negative': return '#FF433D';
    case 'warning':  return '#FFB800';
    default:         return '#848E9C';
  }
}

interface Props {
  signal?: AISignal;
  intel?: MarketIntel;
}

export default function AISignalPanel({ signal = MOCK_SIGNAL, intel }: Props) {
  const [tab, setTab] = useState<'intel' | 'liquidity'>('intel');

  const isLong   = signal.direction === 'LONG';
  const dirColor = isLong ? '#02C076' : '#FF433D';
  const dirLabel = isLong ? 'LONG SETUP' : 'SHORT SETUP';

  const fmt = (v: number) => {
    if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 10)   return v.toFixed(2);
    return v.toFixed(5);  // forex / crypto sub-10 values
  };

  const rows = [
    { label: 'Entry Zone',    value: `${fmt(signal.entryZone[0])} – ${fmt(signal.entryZone[1])}`,     color: '#EAECEF' },
    { label: 'Take Profit 1', value: `${fmt(signal.takeProfit1[0])} – ${fmt(signal.takeProfit1[1])}`, color: '#02C076' },
    { label: 'Take Profit 2', value: `${fmt(signal.takeProfit2[0])} – ${fmt(signal.takeProfit2[1])}`, color: '#02C076' },
    { label: 'Stop Loss',     value: `${fmt(signal.stopLoss[0])} – ${fmt(signal.stopLoss[1])}`,        color: '#FF433D' },
  ];

  const tabRows: IntelRow[] = tab === 'intel'
    ? (intel?.market_intel ?? [])
    : (intel?.liquidity ?? []);

  const isLive = tabRows.length > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ gap: 0 }}>

      {/* AI Signal Header */}
      <div className="border-b border-[#2B2F36] px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold tracking-widest text-[#848E9C] uppercase">AI Signal</span>
          {isLive && (
            <span className="text-[9px] px-1.5 py-0.5 rounded text-[#02C076]"
              style={{ background: '#02C07611', border: '1px solid #02C07433' }}>
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{isLong ? '🐂' : '🐻'}</span>
          <span className="text-xl font-bold tracking-wide" style={{ color: dirColor }}>
            {dirLabel}
          </span>
        </div>
      </div>

      {/* Signal Rows */}
      <div className="px-4 py-3 border-b border-[#2B2F36] space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#848E9C] flex-shrink-0">{row.label}</span>
            <span className="text-xs font-mono font-semibold text-right" style={{ color: row.color }}>
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
          <div className="flex-1 min-w-0 pr-2">
            <div className="text-xs text-[#848E9C] mb-1">Confidence</div>
            <div className="text-[9px] text-[#5E6673] leading-tight">{signal.validUntil}</div>
          </div>
          <ConfidenceGauge value={signal.confidence} size={68} strokeWidth={7} />
        </div>
      </div>

      {/* Tabs */}
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

      {/* Intel Rows */}
      <div className="px-4 py-3 space-y-2.5 flex-1">
        {isLive ? (
          tabRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5" style={{ color: colorByType(row.type) }}>
                {rowIcon(row.label, row.type)}
                <span className="text-xs text-[#848E9C]">{row.label}</span>
              </div>
              <span className="text-xs font-semibold" style={{ color: colorByType(row.type) }}>
                {row.value}
              </span>
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-20">
            <span className="text-[10px] text-[#5E6673]">Awaiting live data…</span>
          </div>
        )}
      </div>
    </div>
  );
}
