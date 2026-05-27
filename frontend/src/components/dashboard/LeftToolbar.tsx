'use client';
import { useState } from 'react';
import {
  MousePointer2, Minus, AlignHorizontalJustifyStart, Square,
  Type, TrendingUp, Triangle, Crosshair, Layers, BookmarkPlus,
  BarChart2, Activity,
} from 'lucide-react';

const TOOLS = [
  { icon: <MousePointer2 size={15} />, label: 'Select', group: 0 },
  { icon: <Crosshair size={15} />, label: 'Crosshair', group: 0 },
  { icon: <TrendingUp size={15} />, label: 'Trend Line', group: 1 },
  { icon: <Minus size={15} />, label: 'Horizontal Line', group: 1 },
  { icon: <AlignHorizontalJustifyStart size={15} />, label: 'Horizontal Ray', group: 1 },
  { icon: <Square size={15} />, label: 'Rectangle', group: 2 },
  { icon: <Triangle size={15} />, label: 'Triangle', group: 2 },
  { icon: <Type size={15} />, label: 'Text', group: 3 },
  { icon: <Activity size={15} />, label: 'Measure', group: 4 },
  { icon: <Layers size={15} />, label: 'Layers', group: 5 },
  { icon: <BarChart2 size={15} />, label: 'Volume Profile', group: 5 },
  { icon: <BookmarkPlus size={15} />, label: 'Bookmark', group: 6 },
];

export default function LeftToolbar() {
  const [active, setActive] = useState(0);

  return (
    <div
      className="flex-shrink-0 flex flex-col items-center py-2 gap-0.5"
      style={{ width: 44, background: '#0D1117', borderRight: '1px solid #1E2329' }}
    >
      {TOOLS.map((tool, i) => {
        const showDivider = i > 0 && tool.group !== TOOLS[i - 1].group;
        return (
          <div key={tool.label}>
            {showDivider && <div className="w-6 my-1 border-t border-[#1E2329]" />}
            <button
              title={tool.label}
              onClick={() => setActive(i)}
              className={`w-9 h-9 rounded flex items-center justify-center transition-all ${
                active === i
                  ? 'bg-[#00E6FF1A] text-[#00E6FF]'
                  : 'text-[#5E6673] hover:text-[#848E9C] hover:bg-[#161B22]'
              }`}
            >
              {tool.icon}
            </button>
          </div>
        );
      })}
    </div>
  );
}
