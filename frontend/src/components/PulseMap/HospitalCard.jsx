/**
 * HospitalCard — rich detail popup when clicking a hospital marker.
 *
 * Dark theme to match the map. Clear visual hierarchy:
 *   1. Hospital name + type badge
 *   2. Trust + freshness at a glance
 *   3. Bed availability bars (visual, not just numbers)
 *   4. Equipment as compact tags
 *   5. Action hint
 */

const BED_LABELS = {
  icu: 'ICU',
  ward: 'Ward',
  maternity: 'Maternity',
  emergency: 'Emergency',
  pediatric: 'Pediatric',
  surgical: 'Surgical',
  psychiatric: 'Psychiatric',
};

const TYPE_LABELS = {
  teaching: { label: 'Teaching Hospital', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  general: { label: 'General Hospital', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  specialist: { label: 'Specialist', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  private: { label: 'Private', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  maternity: { label: 'Maternity Centre', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  clinic: { label: 'Clinic', color: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
};

const TRUST_CONFIG = {
  verified: { label: 'Verified', icon: '✓', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  active: { label: 'Active', icon: '●', bg: 'bg-gray-500/15', text: 'text-gray-400', border: 'border-gray-500/30' },
  unverified: { label: 'Unverified', icon: '!', bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
};

function formatTime(isoString) {
  if (!isoString) return 'No data';
  const hours = (new Date() - new Date(isoString)) / (1000 * 60 * 60);
  if (hours < 0.1) return 'Just now';
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function getFreshnessColor(isoString) {
  if (!isoString) return 'text-gray-600';
  const hours = (new Date() - new Date(isoString)) / (1000 * 60 * 60);
  if (hours < 2) return 'text-emerald-400';
  if (hours < 6) return 'text-amber-400';
  return 'text-red-400';
}

export default function HospitalCard({ hospital, onClose }) {
  const beds = hospital.beds || [];
  const equipment = hospital.equipment || [];
  const trust = TRUST_CONFIG[hospital.trust_tier] || TRUST_CONFIG.active;
  const typeInfo = TYPE_LABELS[hospital.hospital_type] || TYPE_LABELS.general;
  const accuracy = Math.round((hospital.accuracy_score || 0.5) * 100);

  // Calculate total availability
  let totalAvail = 0;
  let totalBeds = 0;
  beds.forEach((b) => {
    totalAvail += b.available_count || 0;
    totalBeds += b.total_count || 0;
  });

  return (
    <div className="w-[310px] bg-[#0d1320] rounded-xl overflow-hidden border border-gray-700/50 shadow-2xl shadow-black/60 relative">

      {/* ── Header ────────────────────────────────────── */}
      <div className="p-4 pb-3">
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-gray-600 hover:text-gray-300 transition-colors z-10"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        )}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0 pr-4">
            <h3 className="text-white font-semibold text-sm leading-tight truncate">
              {hospital.name}
            </h3>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${typeInfo.color}`}>
                {typeInfo.label}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${trust.bg} ${trust.text} ${trust.border}`}>
                <span className="text-[8px]">{trust.icon}</span>
                {trust.label}
              </span>
            </div>
          </div>

          {/* Availability score circle */}
          <div className="flex-shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center"
            style={{
              borderColor: totalAvail > 10 ? '#10b981' : totalAvail > 0 ? '#f59e0b' : '#ef4444',
            }}
          >
            <div className="text-center leading-none">
              <span className="text-white text-sm font-bold block">{totalAvail}</span>
              <span className="text-gray-500 text-[7px] block">beds</span>
            </div>
          </div>
        </div>

        {/* Freshness + accuracy row */}
        <div className="flex items-center gap-3 text-[10px]">
          <span className={`flex items-center gap-1 ${getFreshnessColor(hospital.last_report_at)}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            Updated {formatTime(hospital.last_report_at)}
          </span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">
            {accuracy}% accuracy
          </span>
        </div>
      </div>

      {/* ── Bed breakdown ─────────────────────────────── */}
      <div className="px-4 pb-3">
        <div className="space-y-2">
          {beds.map((bed) => {
            const label = BED_LABELS[bed.bed_type] || bed.bed_type;
            const avail = bed.available_count || 0;
            const overflow = bed.overflow_count || 0;
            const total = bed.total_count || 1;
            const pct = Math.min(100, ((avail + overflow) / total) * 100);
            const barColor = avail > 0 ? 'bg-emerald-500' : overflow > 0 ? 'bg-amber-500' : 'bg-red-500';

            return (
              <div key={bed.bed_type}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-gray-400 text-[11px]">{label}</span>
                  <span className="text-[11px]">
                    {avail > 0 ? (
                      <span className="text-emerald-400 font-medium">{avail} available</span>
                    ) : overflow > 0 ? (
                      <span className="text-amber-400 font-medium">{overflow} overflow</span>
                    ) : (
                      <span className="text-red-400">Full</span>
                    )}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${barColor} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Equipment ─────────────────────────────────── */}
      {equipment.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-1">
            {equipment.slice(0, 8).map((eq) => (
              <span
                key={eq}
                className="bg-gray-800/80 text-gray-400 px-1.5 py-0.5 rounded text-[9px] border border-gray-700/50"
              >
                {eq.replace('_', ' ')}
              </span>
            ))}
            {equipment.length > 8 && (
              <span className="text-gray-600 text-[9px] px-1.5 py-0.5">
                +{equipment.length - 8}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Footer action hint ────────────────────────── */}
      <div className="px-4 py-2.5 bg-cyan-500/5 border-t border-gray-800/50">
        <p className="text-cyan-400/80 text-[10px] text-center">
          Use the search panel to reserve a bed at this hospital
        </p>
      </div>
    </div>
  );
}