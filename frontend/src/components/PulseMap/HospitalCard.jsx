import { BedDouble, CheckCircle2, Clock3, ShieldCheck, Stethoscope, X } from 'lucide-react';

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
  teaching: { label: 'Teaching Hospital', color: 'bg-white/[0.05] text-slate-200 border-white/[0.08]' },
  general: { label: 'General Hospital', color: 'bg-white/[0.05] text-slate-200 border-white/[0.08]' },
  specialist: { label: 'Specialist', color: 'bg-white/[0.05] text-slate-200 border-white/[0.08]' },
  private: { label: 'Private', color: 'bg-white/[0.05] text-slate-200 border-white/[0.08]' },
  maternity: { label: 'Maternity Centre', color: 'bg-white/[0.05] text-slate-200 border-white/[0.08]' },
  clinic: { label: 'Clinic', color: 'bg-white/[0.05] text-slate-200 border-white/[0.08]' },
};

const TRUST_CONFIG = {
  verified: { label: 'Confirmed', bg: 'bg-emerald-500/12', text: 'text-emerald-300', border: 'border-emerald-500/20' },
  active: { label: 'Active', bg: 'bg-white/[0.04]', text: 'text-slate-300', border: 'border-white/[0.08]' },
  unverified: { label: 'Needs review', bg: 'bg-amber-500/12', text: 'text-amber-300', border: 'border-amber-500/20' },
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
  if (!isoString) return 'text-slate-500';
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

  let totalAvail = 0;
  let totalBeds = 0;
  beds.forEach((bed) => {
    totalAvail += bed.available_count || 0;
    totalBeds += bed.total_count || 0;
  });

  return (
    <div className="relative max-h-[calc(100vh-80px)] w-[348px] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0f1827] shadow-2xl shadow-black/60">
      <div className="h-1 w-full bg-sky-400/70" />

      <div className="p-5 pb-4">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-slate-500 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Close hospital details"
          >
            <X size={15} />
          </button>
        )}

        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pr-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Hospital</p>
            <h3 className="truncate text-base font-semibold leading-tight text-white">
              {hospital.name}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-md border px-2 py-1 text-[11px] ${typeInfo.color}`}>
                {typeInfo.label}
              </span>
              <span className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${trust.bg} ${trust.text} ${trust.border}`}>
                <ShieldCheck size={11} />
                {trust.label}
              </span>
            </div>
          </div>

          <div className="flex h-[72px] w-[86px] flex-shrink-0 flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
            <div className="flex items-center gap-1 text-slate-400">
              <BedDouble size={12} />
              <span className="text-[10px] uppercase tracking-[0.12em]">Open</span>
            </div>
            <div className="mt-1 text-center leading-none">
              <span className="block text-2xl font-semibold text-white">{totalAvail}</span>
              <span className="block text-[10px] text-slate-500">of {totalBeds || 0}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Updated</p>
            <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${getFreshnessColor(hospital.last_report_at)}`}>
              <Clock3 size={12} />
              {formatTime(hospital.last_report_at)}
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Match score</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-sky-300">
              <CheckCircle2 size={12} />
              {accuracy}% reliable
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.08] px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Stethoscope size={13} className="text-sky-300" />
          <h4 className="text-sm font-medium text-white">Bed breakdown</h4>
        </div>
        <div className="space-y-2.5">
          {beds.map((bed) => {
            const label = BED_LABELS[bed.bed_type] || bed.bed_type;
            const avail = bed.available_count || 0;
            const overflow = bed.overflow_count || 0;
            const total = bed.total_count || 1;
            const pct = Math.min(100, ((avail + overflow) / total) * 100);
            const barColor = avail > 0 ? '#10b981' : overflow > 0 ? '#f59e0b' : '#ef4444';

            return (
              <div key={bed.bed_type} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-200">{label}</span>
                  <span className="text-xs">
                    {avail > 0 ? (
                      <span className="font-medium text-emerald-300">{avail} open</span>
                    ) : overflow > 0 ? (
                      <span className="font-medium text-amber-300">{overflow} overflow</span>
                    ) : (
                      <span className="text-red-300">Full</span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {equipment.length > 0 && (
        <div className="border-t border-white/[0.08] px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={13} className="text-sky-300" />
            <h4 className="text-sm font-medium text-white">Equipment</h4>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {equipment.slice(0, 8).map((eq) => (
              <span
                key={eq}
                className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300"
              >
                {eq.replace('_', ' ')}
              </span>
            ))}
            {equipment.length > 8 && (
              <span className="px-2 py-1 text-[11px] text-slate-500">
                +{equipment.length - 8}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-white/[0.08] bg-white/[0.03] px-5 py-3">
        <p className="text-center text-[11px] text-slate-400">
          Use the search panel to reserve care here.
        </p>
      </div>
    </div>
  );
}
