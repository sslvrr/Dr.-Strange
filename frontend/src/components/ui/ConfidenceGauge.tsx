'use client';

interface ConfidenceGaugeProps {
  value: number; // 0–100
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: boolean;
}

export default function ConfidenceGauge({
  value,
  size = 80,
  strokeWidth = 8,
  color = '#02C076',
  label = true,
}: ConfidenceGaugeProps) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // Draw a 270-degree arc (from 135° to 405°, i.e., bottom-left to bottom-right via top)
  const startAngle = 135;
  const totalAngle = 270;
  const filledAngle = (value / 100) * totalAngle;

  function polarToCartesian(angle: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function arcPath(start: number, end: number) {
    const s = polarToCartesian(start);
    const e = polarToCartesian(end);
    const largeArc = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const trackPath = arcPath(startAngle, startAngle + totalAngle);
  const fillPath = arcPath(startAngle, startAngle + filledAngle);

  // Color based on value
  const gaugeColor = value >= 70 ? '#02C076' : value >= 45 ? '#FFB800' : '#FF433D';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="#2B2F36"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d={fillPath}
          fill="none"
          stroke={color || gaugeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color || gaugeColor}88)` }}
        />
      </svg>
      {label && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold font-mono" style={{ color: color || gaugeColor }}>
            {value}%
          </span>
        </div>
      )}
    </div>
  );
}
