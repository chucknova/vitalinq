import { useState, useCallback, useRef, useEffect } from 'react';
import Map, { Marker, Popup, NavigationControl, Source, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import useHospitals from '../../hooks/useHospitals';
import HospitalMarker from './HospitalMarker';
import HospitalCard from './HospitalCard';
import SearchPanel from './SearchPanel';
import WelcomeCard from './WelcomeCard';
import './popup-overrides.css';

const LAGOS = { latitude: 6.5244, longitude: 3.3792 };

export default function PulseMap() {
  const { hospitals, loading, error } = useHospitals();
  const [selected, setSelected] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const mapRef = useRef(null);

  // ── Route tracking state ───────────────────────────
  const [tracking, setTracking] = useState(null); // { hospitalLat, hospitalLng, hospitalName }
  const [userPosition, setUserPosition] = useState(null); // { lat, lng }
  const [routeGeoJSON, setRouteGeoJSON] = useState(null);
  const watchRef = useRef(null);

  const handleMarkerClick = useCallback((hospital) => {
    setSelected(hospital);
    mapRef.current?.flyTo({
      center: [hospital.lng, hospital.lat],
      zoom: 14,
      duration: 800,
    });
  }, []);

  const handleSearchResults = useCallback((results) => {
    setSearchResults(results);
    setSelected(null);
    if (results && results.length > 0) {
      const first = results[0];
      const h = hospitals.find((h) => h.id === first.hospital_id);
      if (h) {
        mapRef.current?.flyTo({
          center: [h.lng, h.lat],
          zoom: 13,
          duration: 1000,
        });
      }
    }
  }, [hospitals]);

  const clearSearch = useCallback(() => {
    setSearchResults(null);
    setTracking(null);
    setRouteGeoJSON(null);
    setUserPosition(null);
    if (watchRef.current) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    mapRef.current?.flyTo({
      center: [LAGOS.longitude, LAGOS.latitude],
      zoom: 11,
      duration: 800,
    });
  }, []);

  // ── Fetch route from Mapbox ────────────────────────
  const fetchRoute = useCallback(async (from, to) => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    try {
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/` +
        `${from.lng},${from.lat};${to.lng},${to.lat}` +
        `?geometries=geojson&overview=full&access_token=${token}`
      );
      const data = await res.json();
      if (data.routes && data.routes[0]) {
        setRouteGeoJSON({
          type: 'Feature',
          geometry: data.routes[0].geometry,
          properties: {
            duration: Math.round(data.routes[0].duration / 60),
            distance: (data.routes[0].distance / 1000).toFixed(1),
          },
        });
      }
    } catch (err) {
      console.error('Route fetch failed:', err);
    }
  }, []);

  // ── Start tracking when SearchPanel activates it ───
  const handleStartTracking = useCallback((hospitalData) => {
    setTracking(hospitalData);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const uPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPosition(uPos);
        fetchRoute(uPos, hospitalData);

        const bounds = [
          [Math.min(uPos.lng, hospitalData.lng) - 0.01, Math.min(uPos.lat, hospitalData.lat) - 0.01],
          [Math.max(uPos.lng, hospitalData.lng) + 0.01, Math.max(uPos.lat, hospitalData.lat) + 0.01],
        ];
        mapRef.current?.fitBounds(bounds, { padding: { top: 110, bottom: 110, left: 520, right: 110 }, duration: 1200 });
      },
      () => {
        const fallback = { lat: 6.5244, lng: 3.3792 };
        setUserPosition(fallback);
        fetchRoute(fallback, hospitalData);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }, [fetchRoute]);

  // Cleanup watch on unmount
  useEffect(() => {
    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // Determine which hospitals are highlighted by search
  const highlightedIds = searchResults
    ? new Set(searchResults.map((r) => r.hospital_id))
    : null;

  // Route layer style
  const routeLayer = {
    id: 'route',
    type: 'line',
    paint: {
      'line-color': '#06b6d4',
      'line-width': 4,
      'line-opacity': 0.8,
    },
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
  };

  const routeGlowLayer = {
    id: 'route-glow',
    type: 'line',
    paint: {
      'line-color': '#06b6d4',
      'line-width': 12,
      'line-opacity': 0.15,
    },
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
  };

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#0d1522] p-5">
      {/* ── Left Panel ─────────────────────────────────── */}
      <SearchPanel
        onResults={handleSearchResults}
        onClear={clearSearch}
        searchResults={searchResults}
        hospitals={hospitals}
        onHospitalSelect={handleMarkerClick}
        onStartTracking={handleStartTracking}
      />

      {/* ── Map ────────────────────────────────────────── */}
      <div className="relative ml-5 flex-1 overflow-hidden rounded-[2rem] border border-white/[0.06] bg-[#0b1420] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        {/* Loading */}
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#050914]/80 backdrop-blur-sm">
            <div className="text-center">
              <div className="relative w-12 h-12 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full border-2 border-sky-400/30" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-sky-400 animate-spin" />
                <div className="absolute inset-2 rounded-full bg-sky-400/10 animate-pulse" />
              </div>
              <p className="text-sm tracking-wide text-sky-100/80">Loading nearby hospitals...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-red-600 px-5 py-2.5 text-sm text-white shadow-lg">
            {error}
          </div>
        )}

        <Map
          ref={mapRef}
          mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          initialViewState={{ ...LAGOS, zoom: 11 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/standard"
        >
          <NavigationControl position="bottom-right" showCompass={false} />

          {/* Hospital markers */}
          {hospitals.map((h) => {
            const dimmed = highlightedIds && !highlightedIds.has(h.id);
            const rank = searchResults
              ? searchResults.findIndex((r) => r.hospital_id === h.id) + 1
              : null;

            return (
              <Marker
                key={h.id}
                latitude={h.lat}
                longitude={h.lng}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handleMarkerClick(h);
                }}
              >
                <HospitalMarker
                  hospital={h}
                  dimmed={dimmed}
                  rank={rank > 0 ? rank : null}
                />
              </Marker>
            );
          })}

          {/* ── Route line ─────────────────────────────── */}
          {routeGeoJSON && (
            <Source id="route" type="geojson" data={routeGeoJSON}>
              <Layer {...routeGlowLayer} />
              <Layer {...routeLayer} />
            </Source>
          )}

          {/* ── User position marker (blue pulsing dot) ── */}
          {userPosition && tracking && (
            <Marker
              latitude={userPosition.lat}
              longitude={userPosition.lng}
              anchor="center"
            >
              <div className="relative">
                {/* Pulse ring */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: 36, height: 36, top: -12, left: -12,
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    animation: 'user-pulse 2s ease-out infinite',
                  }}
                />
                {/* Dot */}
                <div
                  style={{
                    width: 14, height: 14,
                    backgroundColor: '#3b82f6',
                    borderRadius: '50%',
                    border: '3px solid white',
                    boxShadow: '0 0 8px rgba(59,130,246,0.6)',
                  }}
                />
              </div>
            </Marker>
          )}

          {/* ── Destination marker (flag) ──────────────── */}
          {tracking && (
            <Marker
              latitude={tracking.lat}
              longitude={tracking.lng}
              anchor="bottom"
            >
              <div className="flex flex-col items-center">
                <div className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-lg shadow-emerald-500/30 max-w-[140px] truncate">
                  {tracking.name}
                </div>
                <div
                  style={{
                    width: 0, height: 0,
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '6px solid #10b981',
                  }}
                />
                <div
                  className="mt-0.5"
                  style={{
                    width: 8, height: 8,
                    backgroundColor: '#10b981',
                    borderRadius: '50%',
                    boxShadow: '0 0 6px rgba(16,185,129,0.5)',
                  }}
                />
              </div>
            </Marker>
          )}

          {selected && (
            <Popup
              latitude={selected.lat}
              longitude={selected.lng}
              anchor="bottom"
              onClose={() => setSelected(null)}
              closeButton={false}
              closeOnClick={false}
              maxWidth="0px"
              offset={20}
            >
              <div />
            </Popup>
          )}
        </Map>

        {/* Hospital detail card */}
        {selected && (
              <div className="absolute top-6 right-6 z-20 animate-slide-in">
            <HospitalCard hospital={selected} onClose={() => setSelected(null)} />
          </div>
        )}

        <style>{`
          @keyframes slide-in {
            from { opacity: 0; transform: translateX(20px); }
            to { opacity: 1; transform: translateX(0); }
          }
          .animate-slide-in {
            animation: slide-in 0.25s ease-out both;
          }
          @keyframes user-pulse {
            0% { transform: scale(1); opacity: 0.4; }
            100% { transform: scale(2.5); opacity: 0; }
          }
        `}</style>

        {/* Route info bar */}
        {/* {routeGeoJSON && tracking && (
          <div className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-4 rounded-[1.4rem] border border-sky-500/20 bg-[#0b1422]/92 px-5 py-3 shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#3b82f6', border: '2px solid white' }} />
              <span className="text-xs text-slate-400">You</span>
            </div>
            <div className="text-xs text-slate-600">→</div>
            <div className="flex items-center gap-2">
              <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#10b981' }} />
              <span className="max-w-[150px] truncate text-xs font-medium text-white">{tracking.name}</span>
            </div>
            <div className="flex items-center gap-3 border-l border-white/[0.08] pl-4">
              <span className="text-sm font-bold text-sky-300">{routeGeoJSON.properties.duration} min</span>
              <span className="text-xs text-slate-400">{routeGeoJSON.properties.distance} km</span>
            </div>
          </div>
        )} */}

        {/* Title — hide when tracking */}
        {!tracking && (
          <div className="pointer-events-none absolute left-6 top-6 z-10">
            <div className="inline-flex rounded-full border border-white/[0.08] bg-[#0b1422]/88 px-3 py-1.5 shadow-sm backdrop-blur-sm">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-sky-300/80">Live map</p>
            </div>
            <h1 className="mt-3 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              BedSignal Pulse
            </h1>
            <p className="mt-1 text-xs tracking-wide text-slate-400">
              Real-time hospital availability around Lagos
            </p>
          </div>
        )}

        {/* {!selected && !tracking && <MapLegend />} */}

        {/* <TimeSlider onPredictionsChange={() => undefined} /> */}

        <div className="absolute bottom-6 left-6 z-10 flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#0b1422]/88 px-3 py-1.5 text-xs text-slate-300 shadow-sm backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            {hospitals.length} hospitals live
          </div>
          <a
            href="/broadcast"
            className="flex items-center gap-1.5 rounded-full border border-red-500/20 bg-[#0b1422]/88 px-3 py-1.5 text-xs text-red-300 shadow-sm backdrop-blur-sm transition-all hover:bg-red-500/10"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Broadcasts
          </a>
          <a
            href="/dispatch/lasema"
            className="flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-[#0b1422]/88 px-3 py-1.5 text-xs text-blue-300 shadow-sm backdrop-blur-sm transition-all hover:bg-blue-500/10"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Dispatch
          </a>
        </div>

        {/* {showWelcome && !loading && !tracking && (
          <WelcomeCard onDismiss={() => setShowWelcome(false)} />
        )} */}
      </div>
    </div>
  );
}