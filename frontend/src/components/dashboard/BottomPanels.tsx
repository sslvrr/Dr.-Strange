'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { AISignal, MarketIntel, MarketRegime, OHLCV, RawIntel, ScanEntry, ScanResult } from '@/types/trading';

// ── Shared utilities ────────────────────────────────────────────────────────

function fmtPrice(v: number): string {
  if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 10)    return v.toFixed(2);
  return v.toFixed(5);
}

function fmtCvd(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '+';
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000)     return `${s}${(a / 1_000).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
}

function regimeColor(label?: string): string {
  if (!label) return '#848E9C';
  if (label.includes('BULL'))  return '#02C076';
  if (label.includes('BEAR'))  return '#FF433D';
  if (label.includes('VOLAT')) return '#A855F7';
  return '#FFB800';
}

/* ── Mini canvas sparkline ── */
function Spark({ data, color = '#02C076', height = 28 }: { data: number[]; color?: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || data.length < 2) return;
    const ctx = c.getContext('2d')!;
    const w = c.clientWidth || 150;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = height * dpr;
    c.style.width = `${w}px`; c.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = '#0B0E11';
    ctx.fillRect(0, 0, w, height);
    const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
    const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * w, y: height - 2 - ((v - mn) / rng) * (height - 4) }));
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `${color}44`); grad.addColorStop(1, `${color}00`);
    ctx.lineTo(pts[pts.length - 1].x, height); ctx.lineTo(pts[0].x, height);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }, [data, color, height]);
  return <canvas ref={ref} style={{ width: '100%', height }} />;
}

/* ── Panel wrapper ── */
function Panel({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="bg-[#12161A] border border-[#2B2F36] rounded-lg p-3 flex flex-col gap-2 overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="text-[10px] font-bold tracking-widest text-[#848E9C] uppercase">{title}</div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// ── Panel 1: Market Scanner ──────────────────────────────────────────────────
function ScannerPanel({ selectedSymbol }: { selectedSymbol: string }) {
  const [rows, setRows]     = useState<ScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [age, setAge]       = useState(0); // seconds since last fetch
  const fetchedAt           = useRef(0);

  const doFetch = useCallback(async () => {
    try {
      const base = `http://${window.location.hostname}:8001`;
      const res = await fetch(`${base}/api/scan`, { cache: 'no-store' });
      if (!res.ok) return;
      const json: ScanResult = await res.json();
      setRows(json.symbols);
      fetchedAt.current = Date.now();
    } catch { /* backend unavailable — keep stale data */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    doFetch();
    const fetchId = setInterval(doFetch, 30_000);
    const ageId   = setInterval(() => setAge(Math.floor((Date.now() - fetchedAt.current) / 1000)), 1_000);
    return () => { clearInterval(fetchId); clearInterval(ageId); };
  }, [doFetch]);

  return (
    <Panel title="Market Scanner" badge={
      <span className="text-[8px] font-mono text-[#5E6673]">{age > 0 ? `${age}s ago` : 'live'}</span>
    }>
      <div className="space-y-0.5 flex-1">
        {loading && rows.length === 0 ? (
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <span className="text-[9px] text-[#2B2F36]">———</span>
              <span className="text-[9px] text-[#2B2F36]">——</span>
            </div>
          ))
        ) : rows.map((r) => {
          const isActive = r.symbol === selectedSymbol;
          const rsi = r.rsi14;
          const rsiColor = rsi == null ? '#5E6673'
            : rsi >= 70 ? '#02C076'
            : rsi <= 30 ? '#FF433D'
            : '#848E9C';
          const dirColor = r.direction === 'LONG' ? '#02C076' : r.direction === 'SHORT' ? '#FF433D' : '#5E6673';
          return (
            <div key={r.symbol} className="flex items-center gap-1 py-0.5"
              style={{ borderLeft: isActive ? '2px solid #00E6FF' : '2px solid transparent', paddingLeft: isActive ? 4 : 6 }}>
              <span className="text-[9px] font-mono font-semibold w-14 flex-shrink-0"
                style={{ color: isActive ? '#EAECEF' : '#848E9C' }}>
                {r.symbol === 'BTCUSDT' ? 'BTC' : r.symbol === 'ETHUSDT' ? 'ETH' : r.symbol === 'SOLUSDT' ? 'SOL' : r.symbol}
              </span>
              {r.error ? (
                <span className="text-[8px] text-[#5E6673]">unavailable</span>
              ) : (
                <>
                  <span className="text-[9px] font-mono text-[#5E6673] flex-1 text-right">
                    RSI <span style={{ color: rsiColor }}>{rsi != null ? rsi.toFixed(1) : '—'}</span>
                  </span>
                  <span className="text-[8px] font-bold ml-1 px-1 rounded flex-shrink-0"
                    style={{ color: dirColor, background: `${dirColor}15` }}>
                    {r.direction ?? '—'}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ── Panel 2: Key Levels ──────────────────────────────────────────────────────
function KeyLevelsPanel({ raw }: { raw?: RawIntel }) {
  function atrDist(price: number | null | undefined, current: number, atr: number): string {
    if (price == null || atr === 0) return '—';
    const d = (price - current) / atr;
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}x`;
  }

  function aboveBelow(price: number | null | undefined, current: number) {
    if (price == null) return null;
    return price > current
      ? <span className="text-[7px] text-[#02C076] ml-0.5">▲</span>
      : <span className="text-[7px] text-[#FF433D] ml-0.5">▼</span>;
  }

  const levels = raw ? [
    { label: 'Swing High',  price: raw.swing_high,  color: '#02C076' },
    { label: 'Swing Low',   price: raw.swing_low,   color: '#FF433D' },
    { label: 'FVG Mid',     price: raw.fvg_mid,     color: '#00E6FF' },
    { label: 'Liquidity',   price: raw.liq_level,   color: '#A855F7' },
  ] : [];

  return (
    <Panel title="Key Levels">
      {!raw ? (
        <div className="flex items-center justify-center flex-1">
          <span className="text-[9px] text-[#5E6673]">Awaiting data…</span>
        </div>
      ) : (
        <div className="space-y-2 flex-1">
          {levels.map(({ label, price, color }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[9px] text-[#848E9C]">{label}</span>
              <div className="flex items-center gap-1 text-right">
                <span className="text-[8px] font-mono text-[#5E6673]">
                  {atrDist(price, raw.current_price, raw.atr)} ATR
                </span>
                <span className="text-[9px] font-mono font-bold" style={{ color }}>
                  {price != null ? fmtPrice(price) : '—'}
                </span>
                {aboveBelow(price, raw.current_price)}
              </div>
            </div>
          ))}
          <div className="border-t border-[#1E2329] pt-1 flex items-center justify-between">
            <span className="text-[8px] text-[#5E6673]">ATR</span>
            <span className="text-[9px] font-mono text-[#848E9C]">
              {fmtPrice(raw.atr)} <span className="text-[#5E6673]">({raw.atr_pct.toFixed(2)}%)</span>
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Panel 3: Order Flow ──────────────────────────────────────────────────────
function OrderFlowPanel({ raw, isOanda }: { raw?: RawIntel; isOanda: boolean }) {
  const [cvdHistory, setCvdHistory] = useState<number[]>([]);

  useEffect(() => {
    if (raw?.cvd != null) {
      setCvdHistory(prev => [...prev.slice(-19), raw.cvd]);
    }
  }, [raw?.cvd]);

  const cvdPos = (raw?.cvd ?? 0) >= 0;
  const ofiClamped = Math.max(-1, Math.min(1, raw?.ofi ?? 0));
  const ofiPct = ((ofiClamped + 1) / 2) * 100;
  const ofiColor = ofiClamped >= 0 ? '#02C076' : '#FF433D';

  return (
    <Panel title="Order Flow">
      {!raw ? (
        <div className="flex items-center justify-center flex-1">
          <span className="text-[9px] text-[#5E6673]">Awaiting data…</span>
        </div>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-[#848E9C]">CVD{isOanda ? ' (est.)' : ''}</span>
              <span className="text-[9px] font-mono font-bold" style={{ color: cvdPos ? '#02C076' : '#FF433D' }}>
                {fmtCvd(raw.cvd)}
              </span>
            </div>
            <Spark data={cvdHistory.length > 1 ? cvdHistory : [0, 0]} color={cvdPos ? '#02C076' : '#FF433D'} height={26} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] text-[#848E9C]">OFI</span>
              <span className="text-[9px] font-mono" style={{ color: ofiColor }}>
                {ofiClamped >= 0 ? '+' : ''}{ofiClamped.toFixed(3)}
              </span>
            </div>
            <div className="relative h-1.5 bg-[#0D1117] rounded-full">
              <div className="absolute top-0 bottom-0 w-px bg-[#2B2F36]" style={{ left: '50%' }} />
              <div className="absolute top-0 bottom-0 rounded-full" style={{
                left:  ofiClamped >= 0 ? '50%' : `${ofiPct}%`,
                width: `${Math.abs(ofiClamped) / 2 * 100}%`,
                background: ofiColor,
              }} />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#1E2329] pt-1">
            <span className="text-[8px] text-[#5E6673]">Z-Score</span>
            <span className="text-[9px] font-mono" style={{
              color: Math.abs(raw.zscore) > 1.5 ? '#FF433D' : Math.abs(raw.zscore) > 0.5 ? '#FFB800' : '#02C076',
            }}>
              {raw.zscore >= 0 ? '+' : ''}{raw.zscore.toFixed(2)}σ
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Panel 4: Session Clock ───────────────────────────────────────────────────
const SESSIONS = [
  { name: 'London', color: '#2563EB', openH: 7,  openM: 0,  closeH: 16, closeM: 0  },
  { name: 'New York', color: '#02C076', openH: 13, openM: 30, closeH: 21, closeM: 0  },
  { name: 'Asia',   color: '#FFB800', openH: 22, openM: 0,  closeH: 7,  closeM: 0  },
] as const;

const KILL_ZONES = [
  { name: 'London Open KZ', startH: 7,  startM: 0,  endH: 9,  endM: 0  },
  { name: 'NY Open KZ',     startH: 13, startM: 30, endH: 15, endM: 0  },
  { name: 'London Close',   startH: 15, startM: 0,  endH: 16, endM: 0  },
] as const;

function toMins(h: number, m: number) { return h * 60 + m; }

function isOpen(nowMins: number, openH: number, openM: number, closeH: number, closeM: number): boolean {
  const o = toMins(openH, openM), c = toMins(closeH, closeM);
  if (o < c) return nowMins >= o && nowMins < c;
  return nowMins >= o || nowMins < c; // wraps midnight (Asia)
}

function minsUntil(nowMins: number, targetH: number, targetM: number): number {
  const t = toMins(targetH, targetM);
  const diff = t - nowMins;
  return diff > 0 ? diff : diff + 1440;
}

function fmtCountdown(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SessionPanel() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();

  const activeKZ = KILL_ZONES.find(kz =>
    isOpen(nowMins, kz.startH, kz.startM, kz.endH, kz.endM)
  );

  const offHours = !SESSIONS.some(s => isOpen(nowMins, s.openH, s.openM, s.closeH, s.closeM));

  return (
    <Panel title="Session Clock">
      <div className="grid grid-cols-2 gap-1.5 flex-1">
        {SESSIONS.map((s) => {
          const open = isOpen(nowMins, s.openH, s.openM, s.closeH, s.closeM);
          const closeMins = open
            ? minsUntil(nowMins, s.closeH, s.closeM)
            : minsUntil(nowMins, s.openH, s.openM);
          return (
            <div key={s.name} className="rounded px-2 py-1.5"
              style={{
                background: open ? `${s.color}14` : '#0D1117',
                border: `1px solid ${open ? s.color + '55' : '#2B2F36'}`,
              }}>
              <div className="text-[8px] font-semibold mb-0.5" style={{ color: open ? s.color : '#5E6673' }}>
                {s.name}
              </div>
              <div className="text-[8px] font-mono" style={{ color: open ? '#EAECEF' : '#5E6673' }}>
                {open ? '● OPEN' : '○ CLOSED'}
              </div>
              <div className="text-[7px] text-[#5E6673] mt-0.5">
                {open ? `closes in ${fmtCountdown(closeMins)}` : `opens in ${fmtCountdown(closeMins)}`}
              </div>
            </div>
          );
        })}
        <div className="rounded px-2 py-1.5"
          style={{ background: offHours ? '#FFB80014' : '#0D1117', border: `1px solid ${offHours ? '#FFB80055' : '#2B2F36'}` }}>
          <div className="text-[8px] font-semibold mb-0.5" style={{ color: offHours ? '#FFB800' : '#5E6673' }}>Off-Hours</div>
          <div className="text-[8px] font-mono" style={{ color: offHours ? '#EAECEF' : '#5E6673' }}>
            {offHours ? '● ACTIVE' : '○ —'}
          </div>
          <div className="text-[7px] text-[#5E6673] mt-0.5">
            {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })} UTC
          </div>
        </div>
      </div>
      {activeKZ && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded"
          style={{ background: '#FFB80014', border: '1px solid #FFB80044' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-[#FFB800] animate-pulse flex-shrink-0" />
          <span className="text-[8px] font-bold text-[#FFB800]">{activeKZ.name}</span>
        </div>
      )}
    </Panel>
  );
}

// ── Panel 5: Signal History ──────────────────────────────────────────────────
interface LogEntry { time: string; direction: 'LONG' | 'SHORT'; price: number; confidence: number; }

function SignalHistoryPanel({
  signal, currentCandle, selectedSymbol,
  onLogChange,
}: {
  signal?: AISignal;
  currentCandle?: OHLCV | null;
  selectedSymbol: string;
  onLogChange?: (log: LogEntry[]) => void;
}) {
  const [log, setLog]           = useState<LogEntry[]>([]);
  const lastDirRef              = useRef<string | null>(null);
  const lastSymRef              = useRef<string>('');

  useEffect(() => {
    if (selectedSymbol !== lastSymRef.current) {
      lastSymRef.current = selectedSymbol;
      lastDirRef.current = null;
      setLog([]);
      onLogChange?.([]);
    }
  }, [selectedSymbol, onLogChange]);

  useEffect(() => {
    if (!signal || !currentCandle) return;
    if (signal.direction !== lastDirRef.current && signal.direction !== 'NEUTRAL') {
      lastDirRef.current = signal.direction;
      const dir = signal.direction as 'LONG' | 'SHORT';
      const t = new Date();
      const ts = `${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')} UTC`;
      setLog(prev => {
        const next = [{ time: ts, direction: dir, price: currentCandle.close, confidence: signal.confidence }, ...prev].slice(0, 8);
        onLogChange?.(next);
        return next;
      });
    }
  }, [signal?.direction, currentCandle?.close, signal?.confidence, onLogChange]);

  return (
    <Panel title="Signal History">
      {log.length === 0 ? (
        <div className="flex items-center justify-center flex-1">
          <span className="text-[9px] text-[#5E6673]">Watching for signal changes…</span>
        </div>
      ) : (
        <div className="space-y-1 flex-1">
          {log.map((e, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[8px] font-mono text-[#5E6673] flex-shrink-0 w-12">{e.time}</span>
              <span className="text-[8px] font-bold px-1 rounded flex-shrink-0"
                style={{ color: e.direction === 'LONG' ? '#02C076' : '#FF433D', background: e.direction === 'LONG' ? '#02C07615' : '#FF433D15' }}>
                {e.direction === 'LONG' ? '↑ LONG' : '↓ SHORT'}
              </span>
              <span className="text-[8px] font-mono text-[#848E9C] flex-1 text-right">{fmtPrice(e.price)}</span>
              <span className="text-[8px] text-[#5E6673] flex-shrink-0">{e.confidence}%</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Panel 6: Volatility Context ──────────────────────────────────────────────
function VolatilityPanel({ raw, signalLog }: { raw?: RawIntel; signalLog: LogEntry[] }) {
  const zscore = raw?.zscore ?? 0;
  const zColor = Math.abs(zscore) > 1.5 ? '#FF433D' : Math.abs(zscore) > 0.5 ? '#FFB800' : '#02C076';
  const zClamped = Math.max(-3, Math.min(3, zscore));
  const zPct = ((zClamped + 3) / 6) * 100;

  const barRangeRatio = raw ? raw.bar_range / Math.max(raw.atr, 1e-10) : 0;
  const barColor = barRangeRatio > 2 ? '#FF433D' : barRangeRatio > 1 ? '#FFB800' : '#02C076';

  const regConf = raw?.regime_confidence ?? 0;
  const regColor = regimeColor(raw?.regime_label);

  const barsSince = signalLog.length > 0 ? '< 1 session' : '—';

  return (
    <Panel title="Volatility Context">
      {!raw ? (
        <div className="flex items-center justify-center flex-1">
          <span className="text-[9px] text-[#5E6673]">Awaiting data…</span>
        </div>
      ) : (
        <div className="space-y-2 flex-1">
          {/* Z-Score */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] text-[#848E9C]">Z-Score</span>
              <span className="text-[9px] font-mono font-bold" style={{ color: zColor }}>
                {zscore >= 0 ? '+' : ''}{zscore.toFixed(2)}σ
              </span>
            </div>
            <div className="relative h-1.5 bg-[#0D1117] rounded-full">
              <div className="absolute top-0 bottom-0 w-px bg-[#2B2F36]" style={{ left: '50%' }} />
              <div className="absolute top-0 bottom-0 rounded-full transition-all" style={{
                left:  zClamped >= 0 ? '50%' : `${zPct}%`,
                width: `${Math.abs(zClamped) / 6 * 100}%`,
                background: zColor,
              }} />
            </div>
          </div>

          {/* Regime confidence */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] text-[#848E9C]">Regime Conf</span>
              <span className="text-[9px] font-mono font-bold" style={{ color: regColor }}>{regConf}%</span>
            </div>
            <div className="h-1.5 bg-[#0D1117] rounded-full">
              <div className="h-full rounded-full transition-all" style={{ width: `${regConf}%`, background: regColor }} />
            </div>
          </div>

          {/* Bar range vs ATR */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] text-[#848E9C]">Bar Range</span>
              <span className="text-[9px] font-mono font-bold" style={{ color: barColor }}>
                {barRangeRatio.toFixed(2)}x ATR
              </span>
            </div>
            <div className="h-1.5 bg-[#0D1117] rounded-full">
              <div className="h-full rounded-full transition-all" style={{
                width: `${Math.min(barRangeRatio / 3 * 100, 100)}%`, background: barColor,
              }} />
            </div>
          </div>

          {/* Signal changes */}
          <div className="flex items-center justify-between border-t border-[#1E2329] pt-1">
            <span className="text-[8px] text-[#5E6673]">Direction changes</span>
            <span className="text-[9px] font-mono text-[#848E9C]">
              {signalLog.length > 0 ? `${signalLog.length} this session` : '—'}
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Combined strip ───────────────────────────────────────────────────────────
export default function BottomPanels({
  signal,
  regime,
  intel,
  currentCandle,
  selectedSymbol,
}: {
  signal?: AISignal;
  regime?: MarketRegime;
  intel?: MarketIntel;
  currentCandle?: OHLCV | null;
  selectedSymbol: string;
}) {
  const [signalLog, setSignalLog] = useState<LogEntry[]>([]);
  const raw = intel?.raw;
  const isOanda = selectedSymbol === 'EURUSD' || selectedSymbol === 'GOLD';

  return (
    <div className="grid grid-cols-6 gap-2 px-2 py-2" style={{ height: 196 }}>
      <ScannerPanel selectedSymbol={selectedSymbol} />
      <KeyLevelsPanel raw={raw} />
      <OrderFlowPanel raw={raw} isOanda={isOanda} />
      <SessionPanel />
      <SignalHistoryPanel
        signal={signal}
        currentCandle={currentCandle}
        selectedSymbol={selectedSymbol}
        onLogChange={setSignalLog}
      />
      <VolatilityPanel raw={raw} signalLog={signalLog} />
    </div>
  );
}
