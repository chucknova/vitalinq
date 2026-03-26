/**
 * HospitalDashboard — primary web interface for hospital staff.
 *
 * Route: /hospital/:slug/dashboard
 * No auth (slug = access token for hackathon).
 * Auto-refreshes every 10 seconds.
 *
 * Building section by section:
 *   A. Bed Status Grid (this file)
 *   B. Quick Actions Bar
 *   C. Incoming Patients (added next)
 *   D. Stats (added next)
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Plus, Minus, Check, Loader2,
  Bed, AlertTriangle, Pencil, X, Zap, ChevronDown
} from 'lucide-react';
import api from '../lib/api';

const BED_LABELS = {
  icu: 'ICU',
  ward: 'Ward',
  maternity: 'Maternity',
  emergency: 'Emergency',
  pediatric: 'Pediatric',
  surgical: 'Surgical',
  psychiatric: 'Psychiatric',
};

const BED_COLORS = {
  icu: { accent: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)' },
  ward: { accent: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)' },
  maternity: { accent: '#ec4899', bg: 'rgba(236,72,153,0.1)', border: 'rgba(236,72,153,0.3)' },
  emergency: { accent: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
  pediatric: { accent: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)' },
  surgical: { accent: '#06b6d4', bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.3)' },
  psychiatric: { accent: '#84cc16', bg: 'rgba(132,204,22,0.1)', border: 'rgba(132,204,22,0.3)' },
};

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

export default function HospitalDashboard() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [sortBy, setSortBy] = useState('time');
  const intervalRef = useRef(null);

  // Sort handshakes
  const URGENCY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedHandshakes = data?.active_handshakes ? [...data.active_handshakes].sort((a, b) => {
    if (sortBy === 'urgency') {
      const aUrg = a.parsed_requirements?.urgency || 'medium';
      const bUrg = b.parsed_requirements?.urgency || 'medium';
      return (URGENCY_ORDER[aUrg] ?? 3) - (URGENCY_ORDER[bUrg] ?? 3);
    }
    return new Date(b.created_at) - new Date(a.created_at);
  }) : [];

  // ── Fetch dashboard data ───────────────────────────
  async function fetchDashboard() {
    try {
      const res = await api.get(`/api/hospitals/dashboard/${slug}`);
      setData(res.data);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Hospital not found. Check the URL.');
      } else {
        setError('Failed to load dashboard.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard();
    intervalRef.current = setInterval(fetchDashboard, 10000);
    return () => clearInterval(intervalRef.current);
  }, [slug]);

  // ── Bed actions ────────────────────────────────────
  async function handleIncrement(bedType) {
    setActionLoading(prev => ({ ...prev, [bedType]: 'inc' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/beds/${bedType}/increment`);
      // Optimistic update
      setData(prev => ({
        ...prev,
        beds: prev.beds.map(b =>
          b.bed_type === bedType
            ? { ...b, available_count: Math.min((b.available_count || 0) + 1, b.total_count || 999) }
            : b
        ),
      }));
    } catch (err) {
      console.error('Increment failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [bedType]: null }));
    }
  }

  async function handleDecrement(bedType) {
    setActionLoading(prev => ({ ...prev, [bedType]: 'dec' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/beds/${bedType}/decrement`);
      setData(prev => ({
        ...prev,
        beds: prev.beds.map(b =>
          b.bed_type === bedType
            ? { ...b, available_count: Math.max((b.available_count || 0) - 1, 0) }
            : b
        ),
      }));
    } catch (err) {
      console.error('Decrement failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [bedType]: null }));
    }
  }

  // ── Quick actions ──────────────────────────────────
  async function handleStillAccurate() {
    setActionLoading(prev => ({ ...prev, _global: 'accurate' }));
    try {
      // Use the existing bed update endpoint to refresh timestamps
      const beds = data.beds.map(b => ({
        bed_type: b.bed_type,
        available_count: b.available_count || 0,
        overflow_count: b.overflow_count || 0,
      }));
      await api.post(`/api/hospitals/dashboard/${slug}/beds`, {
        beds,
        reported_by: 'Dashboard — Still Accurate',
      });
      await fetchDashboard();
    } catch (err) {
      console.error('Still accurate failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, _global: null }));
    }
  }

  async function handleAllFull() {
    if (!confirm('Set ALL bed types to zero? This cannot be undone.')) return;
    setActionLoading(prev => ({ ...prev, _global: 'full' }));
    try {
      const beds = data.beds.map(b => ({
        bed_type: b.bed_type,
        available_count: 0,
        overflow_count: 0,
      }));
      await api.post(`/api/hospitals/dashboard/${slug}/beds`, {
        beds,
        reported_by: 'Dashboard — All Full',
      });
      await fetchDashboard();
    } catch (err) {
      console.error('All full failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, _global: null }));
    }
  }

  // ── Handshake actions ──────────────────────────────
  async function handleAccept(handshakeId) {
    setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: 'accept' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/accept/${handshakeId}`);
      await fetchDashboard();
    } catch (err) {
      console.error('Accept failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  async function handleDecline(handshakeId, reason = 'no_beds') {
    setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: 'decline' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/decline/${handshakeId}`, { reason });
      await fetchDashboard();
    } catch (err) {
      console.error('Decline failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  async function handleOverride(handshakeId, walkinUrgency) {
    setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: 'override' }));
    try {
      const res = await api.post(`/api/hospitals/dashboard/${slug}/override/${handshakeId}`, {
        walkin_urgency: walkinUrgency,
      });
      await fetchDashboard();
    } catch (err) {
      console.error('Override failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  async function handleComplete(handshakeId) {
    setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: 'complete' }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/complete/${handshakeId}`);
      await fetchDashboard();
    } catch (err) {
      console.error('Complete failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: null }));
    }
  }

  // ── Loading state ──────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-6">
        <div className="text-center">
          <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white text-lg font-medium mb-1">Error</p>
          <p className="text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { hospital, beds, active_handshakes, stats } = data;

  return (
    <div className="min-h-screen bg-[#0a0f1a]">
      {/* ── Header ────────────────────────────────────── */}
      <div className="border-b border-gray-800/50 px-4 py-3 sticky top-0 bg-[#0a0f1a]/95 backdrop-blur-sm z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-white text-sm font-semibold">{hospital.name}</h1>
              <p className="text-gray-500 text-[10px]">Hospital Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={`/log/${slug}`}
              className="text-gray-500 hover:text-cyan-400 text-xs transition-colors"
            >
              Patient Log →
            </Link>
            <div className="text-right">
              <p className="text-gray-600 text-[10px] flex items-center gap-1">
                <RefreshCw size={8} className="animate-spin" style={{ animationDuration: '10s' }} />
                {lastRefresh ? formatTime(lastRefresh.toISOString()) : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* ── Section B: Quick Actions ─────────────────── */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={handleStillAccurate}
            disabled={actionLoading._global}
            className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5"
          >
            {actionLoading._global === 'accurate' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            All Still Accurate
          </button>
          <button
            onClick={handleAllFull}
            disabled={actionLoading._global}
            className="flex-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5"
          >
            {actionLoading._global === 'full' ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
            All Full
          </button>
        </div>

        {/* ── Section A: Bed Status Grid ───────────────── */}
        <h2 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
          <Bed size={15} className="text-cyan-400" />
          Bed Availability
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          {beds.map((bed) => {
            const label = BED_LABELS[bed.bed_type] || bed.bed_type;
            const colors = BED_COLORS[bed.bed_type] || BED_COLORS.ward;
            const avail = bed.available_count || 0;
            const total = bed.total_count || 0;
            const overflow = bed.overflow_count || 0;
            const pct = total > 0 ? (avail / total) * 100 : 0;
            const isLoading = actionLoading[bed.bed_type];

            return (
              <div
                key={bed.bed_type}
                className="bg-[#151d2e] border rounded-xl p-4 transition-all"
                style={{ borderColor: colors.border }}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: colors.accent }}
                    />
                    <span className="text-white text-sm font-medium">{label}</span>
                  </div>
                  <span className="text-gray-600 text-[10px]">
                    {formatTime(bed.reported_at)}
                  </span>
                </div>

                {/* Big number */}
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <span className="text-white text-4xl font-bold leading-none">{avail}</span>
                    <span className="text-gray-500 text-sm ml-1">/ {total}</span>
                  </div>
                  {overflow > 0 && (
                    <span className="text-amber-400 text-xs bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      +{overflow} overflow
                    </span>
                  )}
                </div>

                {/* Capacity bar */}
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(pct, 100)}%`,
                      backgroundColor: pct > 50 ? '#10b981' : pct > 10 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>

                {/* +1 / -1 buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDecrement(bed.bed_type)}
                    disabled={isLoading || avail <= 0}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white py-2 rounded-lg transition-all flex items-center justify-center"
                  >
                    {isLoading === 'dec' ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />}
                  </button>
                  <button
                    onClick={() => handleIncrement(bed.bed_type)}
                    disabled={isLoading || avail >= total}
                    className="flex-1 text-white py-2 rounded-lg transition-all flex items-center justify-center"
                    style={{
                      backgroundColor: colors.accent + '33',
                      border: `1px solid ${colors.border}`,
                    }}
                    onMouseEnter={e => e.target.style.backgroundColor = colors.accent + '55'}
                    onMouseLeave={e => e.target.style.backgroundColor = colors.accent + '33'}
                  >
                    {isLoading === 'inc' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Section C: Incoming Patients ──────────────── */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white text-sm font-semibold flex items-center gap-2">
            <Zap size={15} className="text-cyan-400" />
            Incoming Patients
            {active_handshakes.length > 0 && (
              <span className="bg-cyan-500/20 text-cyan-400 text-[10px] font-bold px-1.5 py-0.5 rounded">
                {active_handshakes.length}
              </span>
            )}
          </h2>
          {active_handshakes.length > 1 && (
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="bg-[#151d2e] border border-gray-700/50 rounded-lg px-2 py-1 text-[10px] text-gray-400 focus:outline-none focus:border-cyan-500/50"
            >
              <option value="time">Sort: Newest first</option>
              <option value="urgency">Sort: Most urgent</option>
            </select>
          )}
        </div>

        {active_handshakes.length === 0 ? (
          <div className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-8 text-center mb-8">
            <p className="text-gray-500 text-sm">No incoming patients right now</p>
          </div>
        ) : (
          <div className="space-y-2 mb-8">
            {sortedHandshakes.map((hs) => {
              const isAccepted = hs.status === 'accepted';
              const remaining = hs.time_remaining_sec;
              const hsLoading = actionLoading[`hs_${hs.id}`];
              const urgency = hs.parsed_requirements?.urgency || hs._urgency || null;
              const transport = hs.parsed_requirements?.transport || null;

              const urgencyConfig = {
                critical: { label: 'CRITICAL', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
                high: { label: 'HIGH', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
                medium: { label: 'MEDIUM', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
                low: { label: 'LOW', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
              };
              const uConfig = urgencyConfig[urgency] || null;

              return (
                <div
                  key={hs.id}
                  className={`bg-[#151d2e] border rounded-xl p-4 ${
                    isAccepted ? 'border-cyan-500/30' : 'border-amber-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      {/* Transfer code + bed type + urgency + status */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-white font-mono font-bold text-sm">{hs.transfer_code}</span>
                        <span className="text-gray-600 text-[10px]">{(hs.bed_type || '').toUpperCase()}</span>
                        {uConfig && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${uConfig.color}`}>
                            {uConfig.label}
                          </span>
                        )}
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                          isAccepted
                            ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                            : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                        }`}>
                          {isAccepted ? 'Held' : 'Incoming'}
                        </span>
                      </div>

                      {/* Patient summary */}
                      {hs.patient_summary && (
                        <p className="text-gray-400 text-xs mb-2 line-clamp-2">{hs.patient_summary}</p>
                      )}

                      {transport && (
                        <div className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg mb-2 ${
                          transport.status === 'dispatched'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                        }`}>
                          <span>🚑</span>
                          <span>
                            {transport.status === 'dispatched'
                              ? `Transport dispatched${transport.provider_name ? ` via ${transport.provider_name}` : ''}`
                              : 'Patient requested transport assistance'}
                          </span>
                        </div>
                      )}

                      {/* Countdown for accepted */}
                      {isAccepted && remaining > 0 && (
                        <p className="text-cyan-400 text-xs font-mono">
                          Hold expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                        </p>
                      )}

                      {/* Live ETA — shows when patient is sharing position */}
                      {isAccepted && hs.patient_lat && hs.patient_lng && (
                        <PatientETA
                          patientLat={hs.patient_lat}
                          patientLng={hs.patient_lng}
                          hospitalLat={hospital.lat}
                          hospitalLng={hospital.lng}
                          positionAt={hs.patient_position_at}
                        />
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      {!isAccepted && (
                        <>
                          <button
                            onClick={() => handleAccept(hs.id)}
                            disabled={hsLoading}
                            className="bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-all flex items-center gap-1"
                          >
                            {hsLoading === 'accept' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            Accept
                          </button>
                          <DeclineDropdown
                            onDecline={(reason) => handleDecline(hs.id, reason)}
                            loading={hsLoading === 'decline'}
                          />
                        </>
                      )}
                      {isAccepted && (
                        <>
                          <button
                            onClick={() => handleComplete(hs.id)}
                            disabled={hsLoading}
                            className="bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-all flex items-center gap-1"
                          >
                            {hsLoading === 'complete' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            Arrived
                          </button>
                          <OverrideButton
                            onOverride={(urgency) => handleOverride(hs.id, urgency)}
                            loading={hsLoading === 'override'}
                            transferCode={hs.transfer_code}
                            bedType={hs.bed_type}
                            heldUrgency={urgency}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Section D: Stats ─────────────────────────── */}
        <h2 className="text-white text-sm font-semibold mb-3">Hospital Stats</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard
            label="Accuracy"
            value={`${Math.round((stats.accuracy_score || 0.5) * 100)}%`}
            sub={stats.trust_tier}
            color={stats.trust_tier === 'verified' ? 'emerald' : stats.trust_tier === 'unverified' ? 'red' : 'gray'}
          />
          <StatCard
            label="Patients (7d)"
            value={stats.patients_routed_7d || 0}
            sub={`${stats.patients_admitted_7d || 0} admitted`}
            color="cyan"
          />
          <StatCard
            label="Today"
            value={stats.handshakes_today || 0}
            sub={`${stats.handshakes_today_by_status?.completed || 0} completed`}
            color="blue"
          />
          <StatCard
            label="Last Update"
            value={stats.hours_since_last_report != null ? `${stats.hours_since_last_report}h` : '—'}
            sub={stats.freshness_score >= 0.8 ? 'Fresh' : stats.freshness_score >= 0.4 ? 'Getting stale' : 'Stale'}
            color={stats.freshness_score >= 0.8 ? 'emerald' : stats.freshness_score >= 0.4 ? 'amber' : 'red'}
          />
        </div>
      </div>
    </div>
  );
}


// ── Stat Card Component ──────────────────────────────
function StatCard({ label, value, sub, color }) {
  const colors = {
    emerald: 'border-emerald-500/30 text-emerald-400',
    cyan: 'border-cyan-500/30 text-cyan-400',
    blue: 'border-blue-500/30 text-blue-400',
    amber: 'border-amber-500/30 text-amber-400',
    red: 'border-red-500/30 text-red-400',
    gray: 'border-gray-700/50 text-gray-400',
  };

  return (
    <div className={`bg-[#151d2e] border rounded-xl p-3 ${colors[color] || colors.gray}`}>
      <p className="text-gray-500 text-[10px] mb-1">{label}</p>
      <p className={`text-xl font-bold ${colors[color]?.split(' ')[1] || 'text-white'}`}>{value}</p>
      <p className="text-gray-600 text-[10px] mt-0.5">{sub}</p>
    </div>
  );
}


// ── Decline Dropdown Component ───────────────────────
const DECLINE_OPTIONS = [
  { id: 'no_beds', label: 'No beds available' },
  { id: 'wrong_specialty', label: 'Wrong specialty' },
  { id: 'equipment_unavailable', label: 'Equipment unavailable' },
  { id: 'too_severe', label: 'Condition too severe' },
  { id: 'too_minor', label: 'Condition too minor' },
  { id: 'other', label: 'Other reason' },
];

function DeclineDropdown({ onDecline, loading }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-all flex items-center gap-1"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
        Decline
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-[#1a2435] border border-gray-700/50 rounded-lg shadow-xl z-20 w-48 py-1">
          {DECLINE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => { onDecline(opt.id); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700/50 hover:text-white transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Override Button Component ────────────────────────
const URGENCY_OPTIONS = [
  { id: 'critical', label: 'Critical', icon: '🔴', desc: 'Life-threatening — needs immediate care', color: 'border-red-500/50 hover:bg-red-500/10' },
  { id: 'high', label: 'High', icon: '🟠', desc: 'Serious but stable condition', color: 'border-amber-500/50 hover:bg-amber-500/10' },
  { id: 'medium', label: 'Medium', icon: '🟡', desc: 'Needs care but not critical', color: 'border-yellow-500/50 hover:bg-yellow-500/10' },
];

function OverrideButton({ onOverride, loading, transferCode, bedType, heldUrgency }) {
  const [showModal, setShowModal] = useState(false);
  const [selectedUrgency, setSelectedUrgency] = useState(null);
  const [step, setStep] = useState('select'); // 'select' or 'confirm'

  function handleSelect(urgency) {
    setSelectedUrgency(urgency);
    setStep('confirm');
  }

  function handleConfirm() {
    onOverride(selectedUrgency);
    setShowModal(false);
    setStep('select');
    setSelectedUrgency(null);
  }

  function handleClose() {
    setShowModal(false);
    setStep('select');
    setSelectedUrgency(null);
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        disabled={loading}
        className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-all flex items-center gap-1"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
        Override
      </button>

      {/* Modal backdrop */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Modal content */}
          <div
            className="relative bg-[#0d1320] border border-gray-700/50 rounded-2xl w-full max-w-md shadow-2xl shadow-black/50 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 pb-3 border-b border-gray-800/50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                    <Zap size={14} className="text-red-400" />
                    Override Bed Hold
                  </h3>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {transferCode} · {(bedType || '').toUpperCase()}
                    {heldUrgency && <span className="ml-1">· Currently {heldUrgency.toUpperCase()} urgency</span>}
                  </p>
                </div>
                <button onClick={handleClose} className="text-gray-500 hover:text-white p-1 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {step === 'select' ? (
              /* Step 1: Select walk-in urgency */
              <div className="p-5">
                <p className="text-gray-400 text-xs mb-3">What is the walk-in patient's urgency level?</p>
                <div className="space-y-2">
                  {URGENCY_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => handleSelect(opt.id)}
                      className={`w-full text-left p-3 rounded-xl border bg-transparent transition-all ${opt.color}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{opt.icon}</span>
                        <div>
                          <p className="text-white text-sm font-medium">{opt.label}</p>
                          <p className="text-gray-500 text-xs">{opt.desc}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Step 2: Confirm override */
              <div className="p-5">
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 mb-4">
                  <p className="text-red-400 text-xs font-medium mb-2">⚠️ This action cannot be undone</p>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    The current patient's bed will be released and they will be
                    automatically rerouted to the nearest available hospital.
                  </p>
                </div>

                <div className="bg-[#151d2e] rounded-lg p-3 mb-4 text-xs">
                  <div className="flex justify-between text-gray-400 mb-1">
                    <span>Walk-in urgency</span>
                    <span className="text-white font-medium">{selectedUrgency?.toUpperCase()}</span>
                  </div>
                  {heldUrgency && (
                    <div className="flex justify-between text-gray-400">
                      <span>Current hold urgency</span>
                      <span className="text-white font-medium">{heldUrgency.toUpperCase()}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setStep('select')}
                    className="flex-1 bg-[#151d2e] hover:bg-[#1a2435] text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-all"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirm}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
                  >
                    Confirm Override
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}


// ── Patient ETA Component ────────────────────────────
function PatientETA({ patientLat, patientLng, hospitalLat, hospitalLng, positionAt }) {
  const [eta, setEta] = useState(null);
  const [distance, setDistance] = useState(null);
  const fetchedRef = useRef(null);

  useEffect(() => {
    // Fetch route ETA from Mapbox — only when position changes significantly
    const key = `${patientLat.toFixed(4)},${patientLng.toFixed(4)}`;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;

    fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${patientLng},${patientLat};${hospitalLng},${hospitalLat}` +
      `?overview=false&access_token=${token}`
    )
      .then(r => r.json())
      .then(data => {
        if (data.routes?.[0]) {
          setEta(Math.round(data.routes[0].duration / 60));
          setDistance((data.routes[0].distance / 1000).toFixed(1));
        }
      })
      .catch(() => {});
  }, [patientLat, patientLng]);

  // How fresh is the position?
  const freshness = positionAt
    ? Math.round((new Date() - new Date(positionAt)) / 1000)
    : null;
  const isStale = freshness && freshness > 60;

  if (!eta) return null;

  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-2 py-1">
        <div
          className="rounded-full"
          style={{
            width: 6, height: 6,
            backgroundColor: isStale ? '#6b7280' : '#3b82f6',
            boxShadow: isStale ? 'none' : '0 0 4px rgba(59,130,246,0.5)',
          }}
        />
        <span className="text-blue-400 text-xs font-bold">{eta} min</span>
        <span className="text-gray-500 text-[10px]">{distance} km away</span>
      </div>
      {isStale && (
        <span className="text-gray-600 text-[9px]">GPS {freshness}s ago</span>
      )}
    </div>
  );
}
