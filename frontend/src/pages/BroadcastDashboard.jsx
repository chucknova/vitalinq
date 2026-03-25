/**
 * BroadcastDashboard — live command center for mass casualty incidents.
 *
 * Route: /broadcast/:id
 * Three sections:
 *   - Left: Patient list (logged by paramedic)
 *   - Center: Map (incident, hospitals, ambulances)
 *   - Right: Hospital responses + stats
 *
 * Auto-refreshes every 5 seconds.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import Map, { Marker, NavigationControl, Source, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Radio, RefreshCw, Clock, Users, Check, X,
  AlertTriangle, Loader2, ChevronDown, Zap, Building2
} from 'lucide-react';
import api from '../lib/api';

const SEVERITY_CONFIG = {
  critical: { label: 'CRITICAL', color: 'bg-red-500', border: 'border-red-500/50', text: 'text-red-400', bg: 'bg-red-500/10' },
  high:     { label: 'HIGH',     color: 'bg-amber-500', border: 'border-amber-500/50', text: 'text-amber-400', bg: 'bg-amber-500/10' },
  medium:   { label: 'MEDIUM',   color: 'bg-yellow-500', border: 'border-yellow-500/50', text: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  low:      { label: 'LOW',      color: 'bg-green-500', border: 'border-green-500/50', text: 'text-green-400', bg: 'bg-green-500/10' },
  deceased: { label: 'DECEASED', color: 'bg-gray-500', border: 'border-gray-500/50', text: 'text-gray-400', bg: 'bg-gray-500/10' },
};

const STATUS_CONFIG = {
  unassigned: { label: 'Unassigned', color: 'text-gray-400' },
  assigned:   { label: 'Assigned',   color: 'text-cyan-400' },
  en_route:   { label: 'En Route',   color: 'text-blue-400' },
  arrived:    { label: 'Arrived',    color: 'text-emerald-400' },
  admitted:   { label: 'Admitted',   color: 'text-emerald-400' },
};

function timeSince(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

export default function BroadcastDashboard() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [assigningTo, setAssigningTo] = useState(null); // hospital_id being assigned to
  const [actionLoading, setActionLoading] = useState({});
  const [patientFilter, setPatientFilter] = useState('all'); // all, unassigned, assigned
  const [autoDistPreview, setAutoDistPreview] = useState(null);
  const mapRef = useRef(null);
  const intervalRef = useRef(null);

  // Fetch data
  async function fetchData() {
    try {
      const res = await api.get(`/api/broadcast/${id}`);
      setData(res.data);
      setError(null);
    } catch (err) {
      setError('Failed to load broadcast data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 5000);
    return () => clearInterval(intervalRef.current);
  }, [id]);

  // Assign patient to hospital
  async function handleAssign(patientId, hospitalId) {
    setActionLoading(prev => ({ ...prev, [`assign_${patientId}`]: true }));
    try {
      await api.post(`/api/broadcast/patients/${patientId}/assign`, {
        hospital_id: hospitalId,
      });
      setSelectedPatient(null);
      await fetchData();
    } catch (err) {
      console.error('Assignment failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`assign_${patientId}`]: false }));
    }
  }

  // Auto-distribute
  async function handleAutoDistribute(confirm = false) {
    setActionLoading(prev => ({ ...prev, auto: true }));
    try {
      const res = await api.post(`/api/broadcast/${id}/auto-distribute`, { confirm });
      if (confirm) {
        setAutoDistPreview(null);
        await fetchData();
      } else {
        setAutoDistPreview(res.data);
      }
    } catch (err) {
      console.error('Auto-distribute failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, auto: false }));
    }
  }

  // Resolve broadcast
  async function handleResolve() {
    try {
      await api.patch(`/api/broadcast/${id}`, { status: 'resolved' });
      await fetchData();
    } catch (err) {
      console.error('Resolve failed:', err);
    }
  }

  // Dispatch ambulance — triggers route simulation
  async function handleDispatch(patientId) {
    setActionLoading(prev => ({ ...prev, [`dispatch_${patientId}`]: true }));
    try {
      const res = await api.post(`/api/broadcast/patients/${patientId}/simulate-route`);
      const { waypoints } = res.data;

      // Simulate movement: call PATCH /position with each waypoint every 5 seconds
      if (waypoints && waypoints.length > 0) {
        let idx = 0;
        const interval = setInterval(async () => {
          if (idx >= waypoints.length) {
            clearInterval(interval);
            return;
          }
          try {
            await api.patch(`/api/broadcast/patients/${patientId}/position`, {
              lat: waypoints[idx].lat,
              lng: waypoints[idx].lng,
            });
          } catch (_) {}
          idx++;
        }, 5000);
      }

      await fetchData();
    } catch (err) {
      console.error('Dispatch failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`dispatch_${patientId}`]: false }));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading broadcast...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white mb-2">{error || 'Broadcast not found'}</p>
          <Link to="/" className="text-cyan-400 text-sm hover:underline">Back to Pulse Map</Link>
        </div>
      </div>
    );
  }

  const { broadcast, responses, patients, total_capacity, patient_stats } = data;
  const isActive = broadcast.status === 'active';

  // Filter patients
  const filteredPatients = patients.filter(p => {
    if (patientFilter === 'unassigned') return p.status === 'unassigned';
    if (patientFilter === 'assigned') return p.status !== 'unassigned';
    return true;
  });

  // Responding hospitals for assignment
  const respondingHospitals = responses
    .filter(r => r.status === 'responded')
    .map(r => ({
      ...r,
      hospital: r.hospitals || {},
    }));

  return (
    <div className="h-screen bg-[#0a0f1a] flex flex-col overflow-hidden">
      {/* ── Top Bar ───────────────────────────────────── */}
      <div className="border-b border-gray-800/50 px-4 py-2.5 flex items-center justify-between bg-[#0a0f1a]/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-500 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-2">
            <Radio size={14} className={isActive ? 'text-red-400 animate-pulse' : 'text-gray-500'} />
            <h1 className="text-white text-sm font-semibold">{broadcast.title}</h1>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              isActive ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
            }`}>
              {broadcast.status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-[10px]">
          <span className="text-gray-400 flex items-center gap-1">
            <Clock size={10} /> {timeSince(broadcast.created_at)}
          </span>
          <span className="text-cyan-400 flex items-center gap-1">
            <Building2 size={10} /> {broadcast.hospitals_responded}/{broadcast.hospitals_pinged} responded
          </span>
          <span className="text-white flex items-center gap-1">
            <Users size={10} /> {patient_stats.total} patients
          </span>
          <span className="text-emerald-400">{patient_stats.by_status.assigned + patient_stats.by_status.en_route + patient_stats.by_status.arrived} assigned</span>
          <span className="text-gray-500">{patient_stats.by_status.unassigned} pending</span>

          <div className="flex items-center gap-2 ml-2">
            <Link
              to={`/broadcast/${id}/log`}
              className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all"
            >
              + Log Patient
            </Link>
            {isActive && (
              <button
                onClick={handleResolve}
                className="bg-gray-700/50 hover:bg-gray-700 text-gray-300 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all"
              >
                Resolve
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <RefreshCw size={8} className="text-gray-600 animate-spin" style={{ animationDuration: '5s' }} />
            <span className="text-gray-600 text-[9px]">Live</span>
          </div>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Patient List ────────────────────────── */}
        <div className="w-[320px] border-r border-gray-800/50 flex flex-col">
          <div className="p-3 border-b border-gray-800/50">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-white text-xs font-semibold">Patients ({filteredPatients.length})</h2>
              {patient_stats.by_status.unassigned > 0 && isActive && (
                <button
                  onClick={() => handleAutoDistribute(false)}
                  disabled={actionLoading.auto}
                  className="bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-400 text-[10px] font-medium px-2 py-1 rounded transition-all flex items-center gap-1"
                >
                  {actionLoading.auto ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                  Auto-Assign
                </button>
              )}
            </div>
            <div className="flex gap-1">
              {['all', 'unassigned', 'assigned'].map(f => (
                <button
                  key={f}
                  onClick={() => setPatientFilter(f)}
                  className={`flex-1 py-1 rounded text-[10px] font-medium transition-all ${
                    patientFilter === f
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredPatients.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600 text-xs">No patients logged yet</p>
                <Link
                  to={`/broadcast/${id}/log`}
                  className="text-amber-400 text-xs mt-2 inline-block hover:underline"
                >
                  Open patient log
                </Link>
              </div>
            ) : (
              filteredPatients.map(p => {
                const sev = SEVERITY_CONFIG[p.severity] || SEVERITY_CONFIG.medium;
                const stat = STATUS_CONFIG[p.status] || STATUS_CONFIG.unassigned;
                const isSelected = selectedPatient?.id === p.id;
                const hsStatus = p._handshake_status;
                const transferCode = p._transfer_code;

                // Handshake status display
                const HS_DISPLAY = {
                  requested: { label: 'Notified', color: 'text-amber-400', icon: '📤' },
                  accepted:  { label: 'Bed Held', color: 'text-cyan-400', icon: '🛏' },
                  completed: { label: 'Admitted', color: 'text-emerald-400', icon: '✅' },
                  declined:  { label: 'Declined', color: 'text-red-400', icon: '❌' },
                  expired:   { label: 'Expired', color: 'text-gray-400', icon: '⏰' },
                  overridden:{ label: 'Overridden', color: 'text-red-400', icon: '🔄' },
                };
                const hsDisplay = hsStatus ? HS_DISPLAY[hsStatus] : null;

                return (
                  <div
                    key={p.id}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                      isSelected
                        ? `${sev.bg} ${sev.border}`
                        : 'bg-[#151d2e] border-gray-800/50 hover:border-gray-700'
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${sev.color}`} />
                        <span className="text-white text-xs font-mono font-bold">{p.tag_number}</span>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${sev.bg} ${sev.text}`}>
                          {sev.label}
                        </span>
                      </div>
                      <span className={`text-[9px] ${stat.color}`}>{stat.label}</span>
                    </div>

                    {/* Condition */}
                    {p.condition_notes && (
                      <p className="text-gray-400 text-[10px] line-clamp-1 mb-1">{p.condition_notes}</p>
                    )}

                    {/* Handshake status (if assigned) */}
                    {hsDisplay && (
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px]">{hsDisplay.icon}</span>
                        <span className={`text-[10px] font-medium ${hsDisplay.color}`}>{hsDisplay.label}</span>
                        {transferCode && (
                          <span className="text-gray-600 text-[9px] font-mono">{transferCode}</span>
                        )}
                        {p._hold_remaining_sec > 0 && (
                          <span className="text-cyan-400 text-[9px] font-mono ml-auto">
                            {Math.floor(p._hold_remaining_sec / 60)}:{String(p._hold_remaining_sec % 60).padStart(2, '0')}
                          </span>
                        )}
                        {p._declined_reason && (
                          <span className="text-gray-600 text-[9px] ml-auto truncate max-w-[100px]">
                            ({p._declined_reason})
                          </span>
                        )}
                      </div>
                    )}

                    {/* Hospital assignment */}
                    {p.assigned_hospital_id && p.hospitals && (
                      <p className="text-cyan-400/60 text-[10px] mb-1.5">→ {p.hospitals.name}</p>
                    )}

                    {/* Dispatch button (for assigned patients not yet en_route) */}
                    {p.status === 'assigned' && isActive && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDispatch(p.id); }}
                        disabled={actionLoading[`dispatch_${p.id}`]}
                        className="w-full mt-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[10px] font-medium py-1.5 rounded-lg transition-all flex items-center justify-center gap-1"
                      >
                        {actionLoading[`dispatch_${p.id}`] ? <Loader2 size={10} className="animate-spin" /> : '🚑'}
                        Dispatch Ambulance
                      </button>
                    )}

                    {/* ETA display for en_route */}
                    {p.status === 'en_route' && (
                      <div className="mt-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-blue-400 text-[10px]">🚑</span>
                          <span className="text-blue-400 text-[10px] font-medium">
                            En route{p.eta_minutes ? ` — ~${p.eta_minutes} min` : ''}
                          </span>
                        </div>
                        <a
                          href={`/ambulance/${p.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-blue-400 text-[9px] hover:underline"
                        >
                          Track →
                        </a>
                      </div>
                    )}

                    {/* Quick-assign dropdown (for unassigned patients) */}
                    {p.status === 'unassigned' && isActive && respondingHospitals.length > 0 && (
                      <QuickAssignDropdown
                        hospitals={respondingHospitals}
                        loading={actionLoading[`assign_${p.id}`]}
                        onAssign={(hospitalId) => handleAssign(p.id, hospitalId)}
                        onMapAssign={() => setSelectedPatient(p)}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Center: Map ───────────────────────────────── */}
        <div className="flex-1 relative">
          <Map
            ref={mapRef}
            mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
            initialViewState={{ latitude: broadcast.lat, longitude: broadcast.lng, zoom: 12 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/dark-v11"
          >
            <NavigationControl position="bottom-right" showCompass={false} />

            {/* Incident marker */}
            <Marker latitude={broadcast.lat} longitude={broadcast.lng} anchor="center">
              <div className="relative">
                <div
                  className="absolute rounded-full"
                  style={{ width: 44, height: 44, top: -16, left: -16, backgroundColor: 'rgba(239,68,68,0.2)', animation: 'incident-pulse 1.5s ease-out infinite' }}
                />
                <div style={{ width: 14, height: 14, backgroundColor: '#ef4444', borderRadius: '50%', border: '3px solid white', boxShadow: '0 0 12px rgba(239,68,68,0.6)' }} />
              </div>
            </Marker>

            {/* Responding hospital markers */}
            {respondingHospitals.map(r => {
              const h = r.hospital;
              if (!r._hospital_lat) return null;
              const totalBeds = (r.icu_available || 0) + (r.ward_available || 0) + (r.emergency_available || 0) + (r.surgical_available || 0);
              return (
                <Marker key={r.id} latitude={r._hospital_lat} longitude={r._hospital_lng} anchor="center">
                  <div
                    className="bg-white rounded-lg px-2 py-1 border border-gray-200 shadow-md cursor-pointer flex items-center gap-1.5"
                    onClick={() => {
                      if (selectedPatient && selectedPatient.status === 'unassigned') {
                        handleAssign(selectedPatient.id, h.id);
                      }
                    }}
                    style={{
                      outline: selectedPatient?.status === 'unassigned' ? '2px solid #06b6d4' : 'none',
                      outlineOffset: '2px',
                    }}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-bold text-gray-800">{totalBeds}</span>
                  </div>
                </Marker>
              );
            })}

            {/* Ambulance markers */}
            {patients.filter(p => p.ambulance_lat && (p.status === 'en_route' || p.status === 'assigned')).map(p => (
              <Marker key={`amb-${p.id}`} latitude={p.ambulance_lat} longitude={p.ambulance_lng} anchor="center">
                <div className="flex flex-col items-center">
                  <div className="bg-blue-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-lg shadow-blue-500/30 whitespace-nowrap mb-0.5">
                    {p.tag_number}{p.hospitals ? ` → ${p.hospitals.name.slice(0, 12)}` : ''}
                  </div>
                  <div className="relative">
                    <div
                      className="absolute rounded-full"
                      style={{ width: 28, height: 28, top: -8, left: -8, backgroundColor: 'rgba(59,130,246,0.2)', animation: 'incident-pulse 2s ease-out infinite' }}
                    />
                    <div style={{ width: 12, height: 12, backgroundColor: '#3b82f6', borderRadius: '50%', border: '2px solid white', boxShadow: '0 0 6px rgba(59,130,246,0.5)' }} />
                  </div>
                </div>
              </Marker>
            ))}
          </Map>

          <style>{`
            @keyframes incident-pulse {
              0% { transform: scale(1); opacity: 0.5; }
              100% { transform: scale(3); opacity: 0; }
            }
          `}</style>

          {/* Assignment instruction overlay */}
          {selectedPatient && selectedPatient.status === 'unassigned' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-cyan-500/10 backdrop-blur-sm border border-cyan-500/30 rounded-xl px-4 py-2 flex items-center gap-2">
              <Zap size={14} className="text-cyan-400" />
              <p className="text-cyan-300 text-xs">
                Click a hospital on the map to assign <span className="font-mono font-bold">{selectedPatient.tag_number}</span>
              </p>
              <button onClick={() => setSelectedPatient(null)} className="text-gray-500 hover:text-white ml-2">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Evidence images */}
          {broadcast.images && broadcast.images.length > 0 && (
            <div className="absolute bottom-3 left-3 z-10 flex gap-2">
              {broadcast.images.map((img, i) => (
                <div key={i} className="w-16 h-16 rounded-lg overflow-hidden border border-gray-700/50 shadow-lg">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Hospital Responses ──────────────────── */}
        <div className="w-[300px] border-l border-gray-800/50 flex flex-col">
          {/* Capacity summary */}
          <div className="p-3 border-b border-gray-800/50">
            <h2 className="text-white text-xs font-semibold mb-2">Available Capacity</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(total_capacity).map(([type, count]) => (
                <div key={type} className="bg-[#151d2e] rounded-lg p-1.5 text-center">
                  <p className={`text-sm font-bold ${count > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>{count}</p>
                  <p className="text-gray-500 text-[8px] uppercase">{type.replace('_', ' ')}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Hospital responses */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            <h3 className="text-gray-400 text-[10px] font-medium px-1">
              Responses ({responses.length})
            </h3>
            {responses.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-6">Waiting for hospitals to respond...</p>
            ) : (
              responses.map(r => {
                const h = r.hospitals || {};
                const isDeclined = r.status === 'declined';
                const totalBeds = (r.icu_available || 0) + (r.ward_available || 0) + (r.emergency_available || 0) + (r.surgical_available || 0) + (r.maternity_available || 0) + (r.pediatric_available || 0);

                return (
                  <div
                    key={r.id}
                    className={`bg-[#151d2e] rounded-lg p-2.5 border ${
                      isDeclined ? 'border-gray-800/50 opacity-50' : 'border-gray-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-white text-xs font-medium truncate flex-1">{h.name || 'Unknown'}</h4>
                      {r._distance && (
                        <span className="text-gray-500 text-[10px] ml-1">{r._distance}km</span>
                      )}
                    </div>
                    {isDeclined ? (
                      <p className="text-gray-500 text-[10px]">Unable to help</p>
                    ) : (
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {r.icu_available > 0 && <span className="text-[9px] text-emerald-400">ICU: {r.icu_available}</span>}
                        {r.ward_available > 0 && <span className="text-[9px] text-emerald-400">Ward: {r.ward_available}</span>}
                        {r.emergency_available > 0 && <span className="text-[9px] text-emerald-400">Emerg: {r.emergency_available}</span>}
                        {r.surgical_available > 0 && <span className="text-[9px] text-emerald-400">Surg: {r.surgical_available}</span>}
                        {r.maternity_available > 0 && <span className="text-[9px] text-emerald-400">Mat: {r.maternity_available}</span>}
                        {r.pediatric_available > 0 && <span className="text-[9px] text-emerald-400">Ped: {r.pediatric_available}</span>}
                        {totalBeds === 0 && <span className="text-[9px] text-gray-500">No beds reported</span>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Auto-Distribute Preview Modal ─────────────── */}
      {autoDistPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setAutoDistPreview(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-[#0d1320] border border-gray-700/50 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 pb-3 border-b border-gray-800/50">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <Zap size={14} className="text-cyan-400" />
                Auto-Distribute Preview
              </h3>
              <p className="text-gray-500 text-xs mt-0.5">
                {autoDistPreview.assigned_count} of {autoDistPreview.assignments?.length} patients can be assigned
              </p>
            </div>
            <div className="p-5 max-h-[50vh] overflow-y-auto space-y-1.5">
              {autoDistPreview.assignments?.map((a, i) => {
                const sev = SEVERITY_CONFIG[a.severity] || SEVERITY_CONFIG.medium;
                return (
                  <div key={i} className="flex items-center justify-between bg-[#151d2e] rounded-lg p-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${sev.color}`} />
                      <span className="text-white text-xs font-mono">{a.tag_number}</span>
                      <span className={`text-[9px] ${sev.text}`}>{sev.label}</span>
                    </div>
                    <div className="text-right">
                      {a.hospital_id ? (
                        <p className="text-cyan-400 text-[10px]">→ {a.hospital_name}</p>
                      ) : (
                        <p className="text-red-400 text-[10px]">No match found</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-5 pt-3 border-t border-gray-800/50 flex gap-2">
              <button
                onClick={() => setAutoDistPreview(null)}
                className="flex-1 bg-[#151d2e] hover:bg-[#1a2435] text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAutoDistribute(true)}
                disabled={actionLoading.auto}
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {actionLoading.auto ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Confirm ({autoDistPreview.assigned_count})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Quick Assign Dropdown ────────────────────────────
function QuickAssignDropdown({ hospitals, loading, onAssign, onMapAssign }) {
  const [open, setOpen] = useState(false);

  // Sort hospitals by total available beds (most beds first)
  const sorted = [...hospitals].sort((a, b) => {
    const aTotal = (a.icu_available || 0) + (a.ward_available || 0) + (a.emergency_available || 0) + (a.surgical_available || 0);
    const bTotal = (b.icu_available || 0) + (b.ward_available || 0) + (b.emergency_available || 0) + (b.surgical_available || 0);
    return bTotal - aTotal;
  });

  if (!open) {
    return (
      <div className="flex gap-1.5 mt-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="flex-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-[10px] font-medium py-1.5 rounded-lg transition-all flex items-center justify-center gap-1"
        >
          <Zap size={10} /> Assign
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMapAssign(); }}
          className="bg-gray-700/50 hover:bg-gray-700 text-gray-400 text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all"
        >
          Map
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 bg-[#0d1320] border border-gray-700/50 rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-800/50">
        <p className="text-gray-400 text-[9px]">Select hospital:</p>
        <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-white">
          <X size={10} />
        </button>
      </div>
      <div className="max-h-36 overflow-y-auto">
        {sorted.map(r => {
          const h = r.hospital || {};
          const totalBeds = (r.icu_available || 0) + (r.ward_available || 0) + (r.emergency_available || 0) + (r.surgical_available || 0);
          const bedTypes = [];
          if (r.icu_available > 0) bedTypes.push(`ICU:${r.icu_available}`);
          if (r.emergency_available > 0) bedTypes.push(`ER:${r.emergency_available}`);
          if (r.ward_available > 0) bedTypes.push(`Ward:${r.ward_available}`);
          if (r.surgical_available > 0) bedTypes.push(`Surg:${r.surgical_available}`);

          return (
            <button
              key={r.id}
              onClick={() => { onAssign(h.id); setOpen(false); }}
              disabled={loading}
              className="w-full text-left px-2.5 py-2 hover:bg-gray-800/50 transition-colors border-b border-gray-800/30 last:border-0 flex items-center justify-between gap-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-white text-[10px] font-medium truncate">{h.name || 'Unknown'}</p>
                <p className="text-gray-500 text-[9px]">{bedTypes.join(' · ') || 'No beds'}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {r._distance && <span className="text-gray-600 text-[9px]">{r._distance}km</span>}
                <span className={`text-[10px] font-bold ${totalBeds > 5 ? 'text-emerald-400' : totalBeds > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                  {totalBeds}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}