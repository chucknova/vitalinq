/**
 * AmbulanceTracker — mobile page for the ambulance driver.
 *
 * Route: /ambulance/:patientId
 * Shows: patient info, destination hospital, route map, GPS tracking.
 * Sends position updates every 10 seconds.
 * "Arrived" button when they reach the hospital.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Map, { Marker, NavigationControl, Source, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Navigation, Check, Loader2, AlertTriangle, MapPin
} from 'lucide-react';
import api from '../lib/api';

export default function AmbulanceTracker() {
  const { patientId } = useParams();
  const [patient, setPatient] = useState(null);
  const [hospital, setHospital] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userPos, setUserPos] = useState(null);
  const [route, setRoute] = useState(null);
  const [arrived, setArrived] = useState(false);
  const [arriving, setArriving] = useState(false);
  const mapRef = useRef(null);
  const watchRef = useRef(null);
  const posIntervalRef = useRef(null);

  // Fetch patient data
  useEffect(() => {
    (async () => {
      try {
        // We need a simple endpoint to get patient + hospital info
        // For now, use the broadcast endpoint and find the patient
        const res = await api.get(`/api/broadcast/patients/${patientId}`);
        setPatient(res.data.patient);
        setHospital(res.data.hospital);

        if (res.data.patient.status === 'arrived') {
          setArrived(true);
        }
      } catch (err) {
        setError('Patient not found.');
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId]);

  // Start GPS tracking + position updates
  useEffect(() => {
    if (!hospital || arrived) return;

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        fetchRoute(p, hospital);

        // Fit map to show both points
        if (mapRef.current) {
          const bounds = [
            [Math.min(p.lng, hospital.lng) - 0.01, Math.min(p.lat, hospital.lat) - 0.01],
            [Math.max(p.lng, hospital.lng) + 0.01, Math.max(p.lat, hospital.lat) + 0.01],
          ];
          mapRef.current.fitBounds(bounds, { padding: 60, duration: 1000 });
        }
      },
      () => {
        // Fallback — use patient's last known ambulance position
        if (patient?.ambulance_lat) {
          setUserPos({ lat: patient.ambulance_lat, lng: patient.ambulance_lng });
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    // Watch position
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    // Send position to server every 10 seconds
    posIntervalRef.current = setInterval(async () => {
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        );
        await api.patch(`/api/broadcast/patients/${patientId}/position`, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      } catch (_) {}
    }, 10000);

    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      if (posIntervalRef.current) clearInterval(posIntervalRef.current);
    };
  }, [hospital, arrived]);

  async function fetchRoute(from, to) {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    try {
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${from.lng},${from.lat};${to.lng},${to.lat}?geometries=geojson&overview=full&access_token=${token}`
      );
      const data = await res.json();
      if (data.routes?.[0]) {
        setRoute({
          type: 'Feature',
          geometry: data.routes[0].geometry,
          properties: {
            duration: Math.round(data.routes[0].duration / 60),
            distance: (data.routes[0].distance / 1000).toFixed(1),
          },
        });
      }
    } catch (_) {}
  }

  async function handleArrived() {
    setArriving(true);
    try {
      await api.patch(`/api/broadcast/patients/${patientId}/position`, {
        lat: hospital.lat,
        lng: hospital.lng,
      });
      setArrived(true);
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      if (posIntervalRef.current) clearInterval(posIntervalRef.current);
    } catch (_) {
      setError('Failed to confirm arrival.');
    } finally {
      setArriving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <Loader2 size={24} className="text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-6">
        <div className="text-center">
          <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white">{error || 'Not found'}</p>
        </div>
      </div>
    );
  }

  const sevConfig = {
    critical: { emoji: '🔴', color: 'text-red-400' },
    high: { emoji: '🟠', color: 'text-amber-400' },
    medium: { emoji: '🟡', color: 'text-yellow-400' },
    low: { emoji: '🟢', color: 'text-green-400' },
  };
  const sev = sevConfig[patient.severity] || sevConfig.medium;

  return (
    <div className="h-screen bg-[#0a0f1a] flex flex-col">
      {/* Map */}
      <div className="flex-1 relative">
        <Map
          ref={mapRef}
          mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          initialViewState={{ latitude: hospital?.lat || 6.5244, longitude: hospital?.lng || 3.3792, zoom: 13 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
        >
          <NavigationControl position="bottom-right" showCompass={false} />

          {/* Route line */}
          {route && (
            <Source id="route" type="geojson" data={route}>
              <Layer id="route-glow" type="line" paint={{ 'line-color': '#3b82f6', 'line-width': 10, 'line-opacity': 0.15 }} layout={{ 'line-join': 'round', 'line-cap': 'round' }} />
              <Layer id="route-line" type="line" paint={{ 'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 0.8 }} layout={{ 'line-join': 'round', 'line-cap': 'round' }} />
            </Source>
          )}

          {/* User/ambulance position */}
          {userPos && (
            <Marker latitude={userPos.lat} longitude={userPos.lng} anchor="center">
              <div className="relative">
                <div className="absolute rounded-full" style={{ width: 36, height: 36, top: -12, left: -12, backgroundColor: 'rgba(59,130,246,0.15)', animation: 'amb-pulse 2s ease-out infinite' }} />
                <div style={{ width: 14, height: 14, backgroundColor: '#3b82f6', borderRadius: '50%', border: '3px solid white', boxShadow: '0 0 8px rgba(59,130,246,0.6)' }} />
              </div>
            </Marker>
          )}

          {/* Hospital destination */}
          {hospital && (
            <Marker latitude={hospital.lat} longitude={hospital.lng} anchor="bottom">
              <div className="flex flex-col items-center">
                <div className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-lg shadow-emerald-500/30 max-w-[140px] truncate">
                  {hospital.name}
                </div>
                <div style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '6px solid #10b981' }} />
                <div className="mt-0.5" style={{ width: 8, height: 8, backgroundColor: '#10b981', borderRadius: '50%', boxShadow: '0 0 6px rgba(16,185,129,0.5)' }} />
              </div>
            </Marker>
          )}
        </Map>

        {/* Route info bar */}
        {route && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-[#0d1320]/90 backdrop-blur-sm border border-blue-500/30 rounded-xl px-5 py-3 flex items-center gap-4">
            <span className="text-blue-400 text-sm font-bold">{route.properties.duration} min</span>
            <span className="text-gray-500 text-xs">{route.properties.distance} km</span>
          </div>
        )}

        <style>{`
          @keyframes amb-pulse { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(2.5); opacity: 0; } }
        `}</style>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-gray-800/50 p-4 bg-[#0d1320]">
        {/* Patient info */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-white font-mono font-bold text-lg">{patient.tag_number}</span>
            <span className={`text-sm font-bold ${sev.color}`}>{sev.emoji} {patient.severity.toUpperCase()}</span>
          </div>
          {hospital && (
            <a
              href={`https://maps.google.com/maps?daddr=${hospital.lat},${hospital.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
            >
              <Navigation size={12} /> Google Maps
            </a>
          )}
        </div>

        {patient.condition_notes && (
          <p className="text-gray-400 text-sm mb-3">{patient.condition_notes}</p>
        )}

        {hospital && (
          <p className="text-gray-500 text-xs mb-3 flex items-center gap-1">
            <MapPin size={10} /> {hospital.name} — {hospital.address || 'Address not available'}
          </p>
        )}

        {/* Arrived button */}
        {arrived ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
            <Check size={24} className="text-emerald-400 mx-auto mb-1" />
            <p className="text-emerald-400 text-sm font-semibold">Arrived at {hospital?.name}</p>
            <p className="text-gray-500 text-xs mt-1">Patient delivered. Thank you.</p>
          </div>
        ) : (
          <button
            onClick={handleArrived}
            disabled={arriving}
            className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-700 text-white text-base font-semibold py-4 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {arriving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            Confirm Arrival
          </button>
        )}
      </div>
    </div>
  );
}