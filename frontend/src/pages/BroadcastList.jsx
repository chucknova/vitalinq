/**
 * BroadcastList — view all emergency broadcasts.
 *
 * Route: /broadcast
 * Shows active broadcasts first, then resolved.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Radio, Plus, Clock3, Users, Building2, MapPin, Trash2, Ambulance, ClipboardList
} from 'lucide-react';
import api from '../lib/api';
import HistoryNav from '../components/HistoryNav';

function timeSince(iso) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function BroadcastList() {
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/broadcast');
        setBroadcasts(res.data.broadcasts || []);
      } catch (err) {
        console.error('Failed to load broadcasts:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleDelete(broadcastId) {
    try {
      await api.delete(`/api/broadcast/${broadcastId}`);
      setBroadcasts((prev) => prev.filter((broadcast) => broadcast.id !== broadcastId));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  const active = broadcasts.filter((broadcast) => broadcast.status === 'active');
  const resolved = broadcasts.filter((broadcast) => broadcast.status !== 'active');

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1180px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar />

            <div className="mt-4 space-y-4">
              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Broadcasts</p>
                    <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-slate-950">Incident broadcasts</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      Start a new incident, review active coordination rooms, and reopen recent broadcasts when needed.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <HeaderInfoCard icon={Radio} label="Active" value={active.length} sub="Incidents still being coordinated" />
                    <HeaderInfoCard icon={ClipboardList} label="Total" value={broadcasts.length} sub="All current and past broadcasts" />
                  </div>
                </div>
              </section>

              {loading ? (
                <section className="rounded-[28px] bg-white p-12 text-center shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 shadow-sm">
                    <Radio size={18} className="animate-pulse text-red-500" />
                  </div>
                  <p className="text-sm text-slate-500">Loading broadcasts...</p>
                </section>
              ) : broadcasts.length === 0 ? (
                <section className="rounded-[28px] bg-white p-12 text-center shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 shadow-sm">
                    <Radio size={18} className="text-slate-400" />
                  </div>
                  <p className="text-lg font-medium text-slate-900">No broadcasts yet</p>
                  <p className="mt-2 text-sm text-slate-500">Emergency broadcasts will appear here once a new incident is created.</p>
                  <Link
                    to="/broadcast/new"
                    className="mt-5 inline-flex min-h-[42px] items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
                  >
                    <Plus size={14} />
                    Create first broadcast
                  </Link>
                </section>
              ) : (
                <>
                  {active.length > 0 ? (
                    <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                      <SectionHeader title="Active incidents" count={active.length} subtitle="Broadcasts still collecting hospital responses and patient assignments." />
                      <div className="mt-5 space-y-3">
                        {active.map((broadcast) => (
                          <BroadcastCard key={broadcast.id} broadcast={broadcast} onDelete={handleDelete} />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {resolved.length > 0 ? (
                    <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                      <SectionHeader title="Resolved incidents" count={resolved.length} subtitle="Past broadcasts kept for reference and review." />
                      <div className="mt-5 space-y-3">
                        {resolved.map((broadcast) => (
                          <BroadcastCard key={broadcast.id} broadcast={broadcast} onDelete={handleDelete} />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <HistoryNav backFallback="/" />
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <Radio size={13} className="text-red-400" />
          Broadcasts
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/dispatch"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white/8 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/12"
        >
          <Ambulance size={14} />
          Dispatch queue
        </Link>
        <Link
          to="/broadcast/new"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
        >
          <Plus size={14} />
          New broadcast
        </Link>
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

function SectionHeader({ title, count, subtitle }) {
  return (
    <div className="border-b border-slate-100 pb-4">
      <div className="flex items-center gap-2">
        <p className="text-base font-semibold text-slate-950">{title}</p>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{count}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function BroadcastCard({ broadcast, onDelete }) {
  const isActive = broadcast.status === 'active';

  return (
    <div className="rounded-[24px] border border-slate-100 bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <Link to={`/broadcast/${broadcast.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-slate-950">{broadcast.title}</p>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${
              isActive ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'
            }`}>
              {broadcast.status}
            </span>
          </div>

          {broadcast.description ? (
            <p className="mt-2 text-sm leading-6 text-slate-500">{broadcast.description}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <Clock3 size={14} className="text-slate-400" />
              {timeSince(broadcast.created_at)}
            </span>
            <span className="inline-flex items-center gap-2">
              <Building2 size={14} className="text-slate-400" />
              {broadcast.hospitals_responded}/{broadcast.hospitals_pinged} responded
            </span>
            <span className="inline-flex items-center gap-2">
              <Users size={14} className="text-slate-400" />
              About {broadcast.expected_patients} expected
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin size={14} className="text-slate-400" />
              {broadcast.radius_km}km radius
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {broadcast.images && broadcast.images.length > 0 ? (
            <div className="h-14 w-14 overflow-hidden rounded-2xl border border-slate-200">
              <img src={broadcast.images[0]} alt="" className="h-full w-full object-cover" />
            </div>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm(`Delete broadcast "${broadcast.title}"? This removes all patients and responses.`)) {
                onDelete(broadcast.id);
              }
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition hover:border-red-200 hover:text-red-600"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
