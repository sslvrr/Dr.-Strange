'use client';
import { useMemo } from 'react';
import type { PredictionOutcome, PredictionStats } from '@/types/trading';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'GOLD', 'NAS100', 'AAPL'];

function fmtPrice(v: number): string {
  if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 10)    return v.toFixed(2);
  return v.toFixed(5);
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
}

function outcomeColor(o: string) {
  if (o === 'TP1_WIN' || o === 'TP2_WIN') return '#02C076';
  if (o === 'LOSS') return '#FF433D';
  return '#5E6673';
}

function outcomeLabel(o: string) {
  if (o === 'TP2_WIN') return '✓ TP2';
  if (o === 'TP1_WIN') return '✓ TP1';
  if (o === 'LOSS')    return '✗ SL';
  return '~ Expired';
}

// ── Per-symbol stats card ─────────────────────────────────────────────────────
function StatsCard({ symbol, stats, liveStats }: {
  symbol: string;
  stats: { tp1_wins: number; tp2_wins: number; losses: number; total: number };
  liveStats?: PredictionStats;
}) {
  const total  = stats.total;
  const wr     = total > 0 ? Math.round(stats.tp1_wins / total * 100) : null;
  const tp2r   = total > 0 ? Math.round(stats.tp2_wins / total * 100) : null;
  const wrColor = wr == null ? '#5E6673' : wr >= 60 ? '#02C076' : wr >= 45 ? '#FFB800' : '#FF433D';

  const shortName: Record<string, string> = {
    BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL',
    EURUSD: 'EURUSD', GOLD: 'GOLD', NAS100: 'NAS100', AAPL: 'AAPL',
  };

  return (
    <div className="bg-[#12161A] border border-[#2B2F36] rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#EAECEF]">{shortName[symbol] ?? symbol}</span>
        {liveStats?.pending && (
          <span className="text-[8px] px-1.5 py-0.5 rounded text-[#FFB800] bg-[#FFB80014] border border-[#FFB80033]">
            TRACKING
          </span>
        )}
      </div>

      {/* Win rate gauge */}
      <div className="text-center">
        <div className="text-2xl font-mono font-bold" style={{ color: wrColor }}>
          {wr != null ? `${wr}%` : '—'}
        </div>
        <div className="text-[8px] text-[#5E6673]">Win Rate (TP1)</div>
      </div>

      {/* Breakdown bars */}
      <div className="space-y-1">
        <div className="flex justify-between text-[8px] mb-0.5">
          <span className="text-[#02C076]">TP1 {stats.tp1_wins}</span>
          <span className="text-[#00E6FF]">TP2 {stats.tp2_wins}</span>
          <span className="text-[#FF433D]">SL {stats.losses}</span>
        </div>
        {total > 0 && (
          <div className="flex h-1.5 rounded-full overflow-hidden bg-[#0D1117] gap-px">
            <div style={{ width: `${stats.tp1_wins / total * 100}%`, background: '#02C076' }} />
            <div style={{ width: `${stats.losses / total * 100}%`, background: '#FF433D' }} />
          </div>
        )}
      </div>

      <div className="flex justify-between text-[8px] text-[#5E6673] border-t border-[#1E2329] pt-1">
        <span>{total} signals</span>
        {tp2r != null && <span className="text-[#00E6FF]">TP2: {tp2r}%</span>}
      </div>
    </div>
  );
}

// ── Recent trades table ───────────────────────────────────────────────────────
function TradesTable({ outcomes, filter }: { outcomes: PredictionOutcome[]; filter: string | 'ALL' }) {
  const filtered = filter === 'ALL' ? outcomes : outcomes.filter(o => o.symbol === filter);

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-[11px] text-[#5E6673]">
          No resolved predictions yet — signals are tracked live as price hits TP/SL
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1">
      <table className="w-full text-[9px]">
        <thead className="sticky top-0 bg-[#0B0E11]">
          <tr className="text-[#5E6673] border-b border-[#1E2329]">
            <th className="text-left py-1 pr-2 font-medium">Time</th>
            <th className="text-left py-1 pr-2 font-medium">Symbol</th>
            <th className="text-left py-1 pr-2 font-medium">Dir</th>
            <th className="text-right py-1 pr-2 font-medium">Entry</th>
            <th className="text-right py-1 pr-2 font-medium">Close</th>
            <th className="text-right py-1 pr-2 font-medium">Ticks</th>
            <th className="text-right py-1 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((o, i) => {
            const pnlPct = ((o.close_price - o.entry) / o.entry * 100) * (o.direction === 'LONG' ? 1 : -1);
            return (
              <tr key={i} className="border-b border-[#1E232966] hover:bg-[#161B22]">
                <td className="py-1 pr-2 font-mono text-[#5E6673]">{fmtTime(o.close_time)}</td>
                <td className="py-1 pr-2 font-semibold text-[#848E9C]">
                  {o.symbol === 'BTCUSDT' ? 'BTC' : o.symbol === 'ETHUSDT' ? 'ETH' : o.symbol === 'SOLUSDT' ? 'SOL' : o.symbol}
                </td>
                <td className="py-1 pr-2">
                  <span className="font-bold" style={{ color: o.direction === 'LONG' ? '#02C076' : '#FF433D' }}>
                    {o.direction === 'LONG' ? '↑' : '↓'}
                  </span>
                </td>
                <td className="py-1 pr-2 font-mono text-right text-[#EAECEF]">{fmtPrice(o.entry)}</td>
                <td className="py-1 pr-2 font-mono text-right" style={{ color: outcomeColor(o.outcome) }}>
                  {fmtPrice(o.close_price)}
                </td>
                <td className="py-1 pr-2 font-mono text-right text-[#5E6673]">{o.ticks}</td>
                <td className="py-1 text-right">
                  <span className="font-bold text-[9px] px-1.5 py-0.5 rounded"
                    style={{ color: outcomeColor(o.outcome), background: `${outcomeColor(o.outcome)}15` }}>
                    {outcomeLabel(o.outcome)}
                    {(o.outcome === 'TP1_WIN' || o.outcome === 'TP2_WIN') && (
                      <span className="ml-1 text-[#5E6673]">+{pnlPct.toFixed(2)}%</span>
                    )}
                    {o.outcome === 'LOSS' && (
                      <span className="ml-1 text-[#5E6673]">{pnlPct.toFixed(2)}%</span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function PredictionsView({
  outcomes,
  activeSymbol,
  onClear,
  liveStats,
}: {
  outcomes: PredictionOutcome[];
  activeSymbol: string;
  onClear: () => void;
  liveStats?: PredictionStats;
}) {
  // Compute per-symbol stats from stored outcomes
  const symbolStats = useMemo(() => {
    const map: Record<string, { tp1_wins: number; tp2_wins: number; losses: number; total: number }> = {};
    for (const sym of SYMBOLS) {
      map[sym] = { tp1_wins: 0, tp2_wins: 0, losses: 0, total: 0 };
    }
    for (const o of outcomes) {
      if (!map[o.symbol]) map[o.symbol] = { tp1_wins: 0, tp2_wins: 0, losses: 0, total: 0 };
      const s = map[o.symbol];
      if (o.outcome === 'TP1_WIN') { s.tp1_wins++; s.total++; }
      else if (o.outcome === 'TP2_WIN') { s.tp1_wins++; s.tp2_wins++; s.total++; }
      else if (o.outcome === 'LOSS') { s.losses++; s.total++; }
    }
    return map;
  }, [outcomes]);

  const totalSignals = outcomes.filter(o => o.outcome !== 'EXPIRED').length;
  const totalWins    = outcomes.filter(o => o.outcome === 'TP1_WIN' || o.outcome === 'TP2_WIN').length;
  const overallWR    = totalSignals > 0 ? Math.round(totalWins / totalSignals * 100) : null;
  const wrColor      = overallWR == null ? '#848E9C' : overallWR >= 60 ? '#02C076' : overallWR >= 45 ? '#FFB800' : '#FF433D';

  return (
    <div className="flex flex-col h-full px-3 py-2 gap-3">

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold tracking-wider text-[#EAECEF] uppercase">Prediction Tracker</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#2B2F36] text-[#848E9C]">
            {totalSignals} resolved
          </span>
          {overallWR != null && (
            <span className="text-[11px] font-bold font-mono" style={{ color: wrColor }}>
              Overall WR: {overallWR}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[#5E6673]">Tracking live — TP1/TP2/SL hits recorded automatically</span>
          {outcomes.length > 0 && (
            <button onClick={onClear}
              className="text-[9px] text-[#FF433D] hover:text-[#FF433D] px-2 py-0.5 rounded border border-[#FF433D33] hover:bg-[#FF433D11] transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Per-symbol stats grid */}
      <div className="grid grid-cols-7 gap-2 flex-shrink-0">
        {SYMBOLS.map((sym) => (
          <StatsCard
            key={sym}
            symbol={sym}
            stats={symbolStats[sym] ?? { tp1_wins: 0, tp2_wins: 0, losses: 0, total: 0 }}
            liveStats={sym === activeSymbol ? liveStats : undefined}
          />
        ))}
      </div>

      {/* Recent trades */}
      <div className="flex-1 min-h-0 bg-[#0D1117] border border-[#2B2F36] rounded-lg p-2 flex flex-col">
        <div className="text-[9px] font-bold tracking-widest text-[#848E9C] uppercase mb-2 flex-shrink-0">
          Recent Signals
        </div>
        <TradesTable outcomes={outcomes} filter="ALL" />
      </div>
    </div>
  );
}
