/**
 * BroadcastPatientLog — paramedic logs patients at the scene.
 *
 * Route: /broadcast/:id/log
 * Mobile-optimized. Big severity buttons. Minimal typing.
 * Each logged patient auto-increments tag (MCI-001, MCI-002...).
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Check, Loader2, AlertTriangle, Radio, Users, X
} from 'lucide-react';
import api from '../lib/api';

const SEVERITY_OPTIONS = [
  { id: 'critical', label: 'Critical', emoji: '🔴', color: 'bg-red-500', border: 'border-red-500', activeBg: 'bg-red-500/20', desc: 'Life-threatening' },
  { id: 'high',     label: 'High',     emoji: '🟠', color: 'bg-amber-500', border: 'border-amber-500', activeBg: 'bg-amber-500/20', desc: 'Serious but stable' },
  { id: 'medium',   label: 'Medium',   emoji: '🟡', color: 'bg-yellow-500', border: 'border-yellow-500', activeBg: 'bg-yellow-500/20', desc: 'Needs care' },
  { id: 'low',      label: 'Low',      emoji: '🟢', color: 'bg-green-500', border: 'border-green-500', activeBg: 'bg-green-500/20', desc: 'Walking wounded' },
  { id: 'deceased',  label: 'Deceased', emoji: '⚫', color: 'bg-gray-500', border: 'border-gray-500', activeBg: 'bg-gray-500/20', desc: '' },
];

const REQUIREMENT_OPTIONS = [
  'icu', 'surgical', 'ventilator', 'ct_scanner', 'blood_bank',
  'xray', 'pediatric', 'maternity', 'orthopedic', 'oxygen',
];

const REQ_LABELS = {
  icu: 'ICU', surgical: 'Surgical', ventilator: 'Ventilator', ct_scanner: 'CT Scanner',
  blood_bank: 'Blood Bank', xray: 'X-ray', pediatric: 'Pediatric', maternity: 'Maternity',
  orthopedic: 'Orthopedic', oxygen: 'Oxygen',
};

export default function BroadcastPatientLog() {
  const { id } = useParams();
  const [broadcast, setBroadcast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Form state
  const [severity, setSeverity] = useState(null);
  const [condition, setCondition] = useState('');
  const [requirements, setRequirements] = useState([]);

  // Logged patients (local list for this session)
  const [logged, setLogged] = useState([]);
  const [lastTag, setLastTag] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const conditionRef = useRef(null);

  // Fetch broadcast info
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/api/broadcast/${id}`);
        setBroadcast(res.data.broadcast);
        // Count existing patients
        setLogged(res.data.patients || []);
      } catch (err) {
        setError('Broadcast not found.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function toggleRequirement(req) {
    setRequirements(prev =>
      prev.includes(req) ? prev.filter(r => r !== req) : [...prev, req]
    );
  }

  async function handleSubmit() {
    if (!severity) {
      setError('Select a severity level.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await api.post(`/api/broadcast/${id}/patients`, {
        severity,
        condition_notes: condition.trim(),
        requirements,
      });

      // Success — show confirmation, reset form
      setLastTag(res.data.tag_number);
      setShowSuccess(true);
      setLogged(prev => [...prev, {
        tag_number: res.data.tag_number,
        severity: res.data.severity,
        condition_notes: condition.trim(),
      }]);

      // Reset form
      setSeverity(null);
      setCondition('');
      setRequirements([]);

      // Auto-hide success after 2 seconds
      setTimeout(() => setShowSuccess(false), 2000);

    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to log patient.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <Loader2 size={24} className="text-red-400 animate-spin" />
      </div>
    );
  }

  if (error && !broadcast) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-6">
        <div className="text-center">
          <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white mb-2">{error}</p>
          <Link to="/" className="text-cyan-400 text-sm hover:underline">Back</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a]">
      {/* Header */}
      <div className="border-b border-gray-800/50 px-4 py-3 sticky top-0 bg-[#0a0f1a]/95 backdrop-blur-sm z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to={`/broadcast/${id}`} className="text-gray-500 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-white text-sm font-semibold flex items-center gap-2">
                <Radio size={12} className="text-red-400 animate-pulse" />
                Patient Log
              </h1>
              <p className="text-gray-500 text-[10px]">{broadcast?.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-[#151d2e] px-2.5 py-1 rounded-lg">
            <Users size={12} className="text-cyan-400" />
            <span className="text-white text-xs font-bold">{logged.length}</span>
            <span className="text-gray-500 text-[10px]">logged</span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5">

        {/* Success flash */}
        {showSuccess && lastTag && (
          <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-3 animate-slide-down">
            <Check size={18} className="text-emerald-400" />
            <div>
              <p className="text-emerald-400 text-sm font-bold">{lastTag} logged</p>
              <p className="text-gray-400 text-[10px]">Patient added to dispatch queue</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
            <AlertTriangle size={12} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
          </div>
        )}

        {/* Step 1: Severity — big tappable buttons */}
        <div className="mb-5">
          <p className="text-gray-400 text-xs mb-2 font-medium">Triage severity *</p>
          <div className="grid grid-cols-2 gap-2">
            {SEVERITY_OPTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSeverity(s.id);
                  // Auto-focus condition input
                  setTimeout(() => conditionRef.current?.focus(), 100);
                }}
                className={`p-3 rounded-xl border-2 transition-all text-left ${
                  severity === s.id
                    ? `${s.activeBg} ${s.border}`
                    : 'bg-[#151d2e] border-gray-800/50 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-lg">{s.emoji}</span>
                  <span className="text-white text-sm font-semibold">{s.label}</span>
                </div>
                {s.desc && <p className="text-gray-500 text-[10px]">{s.desc}</p>}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Condition notes */}
        <div className="mb-5">
          <p className="text-gray-400 text-xs mb-2 font-medium">Condition</p>
          <input
            ref={conditionRef}
            type="text"
            value={condition}
            onChange={e => setCondition(e.target.value)}
            placeholder="e.g. Head trauma, unconscious, bleeding"
            className="w-full bg-[#151d2e] border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-500/50 transition-all"
          />
        </div>

        {/* Step 3: Requirements — tappable chips */}
        <div className="mb-6">
          <p className="text-gray-400 text-xs mb-2 font-medium">Needs <span className="text-gray-600">(select all that apply)</span></p>
          <div className="flex flex-wrap gap-1.5">
            {REQUIREMENT_OPTIONS.map(req => (
              <button
                key={req}
                type="button"
                onClick={() => toggleRequirement(req)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  requirements.includes(req)
                    ? 'bg-red-500/20 border-red-500/30 text-red-300'
                    : 'bg-[#151d2e] border-gray-700/50 text-gray-400 hover:border-gray-500'
                }`}
              >
                {REQ_LABELS[req] || req}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!severity || submitting}
          className="w-full bg-red-500 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-base font-semibold py-4 rounded-xl transition-all flex items-center justify-center gap-2"
        >
          {submitting ? (
            <><Loader2 size={18} className="animate-spin" /> Logging...</>
          ) : (
            <><Plus size={18} /> Log Patient</>
          )}
        </button>

        {/* Recent logged patients */}
        {logged.length > 0 && (
          <div className="mt-6">
            <p className="text-gray-500 text-[10px] mb-2">Recently logged ({logged.length})</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...logged].reverse().slice(0, 10).map((p, i) => {
                const sev = SEVERITY_OPTIONS.find(s => s.id === p.severity);
                return (
                  <div key={i} className="flex items-center gap-2 bg-[#151d2e] rounded-lg px-3 py-2">
                    <span className={`w-2 h-2 rounded-full ${sev?.color || 'bg-gray-500'}`} />
                    <span className="text-white text-xs font-mono font-bold">{p.tag_number}</span>
                    <span className="text-gray-500 text-[10px] truncate flex-1">{p.condition_notes || 'No notes'}</span>
                    <Check size={12} className="text-emerald-400 flex-shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down { animation: slide-down 0.3s ease-out; }
      `}</style>
    </div>
  );
}