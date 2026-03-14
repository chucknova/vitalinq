/**
 * HospitalMarker — clean badge-style marker like Kiwi.com price tags.
 *
 * Shows bed count in a rounded pill, color-coded by capacity.
 * On hover, expands to show hospital name.
 * When search results are active, shows rank number instead.
 */

import { useState } from 'react';
import { Bed } from 'lucide-react';

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
    bg: '#065f46',
    border: '#10b981',
    text: '#ecfdf5',
    shadow: 'rgba(16, 185, 129, 0.3)',
    hoverBg: '#047857',
  },
  amber: {
    bg: '#78350f',
    border: '#f59e0b',
    text: '#fefce8',
    shadow: 'rgba(245, 158, 11, 0.3)',
    hoverBg: '#92400e',
  },
  red: {
    bg: '#7f1d1d',
    border: '#ef4444',
    text: '#fef2f2',
    shadow: 'rgba(239, 68, 68, 0.3)',
    hoverBg: '#991b1b',
  },
  stale: {
    bg: '#1f2937',
    border: '#6b7280',
    text: '#d1d5db',
    shadow: 'rgba(107, 114, 128, 0.2)',
    hoverBg: '#374151',
  },
};

// Inject glow animation once
if (typeof document !== 'undefined' && !document.getElementById('bs-badge-css')) {
  const style = document.createElement('style');
  style.id = 'bs-badge-css';
  style.textContent = `
    @keyframes bs-badge-glow {
      0%, 100% { box-shadow: 0 1px 4px var(--bs-shadow); }
      50% { box-shadow: 0 1px 12px var(--bs-shadow), 0 0 20px var(--bs-shadow); }
    }
    .bs-badge-fresh { animation: bs-badge-glow 2s ease-in-out infinite; }
    .bs-badge-warm { animation: bs-badge-glow 4s ease-in-out infinite; }
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
  const displayText = isRanked ? `#${rank}` : totalAvailable > 0 ? totalAvailable : '0';

  const glowClass = freshness < 2 ? 'bs-badge-fresh'
    : freshness < 6 ? 'bs-badge-warm'
    : '';

  // Short name for hover tooltip
  const shortName = hospital.name?.length > 25
    ? hospital.name.substring(0, 23) + '...'
    : hospital.name;

  return (
    <div
      className={`relative cursor-pointer transition-all duration-200 ${
        dimmed ? 'opacity-20 scale-90' : 'opacity-100 scale-100'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ zIndex: hovered ? 50 : dimmed ? 1 : 10 }}
    >
      {/* ── Hover tooltip: hospital name ──────────────── */}
      {hovered && !dimmed && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap pointer-events-none"
          style={{ zIndex: 60 }}
        >
          <div
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium"
            style={{
              backgroundColor: '#111827',
              color: '#f3f4f6',
              border: '1px solid rgba(75, 85, 99, 0.5)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            {shortName}
            <span className="text-gray-500 ml-1.5">·</span>
            <span className="ml-1.5" style={{ color: theme.border }}>
              {totalAvailable} {totalAvailable === 1 ? 'bed' : 'beds'}
            </span>
          </div>
          {/* Arrow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid #111827',
            }}
          />
        </div>
      )}

      {/* ── Badge ─────────────────────────────────────── */}
      <div
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 border transition-all duration-200 ${glowClass}`}
        style={{
          backgroundColor: hovered ? theme.hoverBg : theme.bg,
          borderColor: theme.border,
          color: theme.text,
          boxShadow: `0 1px 4px ${theme.shadow}`,
          '--bs-shadow': theme.shadow,
          minWidth: 32,
          justifyContent: 'center',
          transform: hovered ? 'scale(1.1)' : 'scale(1)',
        }}
      >
        {/* Bed icon */}
        {!isRanked && (
          <Bed size={12} style={{ opacity: 0.7 }} />
        )}

        {/* Count or rank */}
        <span className="text-s font-bold leading-none">
          {displayText}
        </span>
      </div>

      {/* ── Pointer triangle ──────────────────────────── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
        style={{
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: `5px solid ${theme.border}`,
        }}
      />
    </div>
  );
}