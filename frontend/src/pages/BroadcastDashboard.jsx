/**
 * BroadcastDashboard — live command center for mass casualty incidents.
 *
 * Route: /broadcast/:id
 * Three sections:
 *   - Left: Patient list
 *   - Center: Map
 *   - Right: Hospital responses
 *
 * Auto-refreshes every 5 seconds.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Map, { Marker, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Radio, RefreshCw, Clock3, Users, Check, X,
  AlertTriangle, Loader2, Zap, Building2, Ambulance, MapPin,
  CircleDot, ClipboardList
} from 'lucide-react';
import api from '../lib/api';

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', badge: 'bg-red-50 text-red-600 border-red-100', dot: 'bg-red-500' },
  high: { label: 'High', badge: 'bg-amber-50 text-amber-600 border-amber-100', dot: 'bg-amber-500' },
  medium: { label: 'Medium', badge: 'bg-sky-50 text-sky-700 border-sky-100', dot: 'bg-sky-500' },
  low: { label: 'Low', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' },
  deceased: { label: 'Deceased', badge: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-500' },
};

const STATUS_CONFIG = {
  unassigned: { label: 'Waiting', text: 'text-slate-500' },
  assigned: { label: 'Assigned', text: 'text-sky-600' },
  dispatched: { label: 'Dispatched', text: 'text-sky-700' },
  en_route_to_patient: { label: 'To patient', text: 'text-blue-600' },
  at_scene: { label: 'At scene', text: 'text-violet-700' },
  en_route_to_hospital: { label: 'To hospital', text: 'text-cyan-700' },
  delivered: { label: 'Accepted', text: 'text-emerald-600' },
  admitted: { label: 'Admitted', text: 'text-emerald-700' },
};

const HANDSHAKE_CONFIG = {
  requested: { label: 'Hospital notified', text: 'text-amber-600' },
  accepted: { label: 'Bed held', text: 'text-sky-700' },
  completed: { label: 'Admitted', text: 'text-emerald-700' },
  declined: { label: 'Declined', text: 'text-red-600' },
  expired: { label: 'Expired', text: 'text-slate-500' },
  overridden: { label: 'Overridden', text: 'text-red-600' },
};

const TRANSPORT_STATUS_CONFIG = {
  asking_hospital: { label: 'Checking hospital transport', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  hospital_accepted: { label: 'Hospital transport confirmed', tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  asking_dispatch: { label: 'Checking ambulance providers', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  dispatch_accepted: { label: 'Ambulance assigned', tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  rerouted: { label: 'Rerouted to a new hospital', tone: 'bg-violet-50 text-violet-700 border-violet-100' },
  reroute_failed: { label: 'Reroute needs attention', tone: 'bg-red-50 text-red-700 border-red-100' },
  no_ambulance: { label: 'No ambulance available yet', tone: 'bg-red-50 text-red-700 border-red-100' },
  dispatched: { label: 'Crew on the move', tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  en_route_to_patient: { label: 'Crew going to patient', tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  at_scene: { label: 'Crew at the scene', tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  en_route_to_hospital: { label: 'Going to the hospital', tone: 'bg-sky-50 text-sky-700 border-sky-100' },
  delivered: { label: 'Arrived at hospital', tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
};

function canStartRealDispatch(patient) {
  return getDisplayStatus(patient) === 'assigned' && !patient.transport_id && !patient._transport_status;
}

function currentTransportState(patient) {
  return patient._crew_progress || patient._assignment_status || patient._transport_status || null;
}

function getDisplayStatus(patient) {
  return patient._display_status || patient.status || 'unassigned';
}

function assignedWorkflowCount(byStatus = {}) {
  return (
    (byStatus.assigned || 0) +
    (byStatus.dispatched || 0) +
    (byStatus.en_route_to_patient || 0) +
    (byStatus.at_scene || 0) +
    (byStatus.en_route_to_hospital || 0) +
    (byStatus.delivered || 0)
  );
}

function isAcceptedAtHospital(patient) {
  const displayStatus = getDisplayStatus(patient);
  return displayStatus === 'delivered' || displayStatus === 'admitted';
}

function timeSince(iso) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function totalBedsFromResponse(response) {
  return (
    (response.icu_available || 0) +
    (response.ward_available || 0) +
    (response.emergency_available || 0) +
    (response.surgical_available || 0) +
    (response.maternity_available || 0) +
    (response.pediatric_available || 0)
  );
}

function bedSummary(response) {
  const items = [];
  if (response.icu_available > 0) items.push(`ICU ${response.icu_available}`);
  if (response.emergency_available > 0) items.push(`Emergency ${response.emergency_available}`);
  if (response.ward_available > 0) items.push(`Ward ${response.ward_available}`);
  if (response.surgical_available > 0) items.push(`Surgical ${response.surgical_available}`);
  if (response.maternity_available > 0) items.push(`Maternity ${response.maternity_available}`);
  if (response.pediatric_available > 0) items.push(`Pediatric ${response.pediatric_available}`);
  return items;
}

export default function BroadcastDashboard() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [patientFilter, setPatientFilter] = useState('all');
  const [autoDistPreview, setAutoDistPreview] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const mapRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`/api/broadcast/${id}`);
      setData(res.data);
      setLastRefresh(new Date());
      setError(null);
    } catch {
      setError('Failed to load broadcast data.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 5000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  async function handleAssign(patientId, hospitalId) {
    setActionLoading((prev) => ({ ...prev, [`assign_${patientId}`]: true }));
    try {
      await api.post(`/api/broadcast/patients/${patientId}/assign`, {
        hospital_id: hospitalId,
      });
      setSelectedPatient(null);
      await fetchData();
    } catch (err) {
      console.error('Assignment failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`assign_${patientId}`]: false }));
    }
  }

  async function handleAutoDistribute(confirm = false) {
    setActionLoading((prev) => ({ ...prev, auto: true }));
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
      setActionLoading((prev) => ({ ...prev, auto: false }));
    }
  }

  async function handleResolve() {
    try {
      await api.patch(`/api/broadcast/${id}`, { status: 'resolved' });
      await fetchData();
    } catch (err) {
      console.error('Resolve failed:', err);
    }
  }

  async function handleDispatch(patientId) {
    setActionLoading((prev) => ({ ...prev, [`dispatch_${patientId}`]: true }));
    try {
      const res = await api.post(`/api/broadcast/patients/${patientId}/dispatch`);
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          patients: prev.patients.map((patient) => (
            patient.id === patientId
              ? {
                  ...patient,
                  transport_id: res.data.transport_id,
                  _transport_status: res.data.status,
                }
              : patient
          )),
        };
      });
      await fetchData();
    } catch (err) {
      console.error('Dispatch failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`dispatch_${patientId}`]: false }));
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <RefreshCw size={18} className="animate-spin text-slate-700" />
          </div>
          <p className="text-sm text-slate-500">Loading broadcast dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
          <AlertTriangle size={40} className="mx-auto mb-3 text-red-500" />
          <p className="mb-1 text-lg font-medium text-slate-900">{error || 'Broadcast not found'}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-sky-600 hover:underline">
            Go to Pulse Map
          </Link>
        </div>
      </div>
    );
  }

  const { broadcast, responses, patients, total_capacity, patient_stats } = data;
  const isActive = broadcast.status === 'active';

  const filteredPatients = patients.filter((patient) => {
    const displayStatus = getDisplayStatus(patient);
    if (patientFilter === 'unassigned') return displayStatus === 'unassigned';
    if (patientFilter === 'assigned') return displayStatus !== 'unassigned' && !isAcceptedAtHospital(patient);
    if (patientFilter === 'accepted') return isAcceptedAtHospital(patient);
    return true;
  });

  const respondingHospitals = responses
    .filter((response) => response.status === 'responded')
    .map((response) => ({
      ...response,
      hospital: response.hospitals || {},
    }));

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1460px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar
              broadcast={broadcast}
              id={id}
              isActive={isActive}
              lastRefresh={lastRefresh}
              onResolve={handleResolve}
            />

            <div className="mt-4 space-y-4">
              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Broadcast</p>
                    <h1 className="mt-2 text-[1.7rem] font-semibold tracking-tight text-slate-950">{broadcast.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      Track patients, assign hospitals, and coordinate transport from one shared incident view.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <HeaderInfoCard
                      icon={Building2}
                      label="Hospital replies"
                      value={`${broadcast.hospitals_responded}/${broadcast.hospitals_pinged}`}
                      sub="Hospitals that have replied so far"
                    />
                    <HeaderInfoCard
                      icon={Clock3}
                      label="Started"
                      value={timeSince(broadcast.created_at)}
                      sub="Refreshes every 5 seconds"
                    />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-4">
                  <SummaryCard label="Patients" value={patient_stats.total} sub="People logged at this incident" tone="sky" icon={Users} />
                  <SummaryCard
                    label="Assigned"
                    value={assignedWorkflowCount(patient_stats.by_status)}
                    sub="Already matched to a hospital"
                    tone="emerald"
                    icon={ClipboardList}
                  />
                  <SummaryCard label="Waiting" value={patient_stats.by_status.unassigned || 0} sub="Still needs a hospital" tone="amber" icon={AlertTriangle} />
                  <SummaryCard label="Responding hospitals" value={respondingHospitals.length} sub="Currently offering capacity" tone="slate" icon={Building2} />
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)_320px]">
                <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-slate-950">Patients</p>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                          {filteredPatients.length}
                        </span>
                      </div>
                      {patient_stats.by_status.unassigned > 0 && isActive ? (
                        <button
                          type="button"
                          onClick={() => handleAutoDistribute(false)}
                          disabled={actionLoading.auto}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-full bg-slate-950 px-3 text-xs font-medium text-white transition hover:bg-slate-800"
                        >
                          {actionLoading.auto ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                          Auto-assign
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Stacked incident feed for patient matching.</p>
                    <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1">
                      {[
                        ['all', 'All'],
                        ['assigned', 'Assigned'],
                        ['unassigned', 'Unassigned'],
                        ['accepted', 'Accepted'],
                      ].map(([filter, label]) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setPatientFilter(filter)}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                            patientFilter === filter ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredPatients.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500">
                      No patients logged yet.
                      <Link to={`/broadcast/${id}/log`} className="ml-1 font-medium text-sky-600 hover:underline">
                        Open patient log
                      </Link>
                    </div>
                  ) : (
                    <div className="mt-5 max-h-[calc(100vh-360px)] space-y-3 overflow-y-auto pr-1">
                      {filteredPatients.map((patient) => (
                        <PatientCard
                          key={patient.id}
                          patient={patient}
                          isActive={isActive}
                          isSelected={selectedPatient?.id === patient.id}
                          hospitals={respondingHospitals}
                          loadingAssign={actionLoading[`assign_${patient.id}`]}
                          loadingDispatch={actionLoading[`dispatch_${patient.id}`]}
                          onAssign={handleAssign}
                          onDispatch={handleDispatch}
                          onMapAssign={() => setSelectedPatient(patient)}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-[28px] bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-1 pb-4">
                    <div>
                      <p className="text-base font-semibold text-slate-950">Incident map</p>
                      <p className="mt-1 text-sm text-slate-500">Patients, responding hospitals, and live ambulance movement.</p>
                    </div>
                    {selectedPatient && getDisplayStatus(selectedPatient) === 'unassigned' ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700">
                        <Zap size={12} />
                        Assigning {selectedPatient.tag_number}
                      </div>
                    ) : null}
                  </div>

                  <div className="relative mt-4 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-100">
                    <Map
                      ref={mapRef}
                      mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
                      initialViewState={{ latitude: broadcast.lat, longitude: broadcast.lng, zoom: 12 }}
                      style={{ width: '100%', height: 'min(70vh, 780px)' }}
                      mapStyle="mapbox://styles/mapbox/light-v11"
                    >
                      <NavigationControl position="bottom-right" showCompass={false} />

                      <Marker latitude={broadcast.lat} longitude={broadcast.lng} anchor="center">
                        <div className="flex flex-col items-center">
                          <div className="mb-1 rounded-full bg-red-600 px-2 py-1 text-[10px] font-semibold text-white shadow-lg">
                            Incident
                          </div>
                          <div className="relative">
                            <div
                              className="absolute rounded-full"
                              style={{ width: 48, height: 48, top: -18, left: -18, backgroundColor: 'rgba(239,68,68,0.16)', animation: 'incident-pulse 1.6s ease-out infinite' }}
                            />
                            <div style={{ width: 14, height: 14, backgroundColor: '#dc2626', borderRadius: '50%', border: '3px solid white', boxShadow: '0 0 12px rgba(220,38,38,0.3)' }} />
                          </div>
                        </div>
                      </Marker>

                      {respondingHospitals.map((response) => {
                        const hospital = response.hospital;
                        if (!response._hospital_lat) return null;
                        const totalBeds = totalBedsFromResponse(response);
                        return (
                          <Marker key={response.id} latitude={response._hospital_lat} longitude={response._hospital_lng} anchor="center">
                            <button
                              type="button"
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 shadow-md transition hover:border-sky-300 hover:text-sky-700"
                              onClick={() => {
                                if (selectedPatient && getDisplayStatus(selectedPatient) === 'unassigned') handleAssign(selectedPatient.id, hospital.id);
                              }}
                            >
                              {hospital.name?.slice(0, 12) || 'Hospital'} · {totalBeds}
                            </button>
                          </Marker>
                        );
                      })}

                      {patients.filter((patient) => patient.ambulance_lat && currentTransportState(patient)).map((patient) => (
                        <Marker key={`amb-${patient.id}`} latitude={patient.ambulance_lat} longitude={patient.ambulance_lng} anchor="center">
                          <div className="flex flex-col items-center">
                            <div className="mb-1 rounded-full bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white shadow-lg">
                              {patient.tag_number}
                            </div>
                            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-white shadow-lg">
                              <Ambulance size={14} />
                            </div>
                          </div>
                        </Marker>
                      ))}
                    </Map>

                    <style>{`
                      @keyframes incident-pulse {
                        0% { transform: scale(1); opacity: 0.55; }
                        100% { transform: scale(3); opacity: 0; }
                      }
                    `}</style>

                    {selectedPatient && getDisplayStatus(selectedPatient) === 'unassigned' ? (
                      <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 shadow-lg">
                        Click a hospital marker to assign {selectedPatient.tag_number}
                      </div>
                    ) : null}

                    {broadcast.images && broadcast.images.length > 0 ? (
                      <div className="absolute bottom-3 left-3 z-10 flex gap-2">
                        {broadcast.images.map((image, index) => (
                          <div key={index} className="h-16 w-16 overflow-hidden rounded-2xl border border-white/70 bg-white shadow-lg">
                            <img src={image} alt="" className="h-full w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-slate-950">Hospital responses</p>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                        {responses.length}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Live capacity replies from hospitals near the incident.</p>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                    {Object.entries(total_capacity).map(([type, count]) => (
                      <CapacityMiniCard key={type} label={type.replace(/_/g, ' ')} value={count} />
                    ))}
                  </div>

                  {responses.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-500">Waiting for hospitals to respond...</div>
                  ) : (
                    <div className="mt-5 max-h-[calc(100vh-420px)] space-y-3 overflow-y-auto pr-1">
                      {responses.map((response) => (
                        <ResponseCard key={response.id} response={response} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>

      {autoDistPreview ? (
        <AutoDistributeModal
          preview={autoDistPreview}
          loading={actionLoading.auto}
          onClose={() => setAutoDistPreview(null)}
          onConfirm={() => handleAutoDistribute(true)}
        />
      ) : null}
    </div>
  );
}

function TopBar({ broadcast, id, isActive, lastRefresh, onResolve }) {
  return (
    <div className="flex flex-col gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <Radio size={13} className={isActive ? 'text-red-400' : 'text-slate-400'} />
          Broadcast
        </div>
        <span className={`rounded-full px-3 py-2 text-xs font-medium ${isActive ? 'bg-red-500/15 text-red-300' : 'bg-white/[0.06] text-slate-300'}`}>
          {broadcast.status}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/broadcast/${id}/log`}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white/8 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/12"
        >
          Log patient
        </Link>
        {isActive ? (
          <button
            type="button"
            onClick={onResolve}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
          >
            Resolve incident
          </button>
        ) : null}
        <div className="text-right text-xs text-slate-400">
          <p className="font-medium text-slate-300">Updated {lastRefresh ? timeSince(lastRefresh.toISOString()) : '—'}</p>
          <p className="mt-0.5 inline-flex items-center gap-1">
            <RefreshCw size={11} className="animate-spin" style={{ animationDuration: '5s' }} />
            Live
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

function SummaryCard({ label, value, sub, tone, icon }) {
  const IconComponent = icon;
  const tones = {
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
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
          <IconComponent size={16} />
        </div>
      </div>
    </div>
  );
}

function PatientCard({
  patient,
  isActive,
  isSelected,
  hospitals,
  loadingAssign,
  loadingDispatch,
  onAssign,
  onDispatch,
  onMapAssign,
}) {
  const severity = SEVERITY_CONFIG[patient.severity] || SEVERITY_CONFIG.medium;
  const displayStatus = getDisplayStatus(patient);
  const status = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.unassigned;
  const handshake = patient._handshake_status ? HANDSHAKE_CONFIG[patient._handshake_status] : null;
  const transportState = currentTransportState(patient);
  const transport = transportState ? TRANSPORT_STATUS_CONFIG[transportState] : null;
  const ambulanceLabel = patient._ambulance?.vehicle_id || patient._ambulance?.plate_number || null;
  const showDispatchButton = canStartRealDispatch(patient) && isActive;
  const isReadOnly = isAcceptedAtHospital(patient);
  const destinationLabel = patient.hospitals?.name || 'Not assigned';
  const transportSummary = transport ? transport.label : null;

  return (
    <article
      aria-label={`Patient ${patient.tag_number}`}
      className={`rounded-[20px] border px-3.5 py-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition ${
      isSelected ? 'border-sky-300 bg-[linear-gradient(180deg,rgba(240,249,255,0.92),rgba(255,255,255,1))]' : 'border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(248,250,252,0.98))]'
    }`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${severity.dot}`} />
        <p className="font-mono text-[15px] font-semibold tracking-tight text-slate-950">{patient.tag_number}</p>
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur ${severity.badge}`}>
          {severity.label}
        </span>
        <span className={`ml-auto inline-flex rounded-full bg-slate-900/[0.03] px-2 py-0.5 text-[10px] font-semibold ${status.text}`}>{status.label}</span>
      </div>

      {patient.condition_notes ? (
        <p className="mt-2.5 text-[13px] leading-5 text-slate-700">{patient.condition_notes}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200/70 pt-3">
        <MetaPill icon={<Building2 size={13} className="shrink-0 text-slate-400" />} text={destinationLabel} />
        {handshake ? (
          <MetaPill
            icon={<ClipboardList size={13} className="shrink-0 text-slate-400" />}
            text={handshake.label}
            accentClass={handshake.text}
            trailing={patient._transfer_code ? <span className="font-mono text-[11px] text-slate-700">{patient._transfer_code}</span> : null}
          />
        ) : null}
        {transportSummary ? <MetaPill icon={<MapPin size={13} className="shrink-0 text-slate-400" />} text={transportSummary} /> : null}
        {ambulanceLabel ? <MetaPill icon={<Ambulance size={13} className="shrink-0 text-slate-400" />} text={ambulanceLabel} /> : null}
        {transportState === 'hospital_accepted' && patient._transport_contact_phone ? (
          <MetaPill icon={<PhoneIcon />} text={patient._transport_contact_phone} />
        ) : null}
      </div>

      {patient._hold_remaining_sec > 0 ? (
        <p className="mt-2.5 text-[11px] font-medium text-sky-700">
          Hold time left: {Math.floor(patient._hold_remaining_sec / 60)}:{String(patient._hold_remaining_sec % 60).padStart(2, '0')}
        </p>
      ) : null}

      {patient._declined_reason ? (
        <p className="mt-2 text-[11px] text-slate-500">{patient._declined_reason}</p>
      ) : null}
      {patient._crew_note ? <p className="mt-2 text-[11px] text-slate-500">{patient._crew_note}</p> : null}

      {isReadOnly ? (
        <p className="mt-2.5 text-[11px] font-medium text-emerald-700">Read-only on broadcast board.</p>
      ) : null}

      {showDispatchButton ? (
        <button
          type="button"
          onClick={() => onDispatch(patient.id)}
          disabled={loadingDispatch}
          aria-label={`Dispatch ambulance for ${patient.tag_number}`}
          className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-[12px] bg-slate-950 px-4 text-sm font-medium text-white shadow-[0_10px_24px_rgba(15,23,42,0.14)] transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loadingDispatch ? <Loader2 size={14} className="animate-spin" /> : <Ambulance size={14} />}
          Dispatch ambulance
        </button>
      ) : null}

      {displayStatus === 'unassigned' && isActive && hospitals.length > 0 ? (
        <QuickAssignDropdown
          hospitals={hospitals}
          loading={loadingAssign}
          onAssign={(hospitalId) => onAssign(patient.id, hospitalId)}
          onMapAssign={onMapAssign}
        />
      ) : null}
    </article>
  );
}

function MetaPill({ icon, text, trailing = null, accentClass = 'text-slate-700' }) {
  return (
    <div className="inline-flex min-h-[30px] items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 text-[12px] text-slate-600">
      {icon}
      <span className={`truncate ${accentClass}`}>{text}</span>
      {trailing}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[14px] w-[14px] shrink-0 text-slate-400"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.61 2.62a2 2 0 0 1-.45 2.11L8 9.91a16 16 0 0 0 6.09 6.09l1.46-1.27a2 2 0 0 1 2.11-.45c.84.28 1.72.49 2.62.61A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function QuickAssignDropdown({ hospitals, loading, onAssign, onMapAssign }) {
  const [open, setOpen] = useState(false);
  const sorted = [...hospitals].sort((a, b) => totalBedsFromResponse(b) - totalBedsFromResponse(a));

  if (!open) {
    return (
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-2 rounded-full bg-slate-950 px-3 text-xs font-medium text-white transition hover:bg-slate-800"
        >
          <Zap size={12} />
          Assign
        </button>
        <button
          type="button"
          onClick={onMapAssign}
          className="inline-flex min-h-[38px] items-center justify-center rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Map
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <p className="text-xs font-medium text-slate-500">Choose a hospital</p>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-400 transition hover:text-slate-700">
          <X size={12} />
        </button>
      </div>
      <div className="max-h-44 overflow-y-auto">
        {sorted.map((response) => {
          const hospital = response.hospital || {};
          const totalBeds = totalBedsFromResponse(response);
          return (
            <button
              key={response.id}
              type="button"
              onClick={() => {
                onAssign(hospital.id);
                setOpen(false);
              }}
              disabled={loading}
              className="w-full border-b border-slate-200 px-3 py-3 text-left transition hover:bg-white last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-950">{hospital.name || 'Unknown hospital'}</p>
                <span className="text-xs font-medium text-slate-500">{response._distance ? `${response._distance}km` : `${totalBeds} beds`}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{bedSummary(response).join(' · ') || 'No beds reported'}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CapacityMiniCard({ label, value }) {
  return (
    <div className="rounded-[18px] border border-slate-100 bg-slate-50/80 px-3 py-3 text-center">
      <p className={`text-lg font-semibold ${value > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">{label}</p>
    </div>
  );
}

function ResponseCard({ response }) {
  const hospital = response.hospitals || {};
  const declined = response.status === 'declined';
  const beds = bedSummary(response);

  return (
    <div className={`rounded-[24px] border px-4 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.04)] ${
      declined ? 'border-slate-100 bg-slate-50/70' : 'border-slate-100 bg-white'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-950">{hospital.name || 'Unknown hospital'}</p>
          <p className="mt-1 text-xs text-slate-500">{response._distance ? `${response._distance}km away` : 'Distance unavailable'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${declined ? 'bg-slate-200 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
          {declined ? 'Unable to help' : 'Responded'}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-500">
        {declined ? 'This hospital could not take more patients right now.' : (beds.join(' · ') || 'No available beds reported')}
      </p>
    </div>
  );
}

function AutoDistributeModal({ preview, loading, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Preview</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">Auto-assign patients</h3>
          <p className="mt-1 text-sm text-slate-500">
            {preview.assigned_count} of {preview.assignments?.length} patients can be assigned.
          </p>
        </div>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto p-5">
          {preview.assignments?.map((assignment, index) => {
            const severity = SEVERITY_CONFIG[assignment.severity] || SEVERITY_CONFIG.medium;
            return (
              <div key={index} className="flex items-center justify-between rounded-[20px] border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${severity.dot}`} />
                  <span className="font-mono text-sm font-semibold text-slate-950">{assignment.tag_number}</span>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${severity.badge}`}>
                    {severity.label}
                  </span>
                </div>
                <p className={`text-sm font-medium ${assignment.hospital_id ? 'text-sky-700' : 'text-red-600'}`}>
                  {assignment.hospital_id ? assignment.hospital_name : 'No match found'}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Confirm ({preview.assigned_count})
          </button>
        </div>
      </div>
    </div>
  );
}
