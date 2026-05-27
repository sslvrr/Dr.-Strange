'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, Layers, Layout, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { OHLCV, QuantilePrediction, AssetConfig, MarketRegime } from '@/types/trading';
import { RSIPanel, MACDPanel } from '@/components/chart/IndicatorPanels';

const TradingChart = dynamic(() => import('@/components/chart/TradingChart'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-[#848E9C] text-xs">
      Loading chart engine...
    </div>
  ),
});

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', 'D', 'W'];
const RANGES     = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'];

interface Props {
  config: AssetConfig;
  history: OHLCV[];
  currentCandle: OHLCV | null;
  predictions: QuantilePrediction[];
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
      setT(`${String(n.getUTCHours()).padStart(2,'0')}:${String(n.getUTCMinutes()).padStart(2,'0')}:${String(n.getUTCSeconds()).padStart(2,'0')} (UTC)`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono">{t}</span>;
}

export default function ChartArea({
  config, history, currentCandle, predictions, status, regime,
  priceChange = 0, priceChangePct = 0,
  timeframe, onTimeframeChange,
}: Props) {
  const [showIndicators, setShowIndicators] = useState(false);

  const latest  = currentCandle ?? history[history.length - 1];
  const close   = latest?.close ?? config.basePrice;
  const open    = latest?.open  ?? close;
  const high    = latest?.high  ?? close;
  const low     = latest?.low   ?? close;
  const pos     = priceChange >= 0;

  const isLive     = status === 'live';
  const statusColor = isLive ? '#02C076' : '#FF433D';
  const statusText  = isLive ? '● LIVE ENGINE CONNECTED' : `● ${status.toUpperCase()}`;

  // Derive bullish probability from the median forecast slope
  const bullPct = (() => {
    if (predictions.length < 2) return 62;
    const slope = predictions[predictions.length - 1].median - predictions[0].median;
    return Math.round(Math.min(88, Math.max(12, 50 + slope / Math.max(Math.abs(slope), 1) * 100 * 0.3)));
  })();

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Chart toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#2B2F36] flex-shrink-0 bg-[#0D1117]">
        {/* Symbol */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-black"
            style={{ background: config.symbol.startsWith('BTC') ? '#F7931A' : config.symbol.startsWith('ETH') ? '#627EEA' : config.symbol.startsWith('SOL') ? '#9945FF' : '#02C076' }}>
            {config.symbol[0]}
          </div>
          <span className="text-xs font-bold text-[#EAECEF]">{config.symbol}</span>
          <span className="text-[10px] text-[#848E9C]">· {timeframe} · {config.exchange}</span>
        </div>

        {/* OHLC */}
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
                timeframe === tf ? 'bg-[#2563EB] text-white' : 'text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#1A2030]'
              }`}>
              {tf}
            </button>
          ))}
          <button className="px-1 text-[#848E9C] hover:text-[#EAECEF]"><ChevronDown size={12} /></button>
        </div>

        <div className="w-px h-4 bg-[#2B2F36] mx-1" />

        {/* Tools */}
        <div className="flex gap-1">
          <button onClick={() => setShowIndicators(!showIndicators)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#1A2030] transition-colors">
            <Layers size={11} /><span>Indicators</span>
          </button>
          <button className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#1A2030] transition-colors">
            <Layout size={11} /><span>Templates</span>
          </button>
          <button className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#1A2030] transition-colors">
            <RefreshCw size={11} /><span>Replay</span>
          </button>
        </div>
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

      {/* ── Chart canvas — fills ALL remaining height ── */}
      <div className="relative flex-1 min-h-0">

        {/* AI Market Regime badge — live from backend */}
        <div className="absolute top-2 left-2 z-10 rounded-lg px-2.5 py-2"
          style={{ background: '#0D1117EE', border: '1px solid #2B2F36', backdropFilter: 'blur(6px)' }}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="live-dot w-1.5 h-1.5 rounded-full bg-[#02C076]" />
            <span className="text-[9px] text-[#848E9C]">AI Market Regime</span>
          </div>
          <div className="text-[11px] font-bold"
            style={{ color: regime?.label === 'BEARISH TREND' ? '#FF433D' : regime?.label === 'RANGING' ? '#FFB800' : regime?.label === 'HIGH VOLATILITY' ? '#A855F7' : '#02C076' }}>
            {regime?.label ?? 'LOADING…'}
          </div>
          <div className="text-[9px] text-[#848E9C]">Confidence: {regime?.confidence ?? '--'}%</div>
        </div>

        {/* Forecast labels — only when we have predictions */}
        {predictions.length > 0 && (
          <>
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
              <div className="text-[10px] font-semibold text-[#848E9C] px-3 py-1 rounded"
                style={{ background: '#0D1117BB', border: '1px solid #2B2F3666' }}>
                AI FORECAST (NEXT 24–48H)
              </div>
            </div>

            <div className="absolute top-2 right-2 z-10 text-right">
              <div className="text-[10px] font-bold text-[#02C076] px-2 py-1 rounded mb-1"
                style={{ background: '#02C07611', border: '1px solid #02C07433' }}>
                BULLISH SCENARIO
              </div>
              <div className="text-[9px] text-[#848E9C]">Prob. {bullPct}%</div>
            </div>

            <div className="absolute bottom-10 right-2 z-10 text-right">
              <div className="text-[10px] font-bold text-[#FF433D] px-2 py-1 rounded mb-1"
                style={{ background: '#FF433D11', border: '1px solid #FF433D33' }}>
                BEARISH SCENARIO
              </div>
              <div className="text-[9px] text-[#848E9C]">Prob. {100 - bullPct}%</div>
            </div>

            {/* Forecast legend */}
            <div className="absolute bottom-10 left-2 z-10 flex flex-col gap-1">
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
        <div className="absolute top-2 left-1/2 ml-20 z-10">
          <span className="text-[9px] font-mono px-2 py-0.5 rounded"
            style={{ color: statusColor, background: `${statusColor}11`, border: `1px solid ${statusColor}33` }}>
            {statusText}
          </span>
        </div>

        <TradingChart
          history={history}
          currentCandle={currentCandle}
          predictions={predictions}
          symbol={config.symbol}
        />
      </div>

      {/* ── RSI and MACD: stable canvas panels, no chart jumping ── */}
      <RSIPanel  history={history} currentCandle={currentCandle} />
      <MACDPanel history={history} currentCandle={currentCandle} />

      {/* ── Bottom bar ── */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-[#2B2F36] flex-shrink-0 bg-[#0D1117]">
        <div className="flex gap-0.5">
          {RANGES.map((r) => (
            <button key={r}
              className="px-1.5 py-0.5 rounded text-[10px] text-[#848E9C] hover:text-[#EAECEF] hover:bg-[#161B22] transition-colors">
              {r}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#848E9C]">
          <LiveClock />
          <span className="text-[#2B2F36]">|</span>
          <button className="hover:text-[#EAECEF]">%</button>
          <button className="hover:text-[#EAECEF]">log</button>
          <button className="hover:text-[#EAECEF]">auto</button>
        </div>
      </div>
    </div>
  );
}
