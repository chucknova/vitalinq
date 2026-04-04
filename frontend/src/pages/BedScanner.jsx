/**
 * BedScanner — AI-powered camera bed occupancy detection.
 *
 * Route: /hospital/:slug/scan
 * Mobile-optimized. Nurse selects bed type, takes a photo,
 * AI counts occupied vs empty beds, updates the dashboard.
 */

import { useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Camera, Loader2, CheckCircle2, AlertTriangle,
  RefreshCw, BedDouble, Upload, X
} from 'lucide-react';
import api from '../lib/api';
import HistoryNav from '../components/HistoryNav';

const BED_TYPES = [
  { id: 'icu', label: 'ICU' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'ward', label: 'Ward' },
  { id: 'maternity', label: 'Maternity' },
  { id: 'pediatric', label: 'Pediatric' },
  { id: 'surgical', label: 'Surgical' },
  { id: 'psychiatric', label: 'Psychiatric' },
];

export default function BedScanner() {
  const { slug } = useParams();
  const [bedType, setBedType] = useState('');
  const [image, setImage] = useState(null); // base64 string
  const [preview, setPreview] = useState(null); // object URL for display
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setResult(null);
    setError(null);
    setPreview(URL.createObjectURL(file));

    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleScan() {
    if (!image || !bedType) return;

    setScanning(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.post(`/api/hospitals/dashboard/${slug}/bed-scan`, {
        bed_type: bedType,
        image_base64: image,
      });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Scan failed. Try a clearer photo.');
    } finally {
      setScanning(false);
    }
  }

  function handleReset() {
    setImage(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }

  return (
    <div className="min-h-screen bg-[#eef2f7] px-3 py-4 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[580px]">
        <div className="rounded-[32px] border border-black/5 bg-[#141414] p-3 shadow-[0_24px_80px_rgba(15,23,42,0.18)] sm:p-4">
          <div className="rounded-[28px] bg-[#f7f8fb] p-3 sm:p-4">

            {/* Header */}
            <div className="flex items-center gap-3 rounded-[24px] bg-[#171717] px-4 py-3 text-white">
              <HistoryNav backFallback={`/hospital/${slug}/dashboard`} />
              <div>
                <p className="text-sm font-semibold">Bed Scanner</p>
                <p className="text-xs text-slate-400">AI-powered occupancy detection</p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {/* Step 1: Select bed type */}
              <section className="rounded-[26px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 1</p>
                <p className="mt-1 text-base font-semibold text-slate-900">Select department</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {BED_TYPES.map(bt => (
                    <button
                      key={bt.id}
                      onClick={() => setBedType(bt.id)}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                        bedType === bt.id
                          ? 'border-sky-400 bg-sky-50 text-sky-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {bt.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Step 2: Capture photo */}
              <section className="rounded-[26px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 2</p>
                <p className="mt-1 text-base font-semibold text-slate-900">Capture the ward</p>
                <p className="mt-1 text-sm text-slate-500">Take a photo showing the beds in this department.</p>

                {!preview ? (
                  <div className="mt-4 flex gap-3">
                    {/* Camera button */}
                    <button
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-6 transition hover:border-sky-300 hover:bg-sky-50"
                    >
                      <Camera size={24} className="text-slate-400" />
                      <span className="text-sm font-medium text-slate-600">Take photo</span>
                    </button>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {/* Upload button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-6 transition hover:border-sky-300 hover:bg-sky-50"
                    >
                      <Upload size={24} className="text-slate-400" />
                      <span className="text-sm font-medium text-slate-600">Upload</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="mt-4">
                    <div className="relative rounded-2xl overflow-hidden">
                      <img src={preview} alt="Ward photo" className="w-full max-h-[300px] object-cover" />
                      <button
                        onClick={handleReset}
                        className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Step 3: Scan */}
              {image && bedType && !result && (
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[20px] bg-slate-950 text-base font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                >
                  {scanning ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Analyzing photo...
                    </>
                  ) : (
                    <>
                      <Camera size={18} />
                      Scan for bed occupancy
                    </>
                  )}
                </button>
              )}

              {/* Error */}
              {error && (
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 flex items-start gap-2">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Results */}
              {result && (
                <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                        <CheckCircle2 size={18} />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Scan complete</p>
                        <p className="mt-1 text-base font-semibold text-slate-900">
                          {BED_TYPES.find((item) => item.id === result.bed_type)?.label || result.bed_type?.toUpperCase()} beds updated
                        </p>
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                      result.confidence === 'high' ? 'bg-emerald-50 text-emerald-700' :
                      result.confidence === 'medium' ? 'bg-amber-50 text-amber-700' :
                      'bg-red-50 text-red-700'
                    }`}>
                      {result.confidence} confidence
                    </span>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-[1.3fr,1fr,1fr]">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Available now</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{result.empty}</p>
                      <p className="mt-1 text-sm text-slate-500">Beds ready for new patients</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Occupied</p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{result.occupied}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total beds</p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{result.total_beds}</p>
                    </div>
                  </div>

                  {result.notes && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-sm leading-relaxed text-slate-600">{result.notes}</p>
                    </div>
                  )}

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Dashboard updated for <span className="font-semibold text-slate-900">{BED_TYPES.find((item) => item.id === result.bed_type)?.label || result.bed_type?.toUpperCase()}</span>.
                    <span className="ml-1">{result.empty} of {result.total_beds} beds are available.</span>
                  </div>

                  <div className="mt-5 flex gap-2">
                    <button
                      onClick={handleReset}
                      className="flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <RefreshCw size={14} />
                      Scan again
                    </button>
                    <Link
                      to={`/hospital/${slug}/dashboard`}
                      className="flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      <BedDouble size={14} />
                      Dashboard
                    </Link>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
