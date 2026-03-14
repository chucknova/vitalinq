/**
 * HospitalMarker — a tangible, numbered badge on the map.
 *
 * Instead of abstract dots, shows a hospital icon with the total
 * available bed count. Color-coded by capacity. Glows when fresh.
 * When search results are active, non-matching hospitals dim out
 * and matched ones show their rank number instead.
 */

import { Heart } from 'lucide-react';

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
  if (totalAvailable > 0) return 'red';
  return 'red';
}

const THEME = {
  green: {
    bg: 'bg-emerald-500',
    border: 'border-emerald-400',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.5)]',
    text: 'text-white',
    ring: 'bg-emerald-400/30',
  },
  amber: {
    bg: 'bg-amber-500',
    border: 'border-amber-400',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.5)]',
    text: 'text-white',
    ring: 'bg-amber-400/30',
  },
  red: {
    bg: 'bg-red-500',
    border: 'border-red-400',
    glow: 'shadow-[0_0_12px_rgba(239,68,68,0.5)]',
    text: 'text-white',
    ring: 'bg-red-400/30',
  },
  stale: {
    bg: 'bg-gray-600',
    border: 'border-gray-500',
    glow: '',
    text: 'text-gray-300',
    ring: '',
  },
};

// Inject pulse animation once
if (typeof document !== 'undefined' && !document.getElementById('bs-marker-css')) {
  const style = document.createElement('style');
  style.id = 'bs-marker-css';
  style.textContent = `
    @keyframes bs-glow {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50% { opacity: 0; transform: scale(1.8); }
    }
    .bs-glow-fast .bs-ring { animation: bs-glow 2s ease-out infinite; }
    .bs-glow-med .bs-ring { animation: bs-glow 4s ease-out infinite; }
    .bs-glow-slow .bs-ring { animation: bs-glow 7s ease-out infinite; }
  `;
  document.head.appendChild(style);
}

export default function HospitalMarker({ hospital, dimmed, rank }) {
  const color = getColor(hospital);
  const theme = THEME[color];
  const { totalAvailable } = getStats(hospital);
  const freshness = getFreshnessHours(hospital);

  const glowClass = freshness < 2 ? 'bs-glow-fast'
    : freshness < 6 ? 'bs-glow-med'
    : freshness < 8 ? 'bs-glow-slow'
    : '';

  const displayNumber = rank || totalAvailable;
  const isRanked = rank !== null && rank !== undefined;

  return (
    <div
      className={`relative cursor-pointer transition-all duration-300 ${glowClass} ${
        dimmed ? 'opacity-20 scale-75' : 'opacity-100 scale-100'
      }`}
      style={{ width: 36, height: 42 }}
    >
      {/* Glow ring */}
      {!dimmed && theme.ring && (
        <div
          className={`bs-ring absolute rounded-full ${theme.ring}`}
          style={{ width: 36, height: 36, top: 0, left: 0 }}
        />
      )}

      {/* Pin body */}
      <div
        className={`absolute flex items-center justify-center rounded-full ${theme.bg} ${theme.border} border-2 ${!dimmed ? theme.glow : ''}`}
        style={{ width: 32, height: 32, top: 0, left: 2 }}
      >
        {isRanked ? (
          /* Rank number when in search results */
          <span className={`text-xs font-bold ${theme.text}`}>
            {rank}
          </span>
        ) : totalAvailable > 0 ? (
          /* Bed count */
          <span className={`text-xs font-bold ${theme.text}`}>
            {totalAvailable > 99 ? '99+' : totalAvailable}
          </span>
        ) : (
          /* No beds — show icon */
          <Heart size={14} className={`${theme.text} opacity-60`} />
        )}
      </div>

      {/* Pin tail */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 w-0 h-0`}
        style={{
          top: 30,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `6px solid ${
            color === 'green' ? '#10b981'
            : color === 'amber' ? '#f59e0b'
            : color === 'red' ? '#ef4444'
            : '#4b5563'
          }`,
        }}
      />
    </div>
  );
}
