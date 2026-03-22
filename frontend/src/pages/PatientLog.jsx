/**
 * PatientLog — read-only view of incoming/active/recent handshakes for a hospital.
 *
 * Route: /log/:slug
 * No auth. Auto-refreshes every 10 seconds.
 * Designed for shift handovers and bed planning on cheap Android browsers.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Clock, CheckCircle2, XCircle, AlertCircle, Timer, ArrowLeft, RefreshCw } from 'lucide-react';
import api from '../lib/api';

const STATUS_CONFIG = {
  requested: {
    label: 'Incoming',
    color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    icon: AlertCircle,
  },
  accepted: {
    label: 'Held',
    color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    icon: Timer,
  },
  completed: {
    label: 'Admitted',
    color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    icon: CheckCircle2,
  },
  expired: {
    label: 'Expired',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    icon: Clock,
  },
  declined: {
    label: 'Declined',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
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

  // Fetch data
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

  // Initial fetch + auto-refresh every 10 seconds
  useEffect(() => {
    fetchLog();
    intervalRef.current = setInterval(fetchLog, 10000);
    return () => clearInterval(intervalRef.current);
  }, [slug]);

  // Local countdown ticker for held entries
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          entries: prev.entries.map(e => {
            if (e.status === 'accepted' && e.time_remaining_sec > 0) {
              return { ...e, time_remaining_sec: e.time_remaining_sec - 1 };
            }
            return e;
          }),
        };
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  // Current time display
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading patient log...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-6">
        <div className="text-center">
          <XCircle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white text-lg font-medium mb-1">Error</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <Link to="/" className="text-cyan-400 text-sm mt-4 inline-block hover:underline">
            Go to Pulse Map
          </Link>
        </div>
      </div>
    );
  }

  const { hospital, summary, entries } = data;

  return (
    <div className="min-h-screen bg-[#0a0f1a]">
      {/* Header */}
      <div className="border-b border-gray-800/50 px-4 py-3 sticky top-0 bg-[#0a0f1a]/95 backdrop-blur-sm z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-white text-sm font-semibold">{hospital.name}</h1>
              <p className="text-gray-500 text-[10px]">Patient Log</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={`/hospital/${slug}/dashboard`}
              className="text-gray-500 hover:text-cyan-400 text-xs transition-colors"
            >
              Manage Beds →
            </Link>
            <div className="text-right">
              <p className="text-white text-sm font-mono">
                {now.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </p>
              <p className="text-gray-600 text-[10px] flex items-center gap-1 justify-end">
                <RefreshCw size={8} className="animate-spin" style={{ animationDuration: '10s' }} />
                Auto-refreshing
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-3 text-center">
            <p className="text-cyan-400 text-2xl font-bold">{summary.active_holds}</p>
            <p className="text-gray-500 text-[10px] mt-0.5">Active holds</p>
          </div>
          <div className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-3 text-center">
            <p className="text-emerald-400 text-2xl font-bold">{summary.admitted_today}</p>
            <p className="text-gray-500 text-[10px] mt-0.5">Admitted (24h)</p>
          </div>
          <div className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-3 text-center">
            <p className="text-red-400 text-2xl font-bold">{summary.declined}</p>
            <p className="text-gray-500 text-[10px] mt-0.5">Declined (24h)</p>
          </div>
        </div>

        {/* Entries */}
        {entries.length === 0 ? (
          <div className="text-center py-12">
            <Clock size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No patient activity in the last 24 hours</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const config = STATUS_CONFIG[entry.status] || STATUS_CONFIG.expired;
              const Icon = config.icon;

              // Determine the relevant timestamp
              let timestamp = entry.created_at;
              if (entry.status === 'completed') timestamp = entry.completed_at;
              else if (entry.status === 'accepted') timestamp = entry.accepted_at;

              return (
                <div
                  key={entry.transfer_code}
                  className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-3.5 flex items-center gap-3"
                >
                  {/* Status icon */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${config.color}`}>
                    <Icon size={16} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-white text-sm font-mono font-bold">{entry.transfer_code}</span>
                      <span className="text-gray-600 text-[10px]">{entry.bed_type.toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${config.color}`}>
                        {config.label}
                      </span>
                      <span className="text-gray-600 text-[10px]">
                        {formatTime(timestamp)}
                      </span>
                    </div>
                  </div>

                  {/* Countdown for held entries */}
                  {entry.status === 'accepted' && entry.time_remaining_sec > 0 && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-cyan-300 text-lg font-mono font-bold">
                        {formatCountdown(entry.time_remaining_sec)}
                      </p>
                      <p className="text-gray-600 text-[9px]">remaining</p>
                    </div>
                  )}

                  {entry.status === 'accepted' && entry.time_remaining_sec <= 0 && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-red-400 text-xs font-medium">Expiring...</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-gray-700 text-[10px]">
            Last refreshed: {lastRefresh ? formatTime(lastRefresh.toISOString()) : '—'}
            {' · '}{entries.length} entries shown (last 24h)
          </p>
        </div>
      </div>
    </div>
  );
}