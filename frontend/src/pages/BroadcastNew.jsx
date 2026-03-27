/**
 * BroadcastNew — dispatcher triggers a new emergency broadcast.
 *
 * Route: /broadcast/new
 * Form: title, location, radius, expected patients, description.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Map, { Marker, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Radio, MapPin, Users, FileText, Loader2, AlertTriangle, Camera, X, LocateFixed, ImagePlus
} from 'lucide-react';
import api from '../lib/api';

const LAGOS = { latitude: 6.5244, longitude: 3.3792, zoom: 11 };

export default function BroadcastNew() {
  const navigate = useNavigate();
  const mapRef = useRef(null);
  const debounceRef = useRef(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedPatients, setExpectedPatients] = useState(10);
  const [radius, setRadius] = useState(10);
  const [pin, setPin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [addressInput, setAddressInput] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [images, setImages] = useState([]);

  useEffect(() => () => {
    images.forEach((image) => URL.revokeObjectURL(image.preview));
  }, [images]);

  const handleMapClick = useCallback((event) => {
    setPin({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  }, []);

  async function geocodeAddress() {
    if (!addressInput.trim()) return;
    setGeocoding(true);
    setError(null);

    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      const query = encodeURIComponent(`${addressInput.trim()}, Lagos, Nigeria`);
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1`
      );
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const placeName = data.features[0].place_name || addressInput;
        const nextPin = { lat, lng, label: placeName.split(',')[0] };
        setPin(nextPin);
        setAddressInput('');
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 800 });
      } else {
        setError('Location not found. Try a more specific address or click on the map.');
      }
    } catch {
      setError('Could not find that location. You can still click on the map.');
    } finally {
      setGeocoding(false);
    }
  }

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
          setSuggestions(data.features.map((feature) => ({
            name: feature.place_name,
            short: feature.text + (feature.context?.[0]?.text ? `, ${feature.context[0].text}` : ''),
            lat: feature.center[1],
            lng: feature.center[0],
          })));
        }
      } catch {
        // Suggestions are optional.
      }
    }, 300);
  }

  function selectSuggestion(suggestion) {
    const nextPin = { lat: suggestion.lat, lng: suggestion.lng, label: suggestion.short };
    setPin(nextPin);
    setAddressInput('');
    setSuggestions([]);
    mapRef.current?.flyTo({ center: [suggestion.lng, suggestion.lat], zoom: 14, duration: 800 });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!pin) {
      setError('Set the incident location before sending the broadcast.');
      return;
    }
    if (!title.trim()) {
      setError('Add a short incident title.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const imageUrls = [];
      for (const image of images) {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(image.file);
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
    <div className="min-h-screen bg-[#eef2f7] px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1380px]">
        <div className="rounded-[36px] border border-black/5 bg-[#141414] p-4 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
          <div className="rounded-[30px] bg-[#f7f8fb] p-3 sm:p-4">
            <TopBar />

            <div className="mt-4 grid gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
              <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="border-b border-slate-100 pb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">New broadcast</p>
                  <h1 className="mt-2 text-[1.55rem] font-semibold tracking-tight text-slate-950">Create an incident alert</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Set the location, define the coverage area, and notify nearby hospitals immediately.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="mt-5 space-y-5">
                  {error ? (
                    <div className="rounded-[20px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}

                  <div>
                    <label htmlFor="title" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Incident title
                    </label>
                    <input
                      id="title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Bus accident at Ojuelegba"
                      required
                      className="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="description" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Description
                    </label>
                    <textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Short context for hospitals and dispatch..."
                      rows={3}
                      className="w-full resize-none rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Scene photos</p>
                    {images.length > 0 ? (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {images.map((image, index) => (
                          <div key={index} className="relative h-16 w-16 overflow-hidden rounded-2xl border border-slate-200">
                            <img src={image.preview} alt="" className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setImages((prev) => prev.filter((_, imageIndex) => imageIndex !== index))}
                              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {images.length < 4 ? (
                      <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-white">
                        <ImagePlus size={15} />
                        {images.length === 0 ? 'Add photos from the scene' : 'Add another photo'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            const nextImages = files.slice(0, 4 - images.length).map((file) => ({
                              file,
                              preview: URL.createObjectURL(file),
                            }));
                            setImages((prev) => [...prev, ...nextImages].slice(0, 4));
                            e.target.value = '';
                          }}
                        />
                      </label>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">Up to 4 photos. These are shared with responding hospitals.</p>
                  </div>

                  <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-950">Incident location</p>
                      {pin ? (
                        <button
                          type="button"
                          onClick={() => setPin(null)}
                          className="text-xs font-medium text-slate-500 transition hover:text-slate-700"
                        >
                          Change
                        </button>
                      ) : null}
                    </div>

                    {pin ? (
                      <div className="mt-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                        <p className="text-sm font-medium text-slate-950">{pin.label || 'Selected point on map'}</p>
                        <p className="mt-1 text-xs text-slate-500">{pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}</p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const pos = await new Promise((resolve, reject) =>
                                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
                              );
                              const nextPin = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'My location' };
                              setPin(nextPin);
                              mapRef.current?.flyTo({ center: [nextPin.lng, nextPin.lat], zoom: 14, duration: 800 });
                            } catch {
                              setError('Could not use your location. You can still search or click on the map.');
                            }
                          }}
                          className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          <LocateFixed size={14} />
                          Use my location
                        </button>

                        <div className="relative">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={addressInput}
                              onChange={(e) => handleAddressChange(e.target.value)}
                              placeholder="Search a location in Lagos"
                              className="flex-1 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); geocodeAddress(); }
                                if (e.key === 'Escape') setSuggestions([]);
                              }}
                              onBlur={() => setTimeout(() => setSuggestions([]), 200)}
                            />
                            <button
                              type="button"
                              onClick={geocodeAddress}
                              disabled={!addressInput.trim() || geocoding}
                              className="inline-flex min-h-[48px] items-center justify-center rounded-[18px] bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                            >
                              {geocoding ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                            </button>
                          </div>

                          {suggestions.length > 0 ? (
                            <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-xl">
                              {suggestions.map((suggestion, index) => (
                                <button
                                  key={index}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => selectSuggestion(suggestion)}
                                  className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 last:border-0"
                                >
                                  <MapPin size={14} className="mt-0.5 text-slate-400" />
                                  <div>
                                    <p className="text-sm text-slate-900">{suggestion.short}</p>
                                    <p className="mt-0.5 text-xs text-slate-500">{suggestion.name}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Alert radius
                      </label>
                      <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-sm font-medium text-slate-950">{radius} km</p>
                        <input
                          type="range"
                          min={2}
                          max={30}
                          step={1}
                          value={radius}
                          onChange={(e) => setRadius(Number(e.target.value))}
                          className="mt-3 w-full accent-slate-900"
                        />
                        <div className="mt-1 flex justify-between text-xs text-slate-400">
                          <span>2 km</span>
                          <span>30 km</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="expectedPatients" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Expected patients
                      </label>
                      <input
                        id="expectedPatients"
                        type="number"
                        min={1}
                        max={500}
                        value={expectedPatients}
                        onChange={(e) => setExpectedPatients(Number(e.target.value))}
                        className="w-full rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-sky-300 focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !pin || !title.trim()}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                  >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Radio size={16} />}
                    {loading ? 'Sending broadcast...' : 'Send emergency broadcast'}
                  </button>

                  <p className="text-center text-xs text-slate-500">
                    Nearby hospitals within {radius}km will be notified immediately.
                  </p>
                </form>
              </section>

              <section className="rounded-[28px] bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <div className="border-b border-slate-100 px-1 pb-4">
                  <p className="text-base font-semibold text-slate-950">Incident map</p>
                  <p className="mt-1 text-sm text-slate-500">Click on the map to place the incident pin if you prefer.</p>
                </div>

                <div className="relative mt-4 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-100">
                  <Map
                    ref={mapRef}
                    mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
                    initialViewState={LAGOS}
                    style={{ width: '100%', height: 'min(76vh, 860px)' }}
                    mapStyle="mapbox://styles/mapbox/light-v11"
                    onClick={handleMapClick}
                    cursor={pin ? 'default' : 'crosshair'}
                  >
                    <NavigationControl position="bottom-right" showCompass={false} />

                    {pin ? (
                      <Marker latitude={pin.lat} longitude={pin.lng} anchor="center">
                        <div className="flex flex-col items-center">
                          <div className="mb-1 rounded-full bg-red-600 px-2 py-1 text-[10px] font-semibold text-white shadow-lg">
                            Incident
                          </div>
                          <div className="relative">
                            <div
                              className="absolute rounded-full"
                              style={{ width: 52, height: 52, top: -19, left: -19, backgroundColor: 'rgba(239,68,68,0.16)', animation: 'incident-pulse 1.6s ease-out infinite' }}
                            />
                            <div style={{ width: 14, height: 14, backgroundColor: '#dc2626', borderRadius: '50%', border: '3px solid white', boxShadow: '0 0 12px rgba(220,38,38,0.3)' }} />
                          </div>
                        </div>
                      </Marker>
                    ) : null}
                  </Map>

                  <style>{`
                    @keyframes incident-pulse {
                      0% { transform: scale(1); opacity: 0.55; }
                      100% { transform: scale(3); opacity: 0; }
                    }
                  `}</style>

                  {!pin ? (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="rounded-[24px] border border-white/70 bg-white/90 px-6 py-5 text-center shadow-lg backdrop-blur-sm">
                        <MapPin size={22} className="mx-auto text-red-500" />
                        <p className="mt-3 text-sm font-medium text-slate-950">Click anywhere to place the incident</p>
                        <p className="mt-1 text-xs text-slate-500">You can also search for the address on the left.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="absolute left-4 top-4 rounded-[20px] border border-white/70 bg-white/90 px-4 py-3 text-sm shadow-lg backdrop-blur-sm">
                      <p className="font-medium text-slate-950">{pin.label || 'Selected incident point'}</p>
                      <p className="mt-1 text-xs text-slate-500">{pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}</p>
                      <p className="mt-1 text-xs text-slate-500">Alert radius: {radius}km</p>
                    </div>
                  )}
                </div>
              </section>
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
        <Link to="/broadcast" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium">
          <Radio size={13} className="text-red-400" />
          New broadcast
        </div>
      </div>
      <div className="text-right text-xs text-slate-400">
        <p className="font-medium text-slate-300">Emergency coordination</p>
        <p className="mt-0.5">Notify nearby hospitals quickly</p>
      </div>
    </div>
  );
}
