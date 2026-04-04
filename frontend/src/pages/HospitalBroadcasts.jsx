import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, Zap, Search, MapPinned, X, ClipboardList, CircleDot
} from 'lucide-react';
import api from '../lib/api';
import HistoryNav from '../components/HistoryNav';

function formatTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const hrs = (now - d) / (1000 * 60 * 60);
  if (hrs < 0.1) return 'Just now';
  if (hrs < 1) return `${Math.round(hrs * 60)}m ago`;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function HospitalBroadcasts() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [broadcastImages, setBroadcastImages] = useState(null);
  const intervalRef = useRef(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await api.get(`/api/hospitals/dashboard/${slug}`);
      setData(res.data);
      setError(null);
    } catch (err) {
      if (err.response?.status === 404) setError('Hospital not found. Check the URL.');
      else setError('Failed to load broadcast desk.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchDashboard();
    intervalRef.current = setInterval(fetchDashboard, 10000);
    return () => clearInterval(intervalRef.current);
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Loader2 size={20} className="animate-spin text-slate-700" />
          </div>
          <p className="text-sm text-slate-500">Loading broadcast desk...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <p className="mb-1 text-lg font-medium text-slate-900">Something went wrong</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const { hospital, broadcast_history = [] } = data;
  const query = searchQuery.trim().toLowerCase();
  const visibleHistory = query
    ? broadcast_history.filter((item) => `${item.broadcast?.title || ''} ${item.broadcast?.description || ''}`.toLowerCase().includes(query))
    : broadcast_history;

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1240px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar hospital={hospital} slug={slug} searchQuery={searchQuery} onSearchChange={setSearchQuery} />

            <div className="mt-4 space-y-4">
              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Broadcast history</p>
                    <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-slate-950">Past broadcast activity</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      Review the alerts your hospital answered, how many patients were accepted, and how many arrived.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-1">
                    <HeaderStat label="History" value={broadcast_history.length} sub="Past responses" />
                  </div>
                </div>
              </section>

              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Broadcast history</p>
                    <p className="mt-1 text-xs text-slate-500">Read-only history of alerts your hospital responded to.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    {visibleHistory.length}
                  </span>
                </div>

                {visibleHistory.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-500">No broadcast history yet.</div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {visibleHistory.map((item) => (
                      <BroadcastHistoryCard
                        key={`${item.broadcast_id}-${item.responded_at || item.status}`}
                        item={item}
                        onViewImages={() => setBroadcastImages({ title: item.broadcast?.title || 'Broadcast images', images: item.broadcast?.images || [] })}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>

      {broadcastImages?.images?.length > 0 ? (
        <ImageLightbox
          title={broadcastImages.title}
          images={broadcastImages.images}
          onClose={() => setBroadcastImages(null)}
        />
      ) : null}
    </div>
  );
}

function TopBar({ hospital, slug, searchQuery, onSearchChange }) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <HistoryNav backFallback={`/hospital/${slug}/dashboard`} />
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <CircleDot size={12} className="text-emerald-400" />
          Broadcast history
        </div>
        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5">
          <p className="truncate text-sm font-semibold text-white">{hospital.name}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
        <label className="flex min-h-[42px] min-w-[220px] flex-1 items-center gap-2 rounded-full bg-white/[0.06] px-4 text-sm text-slate-300 lg:max-w-[360px] lg:flex-none">
          <Search size={14} />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search broadcast history"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            aria-label="Search broadcast history"
          />
        </label>
        <Link
          to={`/log/${slug}`}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
        >
          Open Patient Log
        </Link>
      </div>
    </div>
  );
}

function HeaderStat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3.5 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1.5 text-[1.38rem] font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[12px] leading-5 text-slate-500">{sub}</p>
    </div>
  );
}

function BroadcastHistoryCard({ item, onViewImages }) {
  const broadcast = item.broadcast || {};
  const responseTone = item.status === 'responded'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
    : 'bg-slate-100 text-slate-600 ring-slate-200';
  const lifecycleTone = broadcast.status === 'active'
    ? 'bg-amber-50 text-amber-700 ring-amber-100'
    : 'bg-slate-100 text-slate-600 ring-slate-200';

  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50/55 px-4 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
              <ClipboardList size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-[15px] font-semibold tracking-tight text-slate-950">{broadcast.title || 'Broadcast'}</p>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${responseTone}`}>
                  {item.status === 'responded' ? 'Responded' : 'Declined'}
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${lifecycleTone}`}>
                  {broadcast.status === 'active' ? 'Active' : 'Resolved'}
                </span>
              </div>
              <p className="mt-2 text-xs font-medium text-slate-500">Answered {formatTime(item.responded_at || broadcast.created_at)}</p>
              {broadcast.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">{broadcast.description}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid min-w-[260px] grid-cols-3 gap-2">
          <HistoryStat value={item.assigned_patients_count || 0} label="Assigned" />
          <HistoryStat value={item.accepted_patients_count || 0} label="Accepted" />
          <HistoryStat value={item.arrived_patients_count || 0} label="Arrived" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {broadcast.images?.length ? (
          <button
            type="button"
            onClick={onViewImages}
            className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            <MapPinned size={14} />
            View images
          </button>
        ) : null}
        {item.notes ? <p className="text-sm text-slate-500">{item.notes}</p> : null}
      </div>
    </div>
  );
}

function HistoryStat({ value, label }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-center">
      <p className="text-lg font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">{label}</p>
    </div>
  );
}

function ImageLightbox({ title, images, onClose }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = images[activeIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-[#111111] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 text-white">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs text-white/60">Image {activeIndex + 1} of {images.length}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/15"
          >
            <X size={16} />
          </button>
        </div>

        <div className="bg-black px-4 py-4">
          <img src={activeImage} alt="" className="max-h-[70vh] w-full rounded-[20px] object-contain" />
        </div>

        {images.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto border-t border-white/10 px-4 py-4">
            {images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`overflow-hidden rounded-2xl border transition ${index === activeIndex ? 'border-white/60' : 'border-white/10'}`}
              >
                <img src={image} alt="" className="h-20 w-28 object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
