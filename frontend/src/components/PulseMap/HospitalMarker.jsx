import { useState } from 'react';
import { BedDouble, Clock3, MapPin } from 'lucide-react';

function getStats(hospital) {
  const beds = hospital.beds || [];
  let totalAvailable = 0;
  let totalBeds = 0;
  let hasOverflow = false;

  for (const bed of beds) {
    totalAvailable += bed.available_count || 0;
    totalBeds += bed.total_count || 0;
    if ((bed.overflow_count || 0) > 0) hasOverflow = true;
  }

  return { totalAvailable, totalBeds, hasOverflow };
}

function getFreshnessHours(hospital) {
  if (!hospital.last_report_at) return 99;
  return (new Date() - new Date(hospital.last_report_at)) / (1000 * 60 * 60);
}

function getColor(hospital) {
  const { totalAvailable, totalBeds, hasOverflow } = getStats(hospital);
  const freshness = getFreshnessHours(hospital);

  if (freshness > 8) return 'stale';
  if (totalBeds === 0) return 'stale';

  const pct = totalAvailable / totalBeds;
  if (pct > 0.5) return 'green';
  if (pct > 0.1 || hasOverflow) return 'amber';
  return 'red';
}

const THEMES = {
  green: {
    bg: '#10201a',
    border: '#1f8f68',
    text: '#d9fff0',
    shadow: 'rgba(16, 185, 129, 0.22)',
    hoverBg: '#14281f',
  },
  amber: {
    bg: '#241a0e',
    border: '#d69c2f',
    text: '#fff2cc',
    shadow: 'rgba(245, 158, 11, 0.22)',
    hoverBg: '#2b2011',
  },
  red: {
    bg: '#241115',
    border: '#d35b67',
    text: '#ffe1e5',
    shadow: 'rgba(239, 68, 68, 0.22)',
    hoverBg: '#2b1418',
  },
  stale: {
    bg: '#141b27',
    border: '#627086',
    text: '#d7deea',
    shadow: 'rgba(107, 114, 128, 0.16)',
    hoverBg: '#18212f',
  },
};

// Inject glow animation once
if (typeof document !== 'undefined' && !document.getElementById('bs-marker-css')) {
  const style = document.createElement('style');
  style.id = 'bs-marker-css';
  style.textContent = `
    @keyframes bs-marker-glow {
      0%, 100% { box-shadow: 0 1px 4px var(--bs-shadow); }
      50% { box-shadow: 0 1px 12px var(--bs-shadow), 0 0 20px var(--bs-shadow); }
    }
    .bs-marker-fresh { animation: bs-marker-glow 2.4s ease-in-out infinite; }
    .bs-marker-warm { animation: bs-marker-glow 4.4s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

export default function HospitalMarker({ hospital, dimmed, rank }) {
  const [hovered, setHovered] = useState(false);
  const color = getColor(hospital);
  const theme = THEMES[color];
  const { totalAvailable } = getStats(hospital);
  const freshness = getFreshnessHours(hospital);

  const isRanked = rank !== null && rank !== undefined;
  const displayText = isRanked ? `${rank}` : totalAvailable > 0 ? totalAvailable : '0';

  const glowClass = freshness < 2 ? 'bs-marker-fresh'
    : freshness < 6 ? 'bs-marker-warm'
    : '';

  // Short name for hover tooltip
  const shortName = hospital.name?.length > 25
    ? hospital.name.substring(0, 23) + '...'
    : hospital.name;

  return (
    <div
      className={`relative cursor-pointer transition-all duration-200 ${
        dimmed ? 'scale-95 opacity-20' : 'scale-100 opacity-100'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ zIndex: hovered ? 50 : dimmed ? 1 : 10 }}
    >
      {hovered && !dimmed && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap pointer-events-none"
          style={{ zIndex: 60 }}
        >
          <div
            className="rounded-lg border px-3 py-2 text-[11px] font-medium"
            style={{
              backgroundColor: '#0f1827',
              color: '#f3f4f6',
              borderColor: 'rgba(148, 163, 184, 0.16)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            <div className="flex items-center gap-2">
              <MapPin size={12} className="text-slate-500" />
              <span>{shortName}</span>
              <span className="text-slate-600">·</span>
              <span style={{ color: theme.border }}>{totalAvailable} open</span>
            </div>
          </div>
          <div
            className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid #0f1827',
            }}
          />
        </div>
      )}

      <div
        className={`min-w-[74px] rounded-xl border transition-all duration-200 ${glowClass}`}
        style={{
          backgroundColor: hovered ? theme.hoverBg : theme.bg,
          borderColor: theme.border,
          color: theme.text,
          boxShadow: `0 6px 20px ${theme.shadow}`,
          '--bs-shadow': theme.shadow,
          transform: hovered ? 'translateY(-1px) scale(1.04)' : 'scale(1)',
        }}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            {!isRanked ? <BedDouble size={12} style={{ opacity: 0.72 }} /> : null}
            <span className="text-sm font-semibold leading-none">{displayText}</span>
            <span className="text-[10px] uppercase tracking-[0.14em] opacity-65">
              {isRanked ? 'Rank' : 'Open'}
            </span>
          </div>
          <Clock3 size={11} style={{ opacity: freshness < 8 ? 0.65 : 0.35 }} />
        </div>
      </div>

      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
        style={{
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `6px solid ${theme.border}`,
        }}
      />
    </div>
  );
}
