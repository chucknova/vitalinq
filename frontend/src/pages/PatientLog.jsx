import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Clock, CheckCircle2, XCircle, AlertCircle, Timer, ArrowLeft,
  RefreshCw, ClipboardList, CircleDot, ChevronRight, Building2, Activity
} from 'lucide-react';
import api from '../lib/api';

const STATUS_CONFIG = {
  requested: {
    label: 'Incoming',
    className: 'bg-amber-50 text-amber-600 border-amber-100',
    icon: AlertCircle,
  },
  accepted: {
    label: 'Held',
    className: 'bg-sky-50 text-sky-700 border-sky-100',
    icon: Timer,
  },
  completed: {
    label: 'Admitted',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    icon: CheckCircle2,
  },
  expired: {
    label: 'Expired',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: Clock,
  },
  declined: {
    label: 'Declined',
    className: 'bg-red-50 text-red-600 border-red-100',
    icon: XCircle,
  },
};

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatCountdown(seconds) {
  if (seconds == null || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PatientLog() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  const fetchLog = useCallback(async () => {
    try {
      const res = await api.get(`/api/hospitals/log/${slug}`);
      setData(res.data);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      if (err.response?.status === 404) setError('Hospital not found. Check the URL.');
      else setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchLog();
    intervalRef.current = setInterval(fetchLog, 10000);
    return () => clearInterval(intervalRef.current);
  }, [fetchLog]);

  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entries: prev.entries.map((entry) => {
            if (entry.status === 'accepted' && entry.time_remaining_sec > 0) {
              return { ...entry, time_remaining_sec: entry.time_remaining_sec - 1 };
            }
            return entry;
          }),
        };
      });
    }, 1000);

    return () => clearInterval(countdownRef.current);
  }, []);

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <RefreshCw size={18} className="animate-spin text-slate-700" />
          </div>
          <p className="text-sm text-slate-500">Loading patient log...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <XCircle size={40} className="mx-auto mb-3 text-red-500" />
          <p className="mb-1 text-lg font-medium text-slate-900">Something went wrong</p>
          <p className="text-sm text-slate-500">{error}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-sky-600 hover:underline">
            Go to Pulse Map
          </Link>
        </div>
      </div>
    );
  }

  const { hospital, summary, entries } = data;

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1240px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar hospital={hospital} slug={slug} now={now} />

            <div className="mt-4 space-y-4">
              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Patient log</p>
                    <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-slate-950">Recent patient activity</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      A simple handover view for recent requests, held beds, admissions, and declined cases.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <HeaderInfoCard
                      icon={Building2}
                      label="Hospital"
                      value={hospital.name}
                      sub="Live activity feed"
                    />
                    <HeaderInfoCard
                      icon={Activity}
                      label="Refresh"
                      value={lastRefresh ? formatTime(lastRefresh.toISOString()) : '—'}
                      sub="Updates every 10 seconds"
                    />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-3">
                  <SummaryCard label="Active holds" value={summary.active_holds} sub="Patients with a reserved bed" tone="sky" />
                  <SummaryCard label="Admitted (24h)" value={summary.admitted_today} sub="Completed arrivals today" tone="emerald" />
                  <SummaryCard label="Declined (24h)" value={summary.declined} sub="Requests turned away" tone="red" />
                </div>
              </section>

              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-slate-950">Recent entries</p>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                        {entries.length}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Last 24 hours of patient activity.</p>
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
                    <RefreshCw size={12} className="animate-spin" style={{ animationDuration: '10s' }} />
                    Live updates
                  </div>
                </div>

                {entries.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-500">No patient activity in the last 24 hours.</div>
                ) : (
                  <div className="mt-5 space-y-3">
                    {entries.map((entry) => (
                      <LogEntryCard key={entry.transfer_code} entry={entry} />
                    ))}
                  </div>
                )}
              </section>

              <div className="flex justify-between px-1 text-xs text-slate-500">
                <p>Last refreshed: {lastRefresh ? formatTime(lastRefresh.toISOString()) : '—'}</p>
                <Link to={`/hospital/${slug}/dashboard`} className="inline-flex items-center gap-1 font-medium text-sky-600 hover:underline">
                  Manage beds
                  <ChevronRight size={12} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ hospital, slug, now }) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <CircleDot size={12} className="text-sky-400" />
          Patient Log
        </div>
        <div className="hidden items-center gap-2 rounded-full bg-white/[0.04] px-4 py-2 text-sm text-slate-300 md:flex">
          <ClipboardList size={13} />
          History
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/hospital/${slug}/dashboard`}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
        >
          Open Dashboard
        </Link>
        <div className="text-right text-xs text-slate-400">
          <p className="font-medium text-slate-300">{hospital.name}</p>
          <p className="mt-0.5 font-mono">
            {now.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </p>
        </div>
      </div>
    </div>
  );
}

function HeaderInfoCard({ icon, label, value, sub }) {
  const IconComponent = icon;

  return (
    <div className="min-w-[180px] rounded-[22px] border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
          <IconComponent size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{sub}</p>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }) {
  const tones = {
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-[1.75rem] font-semibold tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">{sub}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-[18px] ${tones[tone] || tones.sky}`}>
          <ClipboardList size={16} />
        </div>
      </div>
    </div>
  );
}

function LogEntryCard({ entry }) {
  const config = STATUS_CONFIG[entry.status] || STATUS_CONFIG.expired;
  const Icon = config.icon;

  let timestamp = entry.created_at;
  if (entry.status === 'completed') timestamp = entry.completed_at;
  else if (entry.status === 'accepted') timestamp = entry.accepted_at;

  return (
    <div className="rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[18px] border ${config.className}`}>
          <Icon size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-base font-semibold text-slate-950">{entry.transfer_code}</p>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${config.className}`}>
                  {config.label}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                <span className="font-medium text-slate-700">{(entry.bed_type || '').toUpperCase()} bed</span>
                <span>{formatTime(timestamp)}</span>
                <span className="text-slate-400">Transfer request</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {entry.status === 'completed'
                  ? 'Patient arrived and the handover was completed.'
                  : entry.status === 'accepted'
                    ? 'Bed is currently being held for this patient.'
                    : entry.status === 'declined'
                      ? 'This request was declined and is no longer active.'
                      : entry.status === 'requested'
                        ? 'Waiting for a hospital decision.'
                        : 'This request is no longer active.'}
              </p>
            </div>

            {entry.status === 'accepted' && entry.time_remaining_sec > 0 ? (
              <div className="rounded-[18px] bg-slate-50 px-3 py-3 text-right lg:min-w-[108px]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Time left</p>
                <p className="mt-1 font-mono text-lg font-semibold text-sky-700">
                  {formatCountdown(entry.time_remaining_sec)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
