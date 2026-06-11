'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import TopNav from '@/components/dashboard/TopNav';
import AISignalPanel from '@/components/dashboard/AISignalPanel';
import BottomPanels from '@/components/dashboard/BottomPanels';
import PredictionsView from '@/components/dashboard/PredictionsView';
import { useAssetStream } from '@/hooks/useAssetStream';
import { ASSET_CONFIGS, TICKER_DATA } from '@/types/trading';

const ChartArea = dynamic(() => import('@/components/dashboard/ChartArea'), { ssr: false });

const STORAGE_KEY = 'ds_predictions_v1';

export default function Home() {
  const [selectedSymbol, setSelectedSymbol]     = useState('BTCUSDT');
  const [timeframe, setTimeframe]               = useState('1h');
  const [livePrices, setLivePrices]             = useState<Record<string, number>>({});
  const [showPredictions, setShowPredictions]   = useState(false);

  const config = ASSET_CONFIGS[selectedSymbol];
  const { history, currentCandle, predictions, signal, regime, intel, status, simulated, outcomes } =
    useAssetStream(selectedSymbol, timeframe);

  useEffect(() => {
    if (currentCandle?.close != null) {
      setLivePrices(prev => ({ ...prev, [selectedSymbol]: currentCandle.close }));
    }
  }, [currentCandle?.close, selectedSymbol]);

  const seedEntry      = TICKER_DATA.find((t) => t.symbol === selectedSymbol);
  const liveClose      = currentCandle?.close ?? seedEntry?.price ?? 0;
  const seedPrice      = seedEntry?.price ?? liveClose;
  const priceChange    = liveClose - seedPrice;
  const priceChangePct = seedPrice > 0 ? (priceChange / seedPrice) * 100 : 0;

  const handleClearPredictions = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    window.location.reload();
  }, []);

  return (
    <div className="flex flex-col" style={{ height: '100vh', overflow: 'hidden', background: '#0B0E11' }}>
      {simulated && (
        <div style={{ background: '#B7791F', color: '#fff', textAlign: 'center', padding: '4px 0', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em' }}>
          ⚠ SIMULATION MODE — Exchange REST feed unavailable. Chart data is synthetic and not suitable for trading decisions.
        </div>
      )}

      <TopNav
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
        livePrices={livePrices}
        showPredictions={showPredictions}
        onTogglePredictions={() => setShowPredictions(v => !v)}
      />

      {showPredictions ? (
        /* ── Predictions full-screen view ── */
        <div className="flex-1 min-h-0 overflow-hidden">
          <PredictionsView
            outcomes={outcomes}
            activeSymbol={selectedSymbol}
            onClear={handleClearPredictions}
            liveStats={signal?.stats}
          />
        </div>
      ) : (
        /* ── Normal trading view ── */
        <>
          <div className="flex min-h-0" style={{ flex: '1 1 0' }}>
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <ChartArea
                config={config}
                history={history}
                currentCandle={currentCandle}
                predictions={predictions}
                signal={signal ?? undefined}
                status={status}
                regime={regime ?? undefined}
                priceChange={priceChange}
                priceChangePct={priceChangePct}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
              />
            </div>

            <div className="flex-shrink-0 border-l border-[#2B2F36] overflow-y-auto"
              style={{ width: 244, background: '#0D1117' }}>
              <AISignalPanel signal={signal ?? undefined} intel={intel ?? undefined} />
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-[#2B2F36]" style={{ background: '#0B0E11' }}>
            <BottomPanels
              signal={signal ?? undefined}
              regime={regime ?? undefined}
              intel={intel ?? undefined}
              currentCandle={currentCandle}
              selectedSymbol={selectedSymbol}
            />
          </div>
        </>
      )}
    </div>
  );
}
