'use client';
import { useState } from 'react';
import { Search, Bell, BriefcaseBusiness } from 'lucide-react';
import { TICKER_DATA } from '@/types/trading';

interface TopNavProps {
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  livePrices?: Record<string, number>;
  showPredictions?: boolean;
  onTogglePredictions?: () => void;
}

export default function TopNav({ selectedSymbol, onSelectSymbol, livePrices, showPredictions, onTogglePredictions }: TopNavProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeNav, setActiveNav] = useState<string | null>(null);

  return (
    <div className="flex-shrink-0 border-b border-[#2B2F36] bg-[#0D1117]">

      {/* Brand + search + actions */}
      <div className="flex items-center h-11 px-3 gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-[#00E6FF] to-[#2563EB] flex items-center justify-center">
            <span className="text-[10px] font-bold text-black">✦</span>
          </div>
          <span className="text-sm font-bold tracking-tight text-[#EAECEF]">AI TradeVision</span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2563EB] text-white">PRO</span>
        </div>

        {/* Search */}
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors ${
            searchFocused ? 'bg-[#1A2030] border border-[#00E6FF44]' : 'bg-[#161B22] border border-[#2B2F36]'
          }`}
          style={{ width: 180 }}
        >
          <Search size={12} className="text-[#848E9C] flex-shrink-0" />
          <input
            className="bg-transparent text-xs text-[#848E9C] placeholder-[#5E6673] outline-none w-full"
            placeholder="Search assets..."
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        <div className="flex-1" />

        {/* Alerts */}
        <button
          onClick={() => setActiveNav(activeNav === 'alerts' ? null : 'alerts')}
          title="Alerts"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
            activeNav === 'alerts'
              ? 'text-[#FFB800] border-[#FFB80044] bg-[#FFB80011]'
              : 'text-[#848E9C] border-[#2B2F36] hover:text-[#EAECEF] hover:bg-[#161B22]'
          }`}
        >
          <Bell size={13} />
          <span>Alerts</span>
        </button>

        {/* Predictions / Portfolio tab */}
        <button
          onClick={onTogglePredictions}
          title="Prediction Tracker"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
            showPredictions
              ? 'text-[#00E6FF] border-[#00E6FF44] bg-[#00E6FF11]'
              : 'text-[#848E9C] border-[#2B2F36] hover:text-[#EAECEF] hover:bg-[#161B22]'
          }`}
        >
          <BriefcaseBusiness size={13} />
          <span>Predictions</span>
        </button>

        {/* Live status */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[#2B2F36] bg-[#161B22]">
          <div className="live-dot w-1.5 h-1.5 rounded-full bg-[#02C076]" />
          <span className="text-[11px] text-[#EAECEF]">Live</span>
        </div>
      </div>

      {/* Clickable asset ticker bar */}
      <div className="flex items-center h-9 border-t border-[#1E2329] overflow-x-auto">
        {TICKER_DATA.map((t) => {
          const isActive     = t.symbol === selectedSymbol;
          const livePrice    = livePrices?.[t.symbol];
          const displayPrice = livePrice ?? t.price;
          const change       = livePrice != null ? livePrice - t.price : t.change;
          const changePct    = livePrice != null ? ((livePrice - t.price) / t.price) * 100 : t.changePct;
          const pos          = changePct >= 0;

          return (
            <button
              key={t.symbol}
              onClick={() => onSelectSymbol(t.symbol)}
              className={`flex items-center gap-2.5 px-4 h-full border-r border-[#1E2329] flex-shrink-0 transition-colors ${
                isActive ? 'bg-[#161B22] border-b-2 border-b-[#2563EB]' : 'hover:bg-[#161B22]'
              }`}
            >
              <span className={`text-[11px] font-semibold ${isActive ? 'text-[#EAECEF]' : 'text-[#848E9C]'}`}>
                {t.symbol}
              </span>
              <span className="text-[11px] font-mono text-[#EAECEF]">
                {displayPrice >= 1000
                  ? displayPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })
                  : displayPrice < 10 ? displayPrice.toFixed(5)
                  : displayPrice.toFixed(2)}
              </span>
              <span className="text-[11px] font-mono font-semibold" style={{ color: pos ? '#02C076' : '#FF433D' }}>
                {pos ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
