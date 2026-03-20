import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  RefreshCw,
  Timer,
  XCircle,
} from 'lucide-react';
import api from '../lib/api';

const STATUS_CONFIG = {
  requested: {
    label: 'Incoming',
    badge: 'bg-amber-400/12 text-amber-200 ring-1 ring-inset ring-amber-400/20',
    iconWrap: 'bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-400/16',
    icon: AlertCircle,
  },
  accepted: {
    label: 'Held',
    badge: 'bg-sky-400/12 text-sky-200 ring-1 ring-inset ring-sky-400/20',
    iconWrap: 'bg-sky-400/10 text-sky-200 ring-1 ring-inset ring-sky-400/16',
    icon: Timer,
  },
  completed: {
    label: 'Admitted',
    badge: 'bg-emerald-400/12 text-emerald-200 ring-1 ring-inset ring-emerald-400/20',
    iconWrap: 'bg-emerald-400/10 text-emerald-200 ring-1 ring-inset ring-emerald-400/16',
    icon: CheckCircle2,
  },
  expired: {
    label: 'Expired',
    badge: 'bg-slate-400/10 text-slate-300 ring-1 ring-inset ring-slate-400/16',
    iconWrap: 'bg-slate-400/10 text-slate-300 ring-1 ring-inset ring-slate-400/16',
    icon: Clock,
  },
  declined: {
    label: 'Declined',
    badge: 'bg-rose-400/12 text-rose-200 ring-1 ring-inset ring-rose-400/20',
    iconWrap: 'bg-rose-400/10 text-rose-200 ring-1 ring-inset ring-rose-400/16',
    icon: XCircle,
  },
};

function formatTime(iso) {
  if (!iso) return '--';
  const date = new Date(iso);
  return date.toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatFullDateTime(iso) {
  if (!iso) return '--';
  const date = new Date(iso);
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatCountdown(seconds) {
  if (seconds == null || seconds <= 0) return '--';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function MetricCard({ value, label, accent }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-4 py-4 shadow-[0_12px_30px_rgba(2,6,23,0.16)]">
      <div className={`text-3xl font-semibold tracking-tight ${accent}`}>{value}</div>
      <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">{label}</div>
    </div>
  );
}

export default function PatientLog() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [now, setNow] = useState(new Date());
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  async function fetchLog() {
    try {
      const res = await api.get(`/api/hospitals/log/${slug}`);
      setData(res.data);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Hospital not found. Check the URL.');
      } else {
        setError('Failed to load data.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLog();
    intervalRef.current = setInterval(fetchLog, 10000);
    return () => clearInterval(intervalRef.current);
  }, [slug]);

  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          entries: prev.entries.map(entry => {
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

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060d17] px-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-sky-400/20 border-t-sky-300" />
          <p className="text-sm font-medium text-slate-300">Loading patient log...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060d17] px-6">
        <div className="w-full max-w-md rounded-lg border border-white/8 bg-[#0a1422] p-8 text-center shadow-[0_30px_80px_rgba(2,6,23,0.45)]">
          <XCircle size={40} className="mx-auto mb-4 text-rose-300" />
          <p className="text-lg font-semibold text-white">Unable to open patient log</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{error}</p>
          <Link
            to="/"
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500"
          >
            Go to Pulse Map
          </Link>
        </div>
      </div>
    );
  }

  const { hospital, summary, entries } = data;

  return (
    <div className="min-h-screen bg-[#060d17] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.10),_transparent_26%),radial-gradient(circle_at_85%_12%,_rgba(59,130,246,0.10),_transparent_20%),linear-gradient(180deg,_#08111d_0%,_#060d17_100%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:28px_28px]" />

      <header className="sticky top-0 z-20 border-b border-white/8 bg-[#060d17]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/"
              aria-label="Back to map"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 transition hover:bg-white/[0.06]"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-md bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200">
                Live handover log
              </div>
              <h1 className="mt-2 truncate text-xl font-semibold tracking-tight text-white">{hospital.name}</h1>
              <p className="text-sm leading-6 text-slate-400">
                Incoming requests, held beds, and recent admissions in one operational view.
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-mono text-2xl font-semibold tracking-tight text-slate-100">
              {now.toLocaleTimeString('en-NG', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })}
            </div>
            <div className="mt-1 flex items-center justify-end gap-1 text-xs text-slate-500">
              <RefreshCw size={10} className="animate-spin" style={{ animationDuration: '10s' }} />
              Refreshing every 10 seconds
            </div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.92)_0%,rgba(9,15,26,0.92)_100%)] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.32)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200">Command view</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white">
              Patient movement and reservation status for the current shift.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
              Use this page during handovers to confirm active holds, identify new incoming requests,
              and review admissions or declines without opening the full map.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-slate-400">
              <span>
                Last refresh:{' '}
                <span className="font-medium text-slate-200">
                  {lastRefresh ? formatFullDateTime(lastRefresh.toISOString()) : '--'}
                </span>
              </span>
              <span>
                Entries shown:{' '}
                <span className="font-medium text-slate-200">{entries.length}</span>
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <MetricCard value={summary.active_holds} label="Active holds" accent="text-sky-200" />
            <MetricCard value={summary.admitted_today} label="Admitted (24h)" accent="text-emerald-200" />
            <MetricCard value={summary.declined} label="Declined (24h)" accent="text-rose-200" />
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Transfer entries</h2>
              <p className="text-sm text-slate-400">Ordered for quick scanning on desktop and mobile.</p>
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="rounded-lg border border-white/8 bg-white/[0.03] px-6 py-14 text-center">
              <Clock size={32} className="mx-auto text-slate-600" />
              <p className="mt-4 text-base font-medium text-slate-200">No patient activity in the last 24 hours</p>
              <p className="mt-1 text-sm text-slate-500">
                New transfer requests and admissions will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map(entry => {
                const config = STATUS_CONFIG[entry.status] || STATUS_CONFIG.expired;
                const Icon = config.icon;

                let timestamp = entry.created_at;
                if (entry.status === 'completed') timestamp = entry.completed_at;
                else if (entry.status === 'accepted') timestamp = entry.accepted_at;

                return (
                  <article
                    key={entry.transfer_code}
                    className="rounded-lg border border-white/8 bg-[linear-gradient(180deg,rgba(14,21,34,0.96)_0%,rgba(10,16,28,0.96)_100%)] p-4 shadow-[0_16px_40px_rgba(2,6,23,0.24)]"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-start gap-4">
                        <div className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${config.iconWrap}`}>
                          <Icon size={18} />
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-base font-semibold tracking-[0.14em] text-white">
                              {entry.transfer_code}
                            </span>
                            <span className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${config.badge}`}>
                              {config.label}
                            </span>
                            <span className="rounded-md bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-300 ring-1 ring-inset ring-white/8">
                              {entry.bed_type.toUpperCase()}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Time</p>
                              <p className="mt-1 text-sm font-medium text-slate-200">{formatTime(timestamp)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Recorded</p>
                              <p className="mt-1 text-sm font-medium text-slate-200">{formatFullDateTime(timestamp)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Status note</p>
                              <p className="mt-1 text-sm font-medium text-slate-300">
                                {entry.status === 'accepted'
                                  ? 'Bed currently held'
                                  : entry.status === 'requested'
                                    ? 'Awaiting response'
                                    : entry.status === 'completed'
                                      ? 'Patient admitted'
                                      : entry.status === 'declined'
                                        ? 'Unable to receive'
                                        : 'Reservation elapsed'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 rounded-lg bg-white/[0.03] px-4 py-3 ring-1 ring-inset ring-white/8 lg:min-w-[170px] lg:text-right">
                        {entry.status === 'accepted' && entry.time_remaining_sec > 0 ? (
                          <>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">Time remaining</p>
                            <p className="mt-1 font-mono text-2xl font-semibold text-white">
                              {formatCountdown(entry.time_remaining_sec)}
                            </p>
                          </>
                        ) : entry.status === 'accepted' && entry.time_remaining_sec <= 0 ? (
                          <>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200">Hold status</p>
                            <p className="mt-1 text-base font-semibold text-rose-200">Expiring</p>
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Countdown</p>
                            <p className="mt-1 text-base font-medium text-slate-400">Not active</p>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
