'use client';
import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import ForecastCanvas from '@/components/chart/ForecastCanvas';
import TradingChart from '@/components/chart/TradingChart';
import type { TradingChartHandle } from '@/components/chart/TradingChart';
import type { OHLCV, QuantilePrediction, AssetConfig, MarketRegime, AISignal } from '@/types/trading';
import { RSIPanel, MACDPanel } from '@/components/chart/IndicatorPanels';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', 'D', 'W'];

interface Props {
  config: AssetConfig;
  history: OHLCV[];
  currentCandle: OHLCV | null;
  predictions: QuantilePrediction[];
  signal?: AISignal;
  status: string;
  regime?: MarketRegime;
  priceChange?: number;
  priceChangePct?: number;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
}

function fmt(p: number, sym: string) {
  if (sym === 'EURUSD') return p.toFixed(5);
  if (p >= 10000) return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (p >= 100)   return p.toFixed(2);
  return p.toFixed(4);
}

function LiveClock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setT(`${String(n.getUTCHours()).padStart(2,'0')}:${String(n.getUTCMinutes()).padStart(2,'0')}:${String(n.getUTCSeconds()).padStart(2,'0')} UTC`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-[#848E9C]">{t}</span>;
}

export default function ChartArea({
  config, history, currentCandle, predictions, signal, status, regime,
  priceChange = 0, priceChangePct = 0,
  timeframe, onTimeframeChange,
}: Props) {
  const [showIndicators, setShowIndicators] = useState(false);
  const chartHandleRef = useRef<TradingChartHandle | null>(null);

  const latest = currentCandle ?? history[history.length - 1];
  const close  = latest?.close ?? config.basePrice;
  const open   = latest?.open  ?? close;
  const high   = latest?.high  ?? close;
  const low    = latest?.low   ?? close;
  const pos    = priceChange >= 0;

  const isLive      = status === 'live';
  const statusColor = isLive ? '#02C076' : '#FF433D';
  const statusText  = isLive ? '● LIVE' : `● ${status.toUpperCase()}`;

  const separatorTime = currentCandle?.time ?? 0;

  const bullPct = (() => {
    if (predictions.length < 2) return 62;
    const slope = predictions[predictions.length - 1].median - predictions[0].median;
    return Math.round(Math.min(88, Math.max(12, 50 + slope / Math.max(Math.abs(slope), 1) * 100 * 0.3)));
  })();

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#2B2F36] flex-shrink-0 bg-[#0D1117]">

        {/* Symbol + OHLC */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-black"
            style={{
              background: config.symbol.startsWith('BTC') ? '#F7931A'
                : config.symbol.startsWith('ETH') ? '#627EEA'
                : config.symbol.startsWith('SOL') ? '#9945FF'
                : '#02C076'
            }}>
            {config.symbol[0]}
          </div>
          <span className="text-xs font-bold text-[#EAECEF]">{config.symbol}</span>
          <span className="text-[10px] text-[#848E9C]">· {timeframe} · {config.exchange}</span>
        </div>

        <div className="hidden lg:flex items-center gap-2 text-[10px] font-mono ml-2">
          <span className="text-[#848E9C]">O<span className="text-[#EAECEF] ml-0.5">{fmt(open, config.symbol)}</span></span>
          <span className="text-[#848E9C]">H<span className="text-[#02C076] ml-0.5">{fmt(high, config.symbol)}</span></span>
          <span className="text-[#848E9C]">L<span className="text-[#FF433D] ml-0.5">{fmt(low, config.symbol)}</span></span>
          <span className="text-[#848E9C]">C<span className="text-[#EAECEF] ml-0.5">{fmt(close, config.symbol)}</span></span>
          <span style={{ color: pos ? '#02C076' : '#FF433D' }}>
            {pos ? '+' : ''}{priceChange.toFixed(config.symbol === 'EURUSD' ? 5 : 1)}
            ({pos ? '+' : ''}{priceChangePct.toFixed(2)}%)
          </span>
        </div>

        <div className="flex-1" />

        {/* Timeframe buttons */}
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} onClick={() => onTimeframeChange(tf)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                timeframe === tf
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#1A2030]'
              }`}>
              {tf}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-[#2B2F36] mx-1" />

        {/* Indicators toggle */}
        <button
          onClick={() => setShowIndicators(!showIndicators)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
            showIndicators
              ? 'text-[#00E6FF] bg-[#00E6FF11]'
              : 'text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#1A2030]'
          }`}>
          <Layers size={11} /><span>Indicators</span>
        </button>
      </div>

      {/* Indicators dropdown */}
      {showIndicators && (
        <div className="absolute z-20 mt-8 ml-2 bg-[#161B22] border border-[#2B2F36] rounded-lg p-3 shadow-2xl"
          style={{ top: 80 }}>
          <div className="text-[10px] text-[#848E9C] mb-2 uppercase tracking-wider">Active Indicators</div>
          {['RSI (14)', 'MACD (12, 26, 9)', 'Volume', 'EMA 20', 'EMA 50'].map((ind) => (
            <div key={ind} className="flex items-center justify-between gap-6 py-1">
              <span className="text-xs text-[#EAECEF]">{ind}</span>
              <div className="w-2 h-2 rounded-full bg-[#02C076]" />
            </div>
          ))}
        </div>
      )}

      {/* ── Chart canvas ── */}
      <div className="relative flex-1 min-h-0">

        {/* Loading overlay — shown while waiting for first HISTORY message */}
        {history.length === 0 && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3"
            style={{ background: '#0B0E11DD', backdropFilter: 'blur(2px)' }}>
            <div className="w-6 h-6 border-2 rounded-full animate-spin"
              style={{ borderColor: '#00E6FF44', borderTopColor: '#00E6FF' }} />
            <span className="text-xs text-[#848E9C]">Loading {config.symbol} data…</span>
          </div>
        )}

        {/* AI Market Regime badge */}
        <div className="absolute top-2 left-2 z-10 rounded-lg px-2.5 py-2"
          style={{ background: '#0D1117EE', border: '1px solid #2B2F36', backdropFilter: 'blur(6px)' }}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="live-dot w-1.5 h-1.5 rounded-full bg-[#02C076]" />
            <span className="text-[9px] text-[#848E9C]">AI Market Regime</span>
          </div>
          <div className="text-[11px] font-bold"
            style={{
              color: regime?.label === 'BEARISH TREND' ? '#FF433D'
                : regime?.label === 'RANGING' ? '#FFB800'
                : regime?.label === 'HIGH VOLATILITY' ? '#A855F7'
                : '#02C076'
            }}>
            {regime?.label ?? 'LOADING…'}
          </div>
          <div className="text-[9px] text-[#848E9C]">Confidence: {regime?.confidence ?? '--'}%</div>
        </div>

        {/* Forecast scenario labels */}
        {predictions.length > 0 && (
          <>
            <div className="absolute top-2 right-2 z-10 text-right">
              <div className="text-[10px] font-bold text-[#02C076] px-2 py-1 rounded mb-1"
                style={{ background: '#02C07611', border: '1px solid #02C07433' }}>
                BULLISH SCENARIO
              </div>
              <div className="text-[9px] text-[#848E9C]">Prob. {bullPct}%</div>
            </div>

            <div className="absolute bottom-2 right-2 z-10 text-right">
              <div className="text-[10px] font-bold text-[#FF433D] px-2 py-1 rounded mb-1"
                style={{ background: '#FF433D11', border: '1px solid #FF433D33' }}>
                BEARISH SCENARIO
              </div>
              <div className="text-[9px] text-[#848E9C]">Prob. {100 - bullPct}%</div>
            </div>

            {/* Forecast legend */}
            <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1">
              {[
                { color: '#00E6FF', label: '↑ Upper 90%', dash: true },
                { color: '#FFB800', label: '● Median 50%', dash: false },
                { color: '#FF433D', label: '↓ Lower 10%', dash: true },
              ].map(({ color, label, dash }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="flex gap-0.5 items-center">
                    {dash ? (
                      <>
                        <div className="w-3 h-px" style={{ borderTop: `2px dashed ${color}` }} />
                        <div className="w-3 h-px" style={{ borderTop: `2px dashed ${color}` }} />
                      </>
                    ) : (
                      <div className="w-6 h-0.5 rounded" style={{ background: color }} />
                    )}
                  </div>
                  <span className="text-[9px]" style={{ color }}>{label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Connection status */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <span className="text-[9px] font-mono px-2 py-0.5 rounded"
            style={{ color: statusColor, background: `${statusColor}11`, border: `1px solid ${statusColor}33` }}>
            {statusText}
          </span>
        </div>

        {/* Forecast separator overlay */}
        {separatorTime > 0 && (
          <ForecastCanvas chartRef={chartHandleRef} separatorTime={separatorTime} />
        )}

        <TradingChart
          ref={chartHandleRef}
          history={history}
          currentCandle={currentCandle}
          predictions={predictions}
          signal={signal}
          symbol={config.symbol}
        />
      </div>

      <RSIPanel  history={history} currentCandle={currentCandle} />
      <MACDPanel history={history} currentCandle={currentCandle} />

      {/* ── Bottom status bar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[#2B2F36] flex-shrink-0 bg-[#0D1117]">
        <div className="text-[10px] text-[#5E6673]">
          {history.length > 0
            ? `${history.length} bars · ${timeframe.toUpperCase()} · ${config.exchange}`
            : 'Awaiting data…'}
        </div>
        <LiveClock />
      </div>
    </div>
  );
}
