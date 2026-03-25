/**
 * BroadcastNew — dispatcher triggers a new emergency broadcast.
 *
 * Route: /broadcast/new
 * Form: title, click-on-map for location, radius, expected patients, description.
 * On submit: creates broadcast, shows how many hospitals were pinged, navigates to dashboard.
 */

import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Map, { Marker, NavigationControl, Source, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Radio, MapPin, Users, FileText, Loader2, AlertTriangle, Camera, X
} from 'lucide-react';
import api from '../lib/api';

const LAGOS = { latitude: 6.5244, longitude: 3.3792, zoom: 11 };

export default function BroadcastNew() {
  const navigate = useNavigate();
  const mapRef = useRef(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedPatients, setExpectedPatients] = useState(10);
  const [radius, setRadius] = useState(10);
  const [pin, setPin] = useState(null); // { lat, lng, label? }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [addressInput, setAddressInput] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [images, setImages] = useState([]); // { file, preview }
  const debounceRef = useRef(null);

  // Click on map to set incident location
  const handleMapClick = useCallback((e) => {
    setPin({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  }, []);

  // Geocode a typed address using Mapbox Geocoding API
  async function geocodeAddress() {
    if (!addressInput.trim()) return;
    setGeocoding(true);
    setError(null);

    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      const query = encodeURIComponent(addressInput.trim() + ', Lagos, Nigeria');
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1`
      );
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const placeName = data.features[0].place_name || addressInput;
        const newPin = { lat, lng, label: placeName.split(',')[0] };
        setPin(newPin);
        setAddressInput('');
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 800 });
      } else {
        setError('Location not found. Try a more specific address or click on the map.');
      }
    } catch (err) {
      setError('Geocoding failed. Click on the map instead.');
    } finally {
      setGeocoding(false);
    }
  }

  // Autocomplete — search as user types (debounced 300ms)
  function handleAddressChange(value) {
    setAddressInput(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        const query = encodeURIComponent(value.trim());
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json` +
          `?access_token=${token}&limit=5&country=NG&proximity=3.3792,6.5244&types=place,locality,neighborhood,address,poi`
        );
        const data = await res.json();
        if (data.features) {
          setSuggestions(data.features.map(f => ({
            name: f.place_name,
            short: f.text + (f.context?.[0]?.text ? `, ${f.context[0].text}` : ''),
            lat: f.center[1],
            lng: f.center[0],
          })));
        }
      } catch (_) {
        // Silent fail — suggestions are optional
      }
    }, 300);
  }

  function selectSuggestion(s) {
    const newPin = { lat: s.lat, lng: s.lng, label: s.short };
    setPin(newPin);
    setAddressInput('');
    setSuggestions([]);
    mapRef.current?.flyTo({ center: [s.lng, s.lat], zoom: 14, duration: 800 });
  }

  // Radius circle GeoJSON
  const radiusCircle = pin ? {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [pin.lng, pin.lat],
    },
    properties: { radius: radius * 1000 }, // meters
  } : null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!pin) {
      setError('Click on the map to set the incident location.');
      return;
    }
    if (!title.trim()) {
      setError('Please enter an incident title.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Convert images to base64 for storage
      const imageUrls = [];
      for (const img of images) {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(img.file);
        });
        imageUrls.push(base64);
      }

      const res = await api.post('/api/broadcast', {
        title: title.trim(),
        description: description.trim(),
        lat: pin.lat,
        lng: pin.lng,
        radius_km: radius,
        expected_patients: expectedPatients,
        images: imageUrls,
      });

      navigate(`/broadcast/${res.data.broadcast_id}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create broadcast.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex">
      {/* Left: Form */}
      <div className="w-[420px] flex flex-col border-r border-gray-800/50">
        {/* Header */}
        <div className="p-5 pb-3 border-b border-gray-800/50">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-white text-base font-semibold flex items-center gap-2">
                <Radio size={16} className="text-red-400" />
                Emergency Broadcast
              </h1>
              <p className="text-gray-500 text-xs mt-0.5">Alert all hospitals in the area</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}

          {/* Incident title */}
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block flex items-center gap-1.5">
              <AlertTriangle size={11} />
              Incident title *
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Bus accident at Ojuelegba"
              required
              className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-500/50 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block flex items-center gap-1.5">
              <FileText size={11} />
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Details about the incident..."
              rows={2}
              className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-red-500/50 transition-all"
            />
          </div>

          {/* Evidence photos */}
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block flex items-center gap-1.5">
              <Camera size={11} />
              Evidence photos <span className="text-gray-600">(optional)</span>
            </label>

            {/* Image previews */}
            {images.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {images.map((img, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-700/50">
                    <img src={img.preview} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 text-gray-300 hover:text-white transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload button */}
            {images.length < 4 && (
              <label className="flex items-center justify-center gap-1.5 w-full bg-[#151d2e] hover:bg-[#1a2435] border border-gray-700/50 border-dashed rounded-lg py-2.5 cursor-pointer transition-all">
                <Camera size={14} className="text-gray-500" />
                <span className="text-gray-500 text-xs">
                  {images.length === 0 ? 'Add photos from scene' : 'Add another photo'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    const newImages = files.slice(0, 4 - images.length).map(file => ({
                      file,
                      preview: URL.createObjectURL(file),
                    }));
                    setImages(prev => [...prev, ...newImages].slice(0, 4));
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            <p className="text-gray-600 text-[10px] mt-1">Up to 4 photos. Shared with responding hospitals.</p>
          </div>

          {/* Location */}
          <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
            <p className="text-red-400 text-xs font-medium flex items-center gap-1.5 mb-2">
              <MapPin size={11} />
              Incident location *
            </p>

            {pin ? (
              /* Location is set — show it */
              <div className="flex items-center justify-between">
                <p className="text-gray-300 text-xs">
                  📍 {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                  {pin.label && <span className="text-gray-500 ml-1">({pin.label})</span>}
                </p>
                <button
                  type="button"
                  onClick={() => setPin(null)}
                  className="text-gray-500 hover:text-red-400 text-[10px] transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              /* No location — show three options */
              <div className="space-y-2">
                {/* Option 1: Click on map */}
                <p className="text-gray-500 text-[10px]">Click on the map, or:</p>

                {/* Option 2: Use my location */}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const pos = await new Promise((resolve, reject) =>
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
                      );
                      const newPin = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'My location' };
                      setPin(newPin);
                      mapRef.current?.flyTo({ center: [newPin.lng, newPin.lat], zoom: 14, duration: 800 });
                    } catch (_) {
                      setError('Could not get your location. Please click on the map instead.');
                    }
                  }}
                  className="w-full bg-[#151d2e] hover:bg-[#1a2435] border border-gray-700/50 text-gray-300 text-xs py-2 rounded-lg transition-all flex items-center justify-center gap-1.5"
                >
                  <MapPin size={12} />
                  Use my current location
                </button>

                {/* Option 3: Type address with autocomplete */}
                <div className="relative">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={addressInput}
                      onChange={e => handleAddressChange(e.target.value)}
                      placeholder="Type location e.g. Ojuelegba, Lagos"
                      className="flex-1 bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-500/50 transition-all"
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); geocodeAddress(); }
                        if (e.key === 'Escape') setSuggestions([]);
                      }}
                      onBlur={() => setTimeout(() => setSuggestions([]), 200)}
                    />
                    <button
                      type="button"
                      onClick={geocodeAddress}
                      disabled={!addressInput.trim() || geocoding}
                      className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-xs font-medium px-3 rounded-lg transition-all flex items-center gap-1 disabled:opacity-40"
                    >
                      {geocoding ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                    </button>
                  </div>

                  {/* Suggestions dropdown */}
                  {suggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-[#1a2435] border border-gray-700/50 rounded-lg shadow-xl z-30 py-1 max-h-48 overflow-y-auto">
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => selectSuggestion(s)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-700/50 transition-colors flex items-start gap-2"
                        >
                          <MapPin size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-gray-200 text-xs">{s.short}</p>
                            <p className="text-gray-600 text-[10px] truncate">{s.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Radius */}
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block">
              Alert radius: <span className="text-white font-medium">{radius} km</span>
            </label>
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={radius}
              onChange={e => setRadius(Number(e.target.value))}
              className="w-full accent-red-500"
            />
            <div className="flex justify-between text-[10px] text-gray-600">
              <span>2 km</span>
              <span>30 km</span>
            </div>
          </div>

          {/* Expected patients */}
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block flex items-center gap-1.5">
              <Users size={11} />
              Expected patients
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={expectedPatients}
              onChange={e => setExpectedPatients(Number(e.target.value))}
              className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-red-500/50 transition-all"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !pin || !title.trim()}
            className="w-full bg-red-500 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> Sending broadcast...</>
            ) : (
              <><Radio size={14} /> Send Emergency Broadcast</>
            )}
          </button>

          <p className="text-gray-600 text-[10px] text-center">
            This will immediately notify all hospitals within {radius}km via WhatsApp.
          </p>
        </form>
      </div>

      {/* Right: Map */}
      <div className="flex-1 relative">
        <Map
          ref={mapRef}
          mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          initialViewState={LAGOS}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          onClick={handleMapClick}
          cursor={pin ? 'default' : 'crosshair'}
        >
          <NavigationControl position="bottom-right" showCompass={false} />

          {/* Radius circle */}
          {pin && (
            <Source
              id="radius"
              type="geojson"
              data={radiusCircle}
            >
              <Layer
                id="radius-fill"
                type="circle"
                paint={{
                  'circle-radius': {
                    stops: [[0, 0], [20, radius * 80]],
                    base: 2,
                  },
                  'circle-color': '#ef4444',
                  'circle-opacity': 0.08,
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ef4444',
                  'circle-stroke-opacity': 0.3,
                }}
              />
            </Source>
          )}

          {/* Incident pin */}
          {pin && (
            <Marker latitude={pin.lat} longitude={pin.lng} anchor="center">
              <div className="relative">
                <div
                  className="absolute rounded-full"
                  style={{
                    width: 40, height: 40, top: -14, left: -14,
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    animation: 'incident-pulse 1.5s ease-out infinite',
                  }}
                />
                <div
                  style={{
                    width: 14, height: 14,
                    backgroundColor: '#ef4444',
                    borderRadius: '50%',
                    border: '3px solid white',
                    boxShadow: '0 0 12px rgba(239,68,68,0.6)',
                  }}
                />
              </div>
            </Marker>
          )}
        </Map>

        {/* Instruction overlay when no pin */}
        {!pin && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-[#0d1320]/80 backdrop-blur-sm border border-gray-700/50 rounded-xl px-6 py-4 text-center">
              <MapPin size={24} className="text-red-400 mx-auto mb-2" />
              <p className="text-white text-sm font-medium">Click to set incident location</p>
              <p className="text-gray-500 text-xs mt-1">Place the pin where the emergency occurred</p>
            </div>
          </div>
        )}

        <style>{`
          @keyframes incident-pulse {
            0% { transform: scale(1); opacity: 0.5; }
            100% { transform: scale(3); opacity: 0; }
          }
        `}</style>
      </div>
    </div>
  );
}