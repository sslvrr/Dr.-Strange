'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import TopNav from '@/components/dashboard/TopNav';
import LeftToolbar from '@/components/dashboard/LeftToolbar';
import BottomNav from '@/components/dashboard/BottomNav';
import AISignalPanel from '@/components/dashboard/AISignalPanel';
import BottomPanels from '@/components/dashboard/BottomPanels';
import { useAssetStream } from '@/hooks/useAssetStream';
import { ASSET_CONFIGS, TICKER_DATA } from '@/types/trading';

const ChartArea = dynamic(() => import('@/components/dashboard/ChartArea'), { ssr: false });

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  const config = ASSET_CONFIGS[selectedSymbol];
  const { history, currentCandle, predictions, signal, regime, metrics, intel, status } = useAssetStream(selectedSymbol, timeframe);

  // Track live price for the active symbol so TopNav shows it in the ticker bar
  useEffect(() => {
    if (currentCandle?.close != null) {
      setLivePrices(prev => ({ ...prev, [selectedSymbol]: currentCandle.close }));
    }
  }, [currentCandle?.close, selectedSymbol]);

  // Compute price change vs static seed (shown in ChartArea toolbar)
  const seedEntry = TICKER_DATA.find((t) => t.symbol === selectedSymbol);
  const liveClose = currentCandle?.close ?? seedEntry?.price ?? 0;
  const seedPrice  = seedEntry?.price ?? liveClose;
  const priceChange    = liveClose - seedPrice;
  const priceChangePct = seedPrice > 0 ? (priceChange / seedPrice) * 100 : 0;

  return (
    <div className="flex flex-col" style={{ height: '100vh', overflow: 'hidden', background: '#0B0E11' }}>
      <TopNav
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
        livePrices={livePrices}
      />

      <div className="flex min-h-0" style={{ flex: '1 1 0' }}>
        <LeftToolbar />

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
          confidence={signal?.confidence}
          regime={regime ?? undefined}
          metrics={metrics ?? undefined}
        />
      </div>

      <BottomNav />
    </div>
  );
}
