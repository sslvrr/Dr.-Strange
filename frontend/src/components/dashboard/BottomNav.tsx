'use client';
import { useState } from 'react';
import {
  LayoutDashboard, BarChart2, Cpu, Activity,
  GitBranch, Bell, BriefcaseBusiness, Settings,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard',       icon: <LayoutDashboard size={14} /> },
  { label: 'Markets',         icon: <BarChart2 size={14} /> },
  { label: 'AI Scanner',      icon: <Cpu size={14} /> },
  { label: 'Backtesting',     icon: <Activity size={14} /> },
  { label: 'Strategy Builder', icon: <GitBranch size={14} /> },
  { label: 'Alerts',          icon: <Bell size={14} /> },
  { label: 'Portfolio',       icon: <BriefcaseBusiness size={14} /> },
  { label: 'Settings',        icon: <Settings size={14} /> },
];

export default function BottomNav() {
  const [active, setActive] = useState(0);

  return (
    <div
      className="flex-shrink-0 flex items-center justify-center gap-0 border-t border-[#2B2F36]"
      style={{ height: 40, background: '#0B0E11' }}
    >
      {NAV_ITEMS.map((item, i) => (
        <button
          key={item.label}
          onClick={() => setActive(i)}
          className={`flex items-center gap-1.5 px-4 h-full text-[11px] font-medium transition-all border-b-2 ${
            active === i
              ? 'text-[#2563EB] border-[#2563EB]'
              : 'text-[#848E9C] border-transparent hover:text-[#EAECEF] hover:bg-[#161B22]'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
