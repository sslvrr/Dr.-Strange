'use client';
import { useEffect, useMemo, useState } from 'react';
import type { PredictionOutcome, PredictionStats } from '@/types/trading';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'GOLD', 'NAS100', 'AAPL'];

const SHORT: Record<string, string> = {
  BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL',
  EURUSD: 'EUR/USD', GOLD: 'GOLD', NAS100: 'NAS100', AAPL: 'AAPL',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface SymbolStat {
  tp1_wins: number;
  tp2_wins: number;
  losses: number;
  total: number;
  win_rate: number | null;
}

interface DbStats {
  overall: SymbolStat;
  by_symbol: Record<string, SymbolStat>;
}

interface EngineState {
  price: number;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  regime: string;
  tracker: { tp1_wins: number; tp2_wins: number; losses: number; total: number; win_rate: number; pending: boolean };
}

interface SignalRow {
  id: string;
  bar_ts: number;
  tf: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  atr: number | null;
  z_score: number | null;
  outcome: string | null;
  entry_price: number | null;
  close_price: number | null;
  pips: number | null;
  resolved_at: number | null;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtPrice(v: number): string {
  if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 10)    return v.toFixed(2);
  return v.toFixed(5);
}
// For FX pairs (entry < 10), pips are stored as raw price diff (e.g. 0.004 = 40 pips).
// Multiply by 10000 to display as integer pip count.
function fmtPips(pips: number, entryPrice: number | null): string {
  const fx = entryPrice != null && entryPrice > 0 && entryPrice < 10;
  const val = fx ? pips * 10000 : pips;
  const unit = fx ? 'p' : '';
  return (val > 0 ? '+' : '') + val.toFixed(fx ? 1 : 1) + unit;
}
function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }) + ' ET';
}
function outcomeColor(o: string | null) {
  if (!o)                                  return '#5E6673';
  if (o === 'TP1_WIN' || o === 'TP2_WIN') return '#02C076';
  if (o === 'LOSS')                        return '#FF433D';
  return '#5E6673';
}
function outcomeLabel(o: string | null) {
  if (!o)             return '⏳ Open';
  if (o === 'TP2_WIN') return '✓ TP2';
  if (o === 'TP1_WIN') return '✓ TP1';
  if (o === 'LOSS')    return '✗ SL';
  return '~ Exp';
}

// ── Stats Card ────────────────────────────────────────────────────────────────
function StatsCard({
  symbol, stats, engine, selected, onClick,
}: {
  symbol: string;
  stats: SymbolStat;
  engine?: EngineState;
  selected: boolean;
  onClick: () => void;
}) {
  const total   = stats.total;
  const wr      = stats.win_rate != null ? Math.round(stats.win_rate) : null;
  const wrColor = wr == null ? '#5E6673' : wr >= 60 ? '#02C076' : wr >= 45 ? '#FFB800' : '#FF433D';
  const dirColor = engine?.direction === 'LONG' ? '#02C076' : '#FF433D';
  const confColor = (engine?.confidence ?? 0) >= 70 ? '#02C076' : (engine?.confidence ?? 0) >= 50 ? '#FFB800' : '#5E6673';

  return (
    <div
      onClick={onClick}
      className="rounded-lg p-3 flex flex-col gap-2 cursor-pointer transition-all"
      style={{
        background:  selected ? '#0D2137' : '#12161A',
        border:      selected ? '1px solid #00E6FF88' : '1px solid #2B2F36',
        boxShadow:   selected ? '0 0 12px #00E6FF22' : 'none',
      }}
    >
      {/* Symbol + live direction badge */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#EAECEF]">{SHORT[symbol] ?? symbol}</span>
        {engine && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded"
            style={{ color: dirColor, background: `${dirColor}18`, border: `1px solid ${dirColor}44` }}>
            {engine.direction}
          </span>
        )}
      </div>

      {/* Live price */}
      {engine && (
        <div className="text-[10px] font-mono text-[#848E9C] -mt-1">
          {fmtPrice(engine.price)}
        </div>
      )}

      {/* Confidence bar */}
      {engine && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[8px]">
            <span className="text-[#5E6673]">Conf</span>
            <span style={{ color: confColor }} className="font-bold">{engine.confidence}%</span>
          </div>
          <div className="h-1 rounded-full bg-[#1E2329] overflow-hidden">
            <div style={{ width: `${engine.confidence}%`, background: confColor, transition: 'width 0.4s' }} className="h-full rounded-full" />
          </div>
        </div>
      )}

      {/* Regime */}
      {engine && (
        <div className="text-[8px] text-[#5E6673] truncate">{engine.regime}</div>
      )}

      {/* Historical WR */}
      <div className="border-t border-[#1E2329] pt-1.5 space-y-1">
        <div className="text-center">
          <div className="text-xl font-mono font-bold" style={{ color: wrColor }}>
            {wr != null ? `${wr}%` : '—'}
          </div>
          <div className="text-[8px] text-[#5E6673]">WR · {total} trades</div>
        </div>
        {total > 0 && (
          <>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-[#0D1117]">
              <div style={{ width: `${stats.tp1_wins / total * 100}%`, background: '#02C076' }} />
              <div style={{ width: `${stats.losses / total * 100}%`, background: '#FF433D' }} />
            </div>
            <div className="flex justify-between text-[8px]">
              <span className="text-[#02C076]">TP {stats.tp1_wins}</span>
              <span className="text-[#FF433D]">SL {stats.losses}</span>
            </div>
          </>
        )}
      </div>

      {engine?.tracker.pending && (
        <div className="text-[8px] text-center text-[#FFB800] bg-[#FFB80011] rounded py-0.5 border border-[#FFB80033]">
          ● TRACKING
        </div>
      )}
    </div>
  );
}

// ── Signal History Panel ──────────────────────────────────────────────────────
function SignalHistory({ symbol }: { symbol: string }) {
  const [rows,        setRows]        = useState<SignalRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showExpired, setShowExpired] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`http://localhost:8001/api/signals/${symbol}?limit=200`)
      .then(r => r.json())
      .then(d => { setRows(d.signals ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol]);

  if (loading) return (
    <div className="flex items-center justify-center h-24 text-[11px] text-[#5E6673]">Loading signal history…</div>
  );
  if (!rows.length) return (
    <div className="flex items-center justify-center h-24 text-[11px] text-[#5E6673]">No signals logged yet for {SHORT[symbol] ?? symbol}</div>
  );

  const isWin     = (o: string | null) => o === 'TP1_WIN' || o === 'TP2_WIN';
  const resolved  = rows.filter(r => r.outcome && r.outcome !== 'EXPIRED');
  const expired   = rows.filter(r => r.outcome === 'EXPIRED');
  const wins      = resolved.filter(r => isWin(r.outcome));
  const losses    = resolved.filter(r => r.outcome === 'LOSS');
  const wr        = resolved.length > 0 ? Math.round(wins.length / resolved.length * 100) : null;
  const wrColor   = wr == null ? '#848E9C' : wr >= 60 ? '#02C076' : wr >= 45 ? '#FFB800' : '#FF433D';

  const longResolved  = resolved.filter(r => r.direction === 'LONG');
  const shortResolved = resolved.filter(r => r.direction === 'SHORT');
  const longWR        = longResolved.length  > 0 ? Math.round(longResolved.filter(r => isWin(r.outcome)).length  / longResolved.length  * 100) : null;
  const shortWR       = shortResolved.length > 0 ? Math.round(shortResolved.filter(r => isWin(r.outcome)).length / shortResolved.length * 100) : null;

  // Avg pips on wins vs losses (for R:R sanity check)
  const avgWinPips  = wins.length  > 0 ? wins.reduce((s, r)   => s + (r.pips ?? 0), 0) / wins.length  : null;
  const avgLossPips = losses.length > 0 ? losses.reduce((s, r) => s + (r.pips ?? 0), 0) / losses.length : null;

  const displayRows = showExpired ? rows : resolved;

  return (
    <div className="flex flex-col gap-2">
      {/* Stats summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        <span className="text-[10px] font-bold text-[#EAECEF]">{SHORT[symbol] ?? symbol} — Signal History</span>

        {/* WR pill */}
        {wr != null && (
          <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded"
            style={{ color: wrColor, background: `${wrColor}18`, border: `1px solid ${wrColor}44` }}>
            {wr}% WR
          </span>
        )}

        {/* W / L count */}
        <span className="text-[9px] text-[#848E9C]">
          {wins.length}W · {losses.length}L · {resolved.length} trades
        </span>

        {/* Directional breakdown */}
        {longWR != null && (
          <span className="text-[9px] font-mono" style={{ color: longWR >= 55 ? '#02C076' : '#FFB800' }}>
            ↑ L {longWR}% <span className="text-[#5E6673]">({longResolved.length})</span>
          </span>
        )}
        {shortWR != null && (
          <span className="text-[9px] font-mono" style={{ color: shortWR >= 55 ? '#02C076' : '#FFB800' }}>
            ↓ S {shortWR}% <span className="text-[#5E6673]">({shortResolved.length})</span>
          </span>
        )}

        {/* Avg pips R:R */}
        {avgWinPips != null && avgLossPips != null && (
          <span className="text-[9px] text-[#848E9C]">
            avg{' '}
            <span className="text-[#02C076]">{fmtPips(avgWinPips, wins[0]?.entry_price ?? null)}</span>
            {' / '}
            <span className="text-[#FF433D]">{fmtPips(avgLossPips, losses[0]?.entry_price ?? null)}</span>
          </span>
        )}

        {/* Expired toggle */}
        <button
          onClick={() => setShowExpired(v => !v)}
          className="ml-auto text-[8px] px-2 py-0.5 rounded border transition-colors"
          style={{
            color:      showExpired ? '#FFB800' : '#5E6673',
            borderColor: showExpired ? '#FFB80044' : '#2B2F36',
            background: showExpired ? '#FFB80011' : 'transparent',
          }}>
          {showExpired ? `Hide ${expired.length} Expired` : `Show ${expired.length} Expired`}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
        <table className="w-full text-[9px]">
          <thead className="sticky top-0 bg-[#0B0E11]">
            <tr className="text-[#5E6673] border-b border-[#1E2329]">
              <th className="text-left py-1 pr-2 font-medium">Bar Time</th>
              <th className="text-left py-1 pr-2 font-medium">Dir</th>
              <th className="text-right py-1 pr-2 font-medium">Conf</th>
              <th className="text-right py-1 pr-2 font-medium">ATR</th>
              <th className="text-right py-1 pr-2 font-medium">Z-Score</th>
              <th className="text-right py-1 pr-2 font-medium">Entry</th>
              <th className="text-right py-1 pr-2 font-medium">Pips</th>
              <th className="text-right py-1 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, i) => {
              const isExpiredRow = r.outcome === 'EXPIRED';
              return (
                <tr key={`${r.id}-${i}`}
                  className="border-b border-[#1E232966] hover:bg-[#161B22]"
                  style={{ opacity: isExpiredRow ? 0.45 : 1 }}>
                  <td className="py-1 pr-2 font-mono text-[#5E6673]">{fmtTime(r.bar_ts)}</td>
                  <td className="py-1 pr-2">
                    <span className="font-bold" style={{ color: r.direction === 'LONG' ? '#02C076' : '#FF433D' }}>
                      {r.direction === 'LONG' ? '↑ L' : '↓ S'}
                    </span>
                  </td>
                  <td className="py-1 pr-2 font-mono text-right"
                    style={{ color: (r.confidence ?? 0) >= 75 ? '#EAECEF' : '#848E9C' }}>
                    {r.confidence}%
                  </td>
                  <td className="py-1 pr-2 font-mono text-right text-[#5E6673]">
                    {r.atr != null ? r.atr.toFixed(1) : '—'}
                  </td>
                  <td className="py-1 pr-2 font-mono text-right"
                    style={{ color: r.z_score != null && Math.abs(r.z_score) > 2 ? '#FFB800' : '#5E6673' }}>
                    {r.z_score != null ? r.z_score.toFixed(2) : '—'}
                  </td>
                  <td className="py-1 pr-2 font-mono text-right text-[#EAECEF]">
                    {!isExpiredRow && r.entry_price ? fmtPrice(r.entry_price) : '—'}
                  </td>
                  <td className="py-1 pr-2 font-mono text-right"
                    style={{ color: r.pips != null && r.pips !== 0 ? (r.pips > 0 ? '#02C076' : '#FF433D') : '#5E6673' }}>
                    {!isExpiredRow && r.pips != null && r.pips !== 0
                      ? fmtPips(r.pips, r.entry_price)
                      : '—'}
                  </td>
                  <td className="py-1 text-right">
                    <span className="font-bold px-1.5 py-0.5 rounded text-[8px]"
                      style={{ color: outcomeColor(r.outcome), background: `${outcomeColor(r.outcome)}15` }}>
                      {outcomeLabel(r.outcome)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Recent trades table (filter by symbol) ────────────────────────────────────
function TradesTable({ outcomes, filter }: { outcomes: PredictionOutcome[]; filter: string }) {
  const filtered = filter === 'ALL' ? outcomes : outcomes.filter(o => o.symbol === filter);

  if (filtered.length === 0) return (
    <div className="flex items-center justify-center h-24">
      <span className="text-[11px] text-[#5E6673]">
        No resolved predictions yet — signals are tracked live as price hits TP/SL
      </span>
    </div>
  );

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
                <td className="py-1 pr-2 font-semibold text-[#848E9C]">{SHORT[o.symbol] ?? o.symbol}</td>
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
  outcomes, activeSymbol, onClear, liveStats,
}: {
  outcomes: PredictionOutcome[];
  activeSymbol: string;
  onClear: () => void;
  liveStats?: PredictionStats;
}) {
  const [filter,       setFilter]       = useState<string>('ALL');
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [engines,      setEngines]      = useState<Record<string, EngineState>>({});
  const emptySymbolStat: SymbolStat     = { tp1_wins: 0, tp2_wins: 0, losses: 0, total: 0, win_rate: null };
  const [dbStats,      setDbStats]      = useState<DbStats>({
    overall:   { ...emptySymbolStat },
    by_symbol: {},
  });

  // Poll /api/engines every 30s for live card data
  useEffect(() => {
    const load = () =>
      fetch('http://localhost:8001/api/engines')
        .then(r => r.json())
        .then(d => setEngines(d.engines ?? {}))
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  // Poll /api/stats every 60s — single source of truth for all WR numbers
  useEffect(() => {
    const load = () =>
      fetch('http://localhost:8001/api/stats')
        .then(r => r.json())
        .then(d => setDbStats(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const overall   = dbStats.overall;
  const overallWR = overall.win_rate != null ? Math.round(overall.win_rate) : null;
  const wrColor   = overallWR == null ? '#848E9C' : overallWR >= 60 ? '#02C076' : overallWR >= 45 ? '#FFB800' : '#FF433D';

  const handleCardClick = (sym: string) => {
    setSelectedCard(prev => prev === sym ? null : sym);
    setFilter(sym); // also filter the recent trades table
  };

  return (
    <div className="flex flex-col h-full px-3 py-2 gap-3 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold tracking-wider text-[#EAECEF] uppercase">Prediction Tracker</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#2B2F36] text-[#848E9C]">
            {overall.total} resolved
          </span>
          {overallWR != null && (
            <span className="text-[11px] font-bold font-mono" style={{ color: wrColor }}>
              Overall WR: {overallWR}%
            </span>
          )}
          {Object.keys(engines).length > 0 && (
            <span className="text-[9px] text-[#00E6FF] bg-[#00E6FF11] border border-[#00E6FF33] px-2 py-0.5 rounded">
              ● {Object.keys(engines).length} engines live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[#5E6673]">Click a card to drill in · engines update every 30s</span>
          {outcomes.length > 0 && (
            <button onClick={onClear}
              className="text-[9px] text-[#FF433D] px-2 py-0.5 rounded border border-[#FF433D33] hover:bg-[#FF433D11] transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-7 gap-2 flex-shrink-0">
        {SYMBOLS.map(sym => (
          <StatsCard
            key={sym}
            symbol={sym}
            stats={dbStats.by_symbol[sym] ?? { tp1_wins: 0, tp2_wins: 0, losses: 0, total: 0, win_rate: null }}
            engine={engines[sym]}
            selected={selectedCard === sym}
            onClick={() => handleCardClick(sym)}
          />
        ))}
      </div>

      {/* Signal history drill-down (appears when a card is selected) */}
      {selectedCard && (
        <div className="flex-shrink-0 bg-[#0D1117] border border-[#00E6FF33] rounded-lg p-3">
          <SignalHistory symbol={selectedCard} />
        </div>
      )}

      {/* Recent resolved trades */}
      <div className="flex-1 min-h-0 bg-[#0D1117] border border-[#2B2F36] rounded-lg p-2 flex flex-col">
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <span className="text-[9px] font-bold tracking-widest text-[#848E9C] uppercase">Recent Resolved</span>
          <div className="flex items-center gap-1">
            <button onClick={() => { setFilter('ALL'); setSelectedCard(null); }}
              className="text-[8px] font-bold px-2 py-0.5 rounded transition-colors"
              style={{
                background: filter === 'ALL' ? '#F0B90B' : '#1E2329',
                color:      filter === 'ALL' ? '#0B0E11' : '#848E9C',
                border:     filter === 'ALL' ? '1px solid #F0B90B' : '1px solid #2B2F36',
              }}>
              ALL
            </button>
            {SYMBOLS.filter(s => outcomes.some(o => o.symbol === s)).map(sym => (
              <button key={sym}
                onClick={() => { setFilter(sym); setSelectedCard(sym); }}
                className="text-[8px] font-bold px-2 py-0.5 rounded transition-colors"
                style={{
                  background: filter === sym ? '#00E6FF22' : '#1E2329',
                  color:      filter === sym ? '#00E6FF'   : '#848E9C',
                  border:     filter === sym ? '1px solid #00E6FF55' : '1px solid #2B2F36',
                }}>
                {SHORT[sym] ?? sym}
              </button>
            ))}
          </div>
        </div>
        <TradesTable outcomes={outcomes} filter={filter} />
      </div>

    </div>
  );
}
