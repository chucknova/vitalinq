/**
 * OnboardPage — public registration form for hospitals joining BedSignal.
 * 
 * Route: /onboard (or /join)
 * No auth required. Mobile-friendly. Dark theme.
 */

import { useState } from 'react';
import { Building2, Phone, Mail, User, Bed, Stethoscope, CheckCircle2, Loader2, ArrowLeft, Copy, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const LGAS = [
  "Ikeja", "Surulere", "Lagos Island", "Eti-Osa", "Mushin", "Kosofe",
  "Alimosho", "Agege", "Amuwo-Odofin", "Oshodi-Isolo", "Ikorodu",
  "Epe", "Badagry", "Apapa", "Somolu", "Ifako-Ijaiye", "Ojo",
  "Ajeromi-Ifelodun", "Mainland",
];

const HOSPITAL_TYPES = [
  { value: "general", label: "General Hospital" },
  { value: "teaching", label: "Teaching Hospital" },
  { value: "specialist", label: "Specialist Hospital" },
  { value: "private", label: "Private Hospital" },
  { value: "maternity", label: "Maternity Centre" },
  { value: "clinic", label: "Clinic" },
];

const BED_TYPES = [
  { value: "icu", label: "ICU" },
  { value: "ward", label: "Ward" },
  { value: "maternity", label: "Maternity" },
  { value: "emergency", label: "Emergency" },
  { value: "pediatric", label: "Pediatric" },
  { value: "surgical", label: "Surgical" },
  { value: "psychiatric", label: "Psychiatric" },
];

const EQUIPMENT = [
  "CT Scanner", "MRI", "Blood Bank", "Ventilators", "Dialysis",
  "Oxygen", "X-ray", "Ultrasound", "Theatre", "Lab", "Pharmacy", "Ambulance",
];

export default function OnboardPage() {
  const [step, setStep] = useState('form'); // 'form' or 'success'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [logUrlCopied, setLogUrlCopied] = useState(false);
  const [result, setResult] = useState(null);

  // Form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lga, setLga] = useState('');
  const [hospitalType, setHospitalType] = useState('');
  const [selectedBeds, setSelectedBeds] = useState({});
  const [selectedEquipment, setSelectedEquipment] = useState([]);
  const [whatsapp, setWhatsapp] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [contactPerson, setContactPerson] = useState('');

  function toggleBedType(type) {
    setSelectedBeds(prev => {
      const next = { ...prev };
      if (next[type] !== undefined) {
        delete next[type];
      } else {
        next[type] = 0;
      }
      return next;
    });
  }

  function setBedCount(type, count) {
    setSelectedBeds(prev => ({ ...prev, [type]: parseInt(count) || 0 }));
  }

  function toggleEquipment(eq) {
    setSelectedEquipment(prev =>
      prev.includes(eq) ? prev.filter(e => e !== eq) : [...prev, eq]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const bedTypes = Object.entries(selectedBeds).map(([bed_type, total_count]) => ({
      bed_type,
      total_count,
    }));

    if (bedTypes.length === 0) {
      setError('Please select at least one bed type.');
      setLoading(false);
      return;
    }

    try {
      const res = await api.post('/api/hospitals/onboard', {
        hospital_name: name,
        address,
        lga,
        hospital_type: hospitalType,
        bed_types: bedTypes,
        equipment: selectedEquipment,
        whatsapp_number: whatsapp,
        phone: phone || undefined,
        email: email || undefined,
        contact_person: contactPerson || undefined,
      });

      setResult(res.data);
      setStep('success');
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function copyLogUrl() {
    if (result?.log_url) {
      navigator.clipboard.writeText(window.location.origin + result.log_url);
      setLogUrlCopied(true);
      setTimeout(() => setLogUrlCopied(false), 2000);
    }
  }

  // ── Success screen ─────────────────────────────────
  if (step === 'success' && result) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-emerald-400" />
          </div>

          <h1 className="text-white text-2xl font-bold mb-2">Welcome to BedSignal!</h1>
          <p className="text-gray-400 text-sm mb-6">
            <span className="text-white font-medium">{name}</span> is now live on the network.
          </p>

          {/* Patient log URL */}
          <div className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-4 mb-4 text-left">
            <p className="text-gray-400 text-xs mb-2">Your Patient Log (bookmark this)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-cyan-300 text-sm bg-[#0a0f1a] px-3 py-2 rounded-lg truncate">
                {window.location.origin}{result.log_url}
              </code>
              <button
                onClick={copyLogUrl}
                className="text-gray-500 hover:text-cyan-400 p-2 transition-colors flex-shrink-0"
              >
                {logUrlCopied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-gray-600 text-[10px] mt-2">
              Share this link with your nursing staff for shift handovers
            </p>
          </div>

          {/* WhatsApp instructions */}
          <div className="bg-[#151d2e] border border-gray-800/50 rounded-xl p-4 mb-6 text-left">
            <p className="text-gray-400 text-xs mb-2">WhatsApp Commands</p>
            <div className="space-y-1.5 text-sm">
              <p className="text-gray-300"><span className="text-cyan-400 font-mono">STATUS</span> — View your current data</p>
              <p className="text-gray-300"><span className="text-cyan-400 font-mono">UPDATE</span> — Update bed availability</p>
              <p className="text-gray-300"><span className="text-cyan-400 font-mono">DISCHARGE 2 ICU</span> — Record discharges</p>
            </div>
            <p className="text-gray-600 text-[10px] mt-3">
              You'll receive a WhatsApp message shortly with these instructions.
            </p>
          </div>

          <div className="flex gap-3">
            <Link
              to="/"
              className="flex-1 bg-[#151d2e] hover:bg-[#1a2435] text-gray-300 text-sm font-medium py-3 rounded-lg transition-all text-center"
            >
              Pulse Map
            </Link>
            <Link
              to={`/hospital/${result.slug}/dashboard`}
              className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-medium py-3 rounded-lg transition-all text-center"
            >
              Open Dashboard
            </Link>
            <Link
              to={result.log_url}
              className="flex-1 bg-[#151d2e] hover:bg-[#1a2435] text-gray-300 text-sm font-medium py-3 rounded-lg transition-all text-center"
            >
              Patient Log
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Registration form ──────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0f1a]">
      {/* Header */}
      <div className="border-b border-gray-800/50 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link to="/" className="text-gray-500 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-white text-lg font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-cyan-400 rounded-full" />
              Join BedSignal
            </h1>
            <p className="text-gray-500 text-xs">Register your hospital on the network</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Hospital info */}
          <section>
            <h2 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
              <Building2 size={15} className="text-cyan-400" />
              Hospital Information
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Hospital name *</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder="e.g. Lagos General Hospital"
                  className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all" />
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1 block">Full address *</label>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)} required
                  placeholder="e.g. 1 Oba Akinjobi Way, Ikeja"
                  className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">LGA *</label>
                  <select value={lga} onChange={e => setLga(e.target.value)} required
                    className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50 transition-all">
                    <option value="">Select LGA</option>
                    {LGAS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Hospital type *</label>
                  <select value={hospitalType} onChange={e => setHospitalType(e.target.value)} required
                    className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50 transition-all">
                    <option value="">Select type</option>
                    {HOSPITAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Bed types */}
          <section>
            <h2 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
              <Bed size={15} className="text-cyan-400" />
              Bed Types & Capacity *
            </h2>
            <p className="text-gray-500 text-xs mb-3">Select the bed types your hospital has and enter total capacity for each.</p>

            <div className="space-y-2">
              {BED_TYPES.map(bt => (
                <div key={bt.value} className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleBedType(bt.value)}
                    className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-all ${
                      selectedBeds[bt.value] !== undefined
                        ? 'bg-cyan-500 border-cyan-500'
                        : 'bg-transparent border-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {selectedBeds[bt.value] !== undefined && <Check size={12} className="text-white" />}
                  </button>
                  <span className="text-gray-300 text-sm w-24">{bt.label}</span>
                  {selectedBeds[bt.value] !== undefined && (
                    <input
                      type="number"
                      min="0"
                      value={selectedBeds[bt.value]}
                      onChange={e => setBedCount(bt.value, e.target.value)}
                      placeholder="Total beds"
                      className="w-28 bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Equipment */}
          <section>
            <h2 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
              <Stethoscope size={15} className="text-cyan-400" />
              Equipment & Facilities
            </h2>

            <div className="flex flex-wrap gap-2">
              {EQUIPMENT.map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => toggleEquipment(eq)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selectedEquipment.includes(eq)
                      ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300'
                      : 'bg-[#151d2e] border-gray-700/50 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {eq}
                </button>
              ))}
            </div>
          </section>

          {/* Contact */}
          <section>
            <h2 className="text-white text-sm font-semibold mb-3 flex items-center gap-2">
              <Phone size={15} className="text-cyan-400" />
              Contact Details
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs mb-1 block">WhatsApp number * <span className="text-gray-600">(for BedSignal bot)</span></label>
                <input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} required
                  placeholder="+234..."
                  className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Public phone <span className="text-gray-600">(shown in results)</span></label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="+234..."
                    className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@hospital.com"
                    className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all" />
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1 block">Contact person</label>
                <input type="text" value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                  placeholder="Name of registering person"
                  className="w-full bg-[#151d2e] border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-all" />
              </div>
            </div>
          </section>

          {/* Stale data notice */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
            <p className="text-amber-400 text-xs font-medium mb-1">Data freshness policy</p>
            <p className="text-gray-400 text-xs">
              Hospitals that haven't updated in 8+ hours are marked as stale across all search results.
              We'll send check-in reminders every 6 hours to help you stay current.
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> Registering...</>
            ) : (
              'Join BedSignal'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}