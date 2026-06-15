'use client';
import { useEffect, useRef, useState } from 'react';
import type { LearningAdjustment, LearningReport, LearningStatus } from '@/types/trading';

const BASE = () => `http://${window.location.hostname}:8001`;

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

function fmtTs(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  }) + ' UTC';
}

function MultiplierBadge({ m }: { m: number }) {
  const up = m >= 1.0;
  const color = up ? '#02C076' : '#FF433D';
  const bg    = up ? '#02C07615' : '#FF433D15';
  return (
    <span className="text-[8px] font-mono font-bold px-1 rounded flex-shrink-0"
      style={{ color, background: bg }}>
      ×{m.toFixed(2)} {up ? '↑' : '↓'}
    </span>
  );
}

export default function LearningPanel() {
  const [status, setStatus]   = useState<LearningStatus | null>(null);
  const [report, setReport]   = useState<LearningReport | null>(null);
  const [error,  setError]    = useState(false);
  const fetchedRef             = useRef(false);

  const fetchStatus = async () => {
    try {
      const base = BASE();
      const [sr, rr] = await Promise.all([
        fetch(`${base}/api/learning/status`, { cache: 'no-store' }),
        fetch(`${base}/api/learning/report`,  { cache: 'no-store' }),
      ]);
      if (sr.ok) setStatus(await sr.json());
      if (rr.ok) {
        const rep: LearningReport = await rr.json();
        if (rep.status === 'ok') setReport(rep);
      }
      setError(false);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => clearInterval(id);
  }, []);

  const pct = status ? Math.min((status.samples / status.samples_needed) * 100, 100) : 0;
  const active = status?.learning_active ?? false;

  const badge = active ? (
    <span className="flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-[#02C076] animate-pulse" />
      <span className="text-[8px] font-bold text-[#02C076]">ACTIVE</span>
    </span>
  ) : (
    <span className="text-[8px] text-[#5E6673] font-mono">WARMING UP</span>
  );

  return (
    <Panel title="Learning Engine" badge={badge}>
      {error ? (
        <div className="flex items-center justify-center flex-1">
          <span className="text-[9px] text-[#5E6673]">Backend unavailable</span>
        </div>
      ) : !status ? (
        <div className="flex items-center justify-center flex-1">
          <span className="text-[9px] text-[#5E6673]">Loading…</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 flex-1 overflow-hidden">
          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] text-[#848E9C]">Samples</span>
              <span className="text-[9px] font-mono text-[#EAECEF]">
                {status.samples} / {status.samples_needed}
              </span>
            </div>
            <div className="h-1.5 bg-[#0D1117] rounded-full">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: active ? '#02C076' : '#FFB800' }} />
            </div>
          </div>

          {/* Last / next review */}
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-[#5E6673]">Last review</span>
            <span className="text-[8px] font-mono text-[#848E9C] text-right" style={{ maxWidth: 100 }}>
              {fmtTs(status.last_review_ts)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-[#5E6673]">Next review</span>
            <span className="text-[8px] font-mono text-[#848E9C] text-right" style={{ maxWidth: 100 }}>
              {fmtTs(status.next_review_ts)}
            </span>
          </div>

          {/* Active adjustments */}
          {active && report && report.adjustments.length > 0 ? (
            <div className="border-t border-[#1E2329] pt-1 space-y-0.5 flex-1 overflow-hidden">
              {report.adjustments.slice(0, 2).map((a: LearningAdjustment, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-[8px] font-mono text-[#848E9C] flex-1 truncate">
                    {a.symbol} {a.regime}
                  </span>
                  <MultiplierBadge m={a.multiplier} />
                </div>
              ))}
              {report.feature_insights.length > 0 && (
                <div className="text-[7px] text-[#5E6673] pt-0.5 truncate">
                  {report.feature_insights[0].note}
                </div>
              )}
            </div>
          ) : (
            <div className="border-t border-[#1E2329] pt-1 flex-1 flex items-center">
              <span className="text-[8px] text-[#5E6673]">
                {active ? 'No adjustments yet' : `${status.samples_needed - status.samples} more outcomes needed`}
              </span>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
