import { useState, useCallback, useRef } from 'react';
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import './popup-overrides.css';
import useHospitals from '../../hooks/useHospitals';
import HospitalMarker from './HospitalMarker';
import HospitalCard from './HospitalCard';
import SearchPanel from './SearchPanel';
import WelcomeCard from './WelcomeCard';
import TimeSlider from './TimeSlider';
import MapLegend from './MapLegend';

const LAGOS = { latitude: 6.5244, longitude: 3.3792 };

export default function PulseMap() {
  const { hospitals, loading, error } = useHospitals();
  const [selected, setSelected] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const mapRef = useRef(null);

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
    // Fly to first result
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
    mapRef.current?.flyTo({
      center: [LAGOS.longitude, LAGOS.latitude],
      zoom: 11,
      duration: 800,
    });
  }, []);

  // Determine which hospitals are highlighted by search
  const highlightedIds = searchResults
    ? new Set(searchResults.map((r) => r.hospital_id))
    : null;

  return (
    <div className="w-full h-screen flex relative overflow-hidden">
      {/* ── Left Panel ─────────────────────────────────── */}
      <SearchPanel
        onResults={handleSearchResults}
        onClear={clearSearch}
        searchResults={searchResults}
        hospitals={hospitals}
        onHospitalSelect={handleMarkerClick}
      />

      {/* ── Map ────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {/* Loading */}
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0f1a]/90">
            <div className="text-center">
              <div className="relative w-12 h-12 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
                <div className="absolute inset-2 rounded-full bg-cyan-400/10 animate-pulse" />
              </div>
              <p className="text-cyan-300/80 text-sm font-light tracking-wide">Loading hospitals...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-red-500/90 text-white px-5 py-2.5 rounded-lg text-sm backdrop-blur-sm">
            {error}
          </div>
        )}

        <Map
          ref={mapRef}
          mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          initialViewState={{ ...LAGOS, zoom: 11 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
        >
          <NavigationControl position="bottom-right" showCompass={false} />

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

          {selected && (
            <Popup
              latitude={selected.lat}
              longitude={selected.lng}
              anchor="bottom"
              onClose={() => setSelected(null)}
              closeButton={true}
              closeOnClick={false}
              maxWidth="340px"
              offset={20}
            >
              <HospitalCard hospital={selected} />
            </Popup>
          )}
        </Map>

        {/* Title */}
        <div className="absolute top-5 left-5 z-10 pointer-events-none">
          <h1 className="text-white text-xl font-bold tracking-tight flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-pulse" />
            BedSignal
            <span className="text-cyan-400 font-light">Pulse</span>
          </h1>
          <p className="text-gray-500 text-[10px] mt-0.5 tracking-wider uppercase">
            Real-time hospital bed availability · Lagos
          </p>
        </div>

        {/* Legend */}
        <MapLegend />

        {/* Time Slider */}
        <TimeSlider onPredictionsChange={setPredictions} />

        {/* Hospital count */}
        <div className="absolute bottom-6 left-5 z-10 bg-[#0d1320]/80 backdrop-blur-sm text-gray-400 px-3 py-1.5 rounded-full text-xs flex items-center gap-2 border border-gray-800/50">
          <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
          {hospitals.length} hospitals live
        </div>

        {/* Welcome Card */}
        {showWelcome && !loading && (
          <WelcomeCard onDismiss={() => setShowWelcome(false)} />
        )}
      </div>
    </div>
  );
}