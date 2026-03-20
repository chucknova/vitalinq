import { useState } from 'react';
import {
  ArrowLeft,
  Bed,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  HeartHandshake,
  Loader2,
  Mail,
  Phone,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const LGAS = [
  'Ikeja', 'Surulere', 'Lagos Island', 'Eti-Osa', 'Mushin', 'Kosofe',
  'Alimosho', 'Agege', 'Amuwo-Odofin', 'Oshodi-Isolo', 'Ikorodu',
  'Epe', 'Badagry', 'Apapa', 'Somolu', 'Ifako-Ijaiye', 'Ojo',
  'Ajeromi-Ifelodun', 'Mainland',
];

const HOSPITAL_TYPES = [
  { value: 'general', label: 'General Hospital' },
  { value: 'teaching', label: 'Teaching Hospital' },
  { value: 'specialist', label: 'Specialist Hospital' },
  { value: 'private', label: 'Private Hospital' },
  { value: 'maternity', label: 'Maternity Centre' },
  { value: 'clinic', label: 'Clinic' },
];

const BED_TYPES = [
  { value: 'icu', label: 'ICU' },
  { value: 'ward', label: 'Ward' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'pediatric', label: 'Pediatric' },
  { value: 'surgical', label: 'Surgical' },
  { value: 'psychiatric', label: 'Psychiatric' },
];

const EQUIPMENT = [
  'CT Scanner', 'MRI', 'Blood Bank', 'Ventilators', 'Dialysis',
  'Oxygen', 'X-ray', 'Ultrasound', 'Theatre', 'Lab', 'Pharmacy', 'Ambulance',
];

const rituals = [
  'Complete registration with your hospital identity and contact details.',
  'Publish bed capacity that referral teams can rely on in real time.',
  'Start with core services now and update the rest as operations evolve.',
];

function FieldShell({ icon: Icon, label, hint, children }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
        <Icon size={16} className="text-blue-300" />
        {label}
        {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function SectionCard({ eyebrow, title, description, children }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-[#121a27] p-6 shadow-[0_20px_48px_rgba(2,6,23,0.28)] md:p-7">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-blue-300">
        {eyebrow}
      </p>
      <div className="mb-5 space-y-1">
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <p className="text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function OnboardPage() {
  const [step, setStep] = useState('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [logUrlCopied, setLogUrlCopied] = useState(false);
  const [result, setResult] = useState(null);

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

  const selectedBedCount = Object.keys(selectedBeds).length;

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
    setSelectedBeds(prev => ({ ...prev, [type]: parseInt(count, 10) || 0 }));
  }

  function toggleEquipment(eq) {
    setSelectedEquipment(prev =>
      prev.includes(eq) ? prev.filter(item => item !== eq) : [...prev, eq]
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

  if (step === 'success' && result) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#07111b] px-6 py-8 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(37,99,235,0.10),_transparent_22%),linear-gradient(180deg,_#09121d_0%,_#050b13_100%)]" />
        <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center">
          <div className="w-full rounded-lg border border-slate-800 bg-[#0f1724] p-8 shadow-[0_32px_80px_rgba(2,6,23,0.45)] md:p-12">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-lg bg-[#111b2b] shadow-inner shadow-black/30">
                <CheckCircle2 size={40} className="text-blue-300" />
              </div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.32em] text-blue-300">
                Registration complete
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Your hospital is now active on BedSignal.
              </h1>
              <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-slate-400 md:text-base">
                <span className="font-semibold text-slate-100">{name}</span> can now share live capacity,
                receive referrals, and coordinate updates with the network.
              </p>

              <div className="mt-8 space-y-4 text-left">
                <div className="rounded-lg border border-slate-800 bg-[#121a27] p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-300">
                    Patient log
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Save this link for nursing staff and shift leads.
                  </p>
                  <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#0a1220] p-2 shadow-sm shadow-black/20">
                    <code className="flex-1 truncate rounded-md bg-[#111b2b] px-4 py-3 text-sm text-blue-200">
                      {window.location.origin}{result.log_url}
                    </code>
                    <button
                      type="button"
                      onClick={copyLogUrl}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-blue-600 text-white transition hover:bg-blue-500"
                    >
                      {logUrlCopied ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#121a27] p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-300">
                    WhatsApp flow
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-md bg-[#0f1724] p-4">
                      <p className="font-mono text-sm font-semibold text-blue-200">STATUS</p>
                      <p className="mt-2 text-xs leading-5 text-slate-400">View your current snapshot.</p>
                    </div>
                    <div className="rounded-md bg-[#0f1724] p-4">
                      <p className="font-mono text-sm font-semibold text-blue-200">UPDATE</p>
                      <p className="mt-2 text-xs leading-5 text-slate-400">Refresh available beds in seconds.</p>
                    </div>
                    <div className="rounded-md bg-[#0f1724] p-4">
                      <p className="font-mono text-sm font-semibold text-blue-200">DISCHARGE 2 ICU</p>
                      <p className="mt-2 text-xs leading-5 text-slate-400">Record discharges without opening a dashboard.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/"
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  View Pulse Map
                </Link>
                <Link
                  to={result.log_url}
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  Open Patient Log
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07111b] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_80%_12%,_rgba(37,99,235,0.12),_transparent_20%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.08),_transparent_24%),linear-gradient(180deg,_#09121d_0%,_#050b13_100%)]" />
      <div className="absolute -left-20 top-24 h-56 w-56 rounded-full bg-[#0f2748]/45 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-[#10253f]/30 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-6 py-6 md:px-8 md:py-8">
        <div className="mb-8 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#101926] px-4 py-2 text-sm font-medium text-slate-300 shadow-sm transition hover:bg-[#152031]"
          >
            <ArrowLeft size={16} />
            Back to map
          </Link>
          <div className="rounded-md border border-slate-700 bg-[#101926] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300 shadow-sm">
            BedSignal onboarding
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <aside className="lg:sticky lg:top-8">
            <div className="rounded-lg border border-slate-800 bg-[#0f1724] p-7 shadow-[0_24px_72px_rgba(2,6,23,0.36)] md:p-9">
              <div className="inline-flex items-center gap-2 rounded-md bg-blue-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
                <Building2 size={14} />
                Hospital onboarding
              </div>
              <h1 className="mt-6 max-w-md text-4xl font-semibold leading-tight tracking-tight text-white md:text-5xl">
                Register your hospital with a clear, dependable setup flow.
              </h1>
              <p className="mt-5 max-w-lg text-base leading-8 text-slate-400">
                Share your facility details, capacity profile, and contact path so referral teams can
                find accurate information and route patients more reliably.
              </p>

              <div className="mt-8 space-y-4">
                {rituals.map(item => (
                  <div key={item} className="flex items-start gap-3 rounded-lg bg-[#121a27] p-4">
                    <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-md bg-[#0d1724] shadow-sm">
                      <Check size={16} className="text-blue-300" />
                    </div>
                    <p className="text-sm leading-6 text-slate-300">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 rounded-lg border border-slate-800 bg-[#121a27] p-6 text-white shadow-[0_20px_48px_rgba(2,6,23,0.28)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[#0d1724] text-blue-300">
                    <HeartHandshake size={22} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">What this setup supports</p>
                    <p className="text-xs text-white/65">Faster onboarding and clearer handover data.</p>
                  </div>
                </div>
                <p className="mt-5 text-sm leading-7 text-white/80">
                  BedSignal uses these details to surface your hospital correctly, route referrals more
                  effectively, and keep operational updates consistent across the network.
                </p>
              </div>
            </div>
          </aside>

          <main>
            {error && (
              <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200 shadow-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <SectionCard
                eyebrow="Step 1"
                title="Tell us about your hospital"
                description="Start with the details people need to recognize and trust your facility."
              >
                <div className="grid gap-4">
                  <FieldShell icon={Building2} label="Hospital name">
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                      placeholder="e.g. Lagos General Hospital"
                      className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:bg-[#0d1724]"
                    />
                  </FieldShell>

                  <FieldShell icon={Building2} label="Full address">
                    <input
                      type="text"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      required
                      placeholder="e.g. 1 Oba Akinjobi Way, Ikeja"
                      className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:bg-[#0d1724]"
                    />
                  </FieldShell>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FieldShell icon={Building2} label="LGA">
                      <select
                        value={lga}
                        onChange={e => setLga(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-blue-500 focus:bg-[#0d1724]"
                      >
                        <option value="">Select LGA</option>
                        {LGAS.map(item => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </FieldShell>

                    <FieldShell icon={Building2} label="Hospital type">
                      <select
                        value={hospitalType}
                        onChange={e => setHospitalType(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-blue-500 focus:bg-[#0d1724]"
                      >
                        <option value="">Select type</option>
                        {HOSPITAL_TYPES.map(type => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </FieldShell>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                eyebrow="Step 2"
                title="Choose the beds you actively manage"
                description="Select each care area you want BedSignal to track, then add the total capacity for it."
              >
                <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg bg-[#101926] px-4 py-3 text-sm text-slate-400">
                  <span className="inline-flex items-center gap-2 font-medium text-slate-200">
                    <Bed size={16} className="text-blue-300" />
                    {selectedBedCount} bed type{selectedBedCount === 1 ? '' : 's'} selected
                  </span>
                  <span className="text-slate-500">You can start small and add more later.</span>
                </div>

                <div className="grid gap-3">
                  {BED_TYPES.map(type => {
                    const isSelected = selectedBeds[type.value] !== undefined;

                    return (
                      <div
                        key={type.value}
                        className={`rounded-lg border p-4 transition ${
                          isSelected
                            ? 'border-blue-500/40 bg-[#121a27]'
                            : 'border-slate-800 bg-[#0d1522]'
                        }`}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <button
                            type="button"
                            onClick={() => toggleBedType(type.value)}
                            className="flex items-center gap-3 text-left"
                          >
                            <span
                              className={`flex h-10 w-10 items-center justify-center rounded-md border transition ${
                                isSelected
                                  ? 'border-blue-500 bg-blue-600 text-white'
                                  : 'border-slate-700 bg-[#121c2b] text-transparent'
                              }`}
                            >
                              <Check size={18} />
                            </span>
                            <span>
                              <span className="block text-sm font-semibold text-slate-100">{type.label}</span>
                              <span className="block text-xs text-slate-500">
                                {isSelected ? 'Included in your live capacity view.' : 'Tap to start tracking this unit.'}
                              </span>
                            </span>
                          </button>

                          {isSelected && (
                            <div className="md:w-40">
                              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                                Total beds
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={selectedBeds[type.value]}
                                onChange={e => setBedCount(type.value, e.target.value)}
                                placeholder="0"
                                className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard
                eyebrow="Step 3"
                title="Add equipment and care capabilities"
                description="These tags help referrers understand what your team can support before they call."
              >
                <div className="flex flex-wrap gap-3">
                  {EQUIPMENT.map(item => {
                    const isSelected = selectedEquipment.includes(item);

                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleEquipment(item)}
                        className={`rounded-md px-4 py-2.5 text-sm font-medium transition ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)]'
                            : 'border border-slate-700 bg-[#0d1522] text-slate-300 hover:bg-[#121c2b]'
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard
                eyebrow="Step 4"
                title="Set up your contact path"
                description="Choose who receives updates and how other teams can reliably reach you."
              >
                <div className="grid gap-4">
                  <FieldShell icon={Phone} label="WhatsApp number" hint="required for the BedSignal bot">
                    <input
                      type="tel"
                      value={whatsapp}
                      onChange={e => setWhatsapp(e.target.value)}
                      required
                      placeholder="+234..."
                      className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:bg-[#0d1724]"
                    />
                  </FieldShell>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FieldShell icon={Phone} label="Public phone" hint="shown in results">
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="+234..."
                        className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:bg-[#0d1724]"
                      />
                    </FieldShell>

                    <FieldShell icon={Mail} label="Email">
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="admin@hospital.com"
                        className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:bg-[#0d1724]"
                      />
                    </FieldShell>
                  </div>

                  <FieldShell icon={HeartHandshake} label="Contact person">
                    <input
                      type="text"
                      value={contactPerson}
                      onChange={e => setContactPerson(e.target.value)}
                      placeholder="Name of registering person"
                      className="w-full rounded-lg border border-slate-700 bg-[#0b1420] px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:bg-[#0d1724]"
                    />
                  </FieldShell>
                </div>
              </SectionCard>

              <div className="rounded-lg border border-slate-800 bg-[#101926] p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
                  Freshness promise
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  Hospitals that have not updated in 8+ hours are marked as stale across search results.
                  BedSignal sends check-in reminders every 6 hours so your listing stays dependable.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-4 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(37,99,235,0.18)] transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Creating your hospital profile...
                  </>
                ) : (
                  'Join BedSignal'
                )}
              </button>
            </form>
          </main>
        </div>
      </div>
    </div>
  );
}
