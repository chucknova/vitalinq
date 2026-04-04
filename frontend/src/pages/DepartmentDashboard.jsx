/**
 * DepartmentDashboard — simplified view for department charge nurses.
 *
 * Route: /hospital/:slug/department
 * Code-based access (no login). Shows only the beds and patients
 * for the nurse's department.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Plus, Minus, Loader2, CheckCircle2, X, Lock,
  BedDouble, Clock3, AlertTriangle, LogOut, Camera
} from 'lucide-react';
import api from '../lib/api';
import HistoryNav from '../components/HistoryNav';

const BED_LABELS = {
  icu: 'ICU', emergency: 'Emergency', ward: 'General Ward',
  maternity: 'Maternity', pediatric: 'Pediatric', surgical: 'Surgical',
};

export default function DepartmentDashboard() {
  const { slug } = useParams();
  const [verified, setVerified] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [deptInfo, setDeptInfo] = useState(null); // { label, bed_types, hospital_name }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});
  const intervalRef = useRef(null);

  // Check sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(`dept_${slug}`);
    if (saved) {
      try {
        const info = JSON.parse(saved);
        setDeptInfo(info);
        setVerified(true);
      } catch (err) {
        console.error('Failed to restore saved department session:', err);
      }
    }
  }, [slug]);

  // Fetch department data
  const fetchData = useCallback(async () => {
    if (!verified || !deptInfo) return;
    try {
      const res = await api.get(`/api/hospitals/dashboard/${slug}/department/data`, {
        params: { bed_types: deptInfo.bed_types.join(',') },
        skipAuth: true,
        skipAuthLogout: true,
      });
      setData(res.data);
    } catch {
      // Ignore polling errors
    } finally {
      setLoading(false);
    }
  }, [slug, verified, deptInfo]);

  useEffect(() => {
    if (!verified) return;
    fetchData();
    intervalRef.current = setInterval(fetchData, 10000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData, verified]);

  async function handleVerify(e) {
    e.preventDefault();
    setCodeLoading(true);
    setCodeError(null);
    try {
      const res = await api.post(`/api/hospitals/dashboard/${slug}/department/verify`, {
        access_code: codeInput.trim(),
      }, {
        skipAuth: true,
        skipAuthLogout: true,
      });
      const info = res.data;
      setDeptInfo(info);
      setVerified(true);
      sessionStorage.setItem(`dept_${slug}`, JSON.stringify(info));
    } catch (err) {
      setCodeError(err.response?.data?.detail || 'Invalid code');
    } finally {
      setCodeLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(`dept_${slug}`);
    setVerified(false);
    setDeptInfo(null);
    setData(null);
    setCodeInput('');
  }

  async function handleIncrement(bedType) {
    setActionLoading(prev => ({ ...prev, [`inc_${bedType}`]: true }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/beds/${bedType}/increment`);
      await fetchData();
    } catch (err) {
      console.error('Department increment failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`inc_${bedType}`]: false }));
    }
  }

  async function handleDecrement(bedType) {
    setActionLoading(prev => ({ ...prev, [`dec_${bedType}`]: true }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/beds/${bedType}/decrement`);
      await fetchData();
    } catch (err) {
      console.error('Department decrement failed:', err);
    } finally {
      setActionLoading(prev => ({ ...prev, [`dec_${bedType}`]: false }));
    }
  }

  async function handleComplete(handshakeId, transferCode) {
    setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: true }));
    try {
      await api.post(`/api/hospitals/dashboard/${slug}/complete/${handshakeId}`, {
        transfer_code: transferCode,
      });
      await fetchData();
    } catch (err) {
      if (err.response?.data?.detail === 'Incorrect transfer code') {
        alert('Incorrect transfer code. Ask the patient to confirm their code.');
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [`hs_${handshakeId}`]: false }));
    }
  }

  // ── PIN gate ────────────────────────────────────
  if (!verified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7] p-6">
        <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <Lock size={24} className="text-emerald-600" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Department Access</h1>
          <p className="mt-1 text-sm text-slate-500">Enter your department code to continue</p>

          {codeError && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600">
              {codeError}
            </div>
          )}

          <form onSubmit={handleVerify} className="mt-5">
            <input
              type="text"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.toUpperCase())}
              placeholder="e.g. ICUK7M"
              autoFocus
              required
              maxLength={6}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-2xl font-mono tracking-[0.3em] text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <button
              type="submit"
              disabled={codeLoading || !codeInput.trim()}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
            >
              {codeLoading ? <Loader2 size={16} className="animate-spin" /> : 'Enter department'}
            </button>
          </form>

          <Link to="/" className="mt-4 inline-block text-xs text-slate-400 hover:text-slate-600">
            Back to map
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
        <Loader2 size={24} className="animate-spin text-slate-600" />
      </div>
    );
  }

  const { hospital, beds, handshakes } = data;
  const acceptedHS = handshakes.filter(h => h.status === 'accepted');
  const requestedHS = handshakes.filter(h => h.status === 'requested');

  return (
    <div className="min-h-screen bg-[#eef2f7] px-3 py-4 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[680px]">
        <div className="rounded-[32px] border border-black/5 bg-[#141414] p-3 shadow-[0_24px_80px_rgba(15,23,42,0.18)] sm:p-4">
          <div className="rounded-[28px] bg-[#f7f8fb] p-3 sm:p-4">

            {/* Header */}
            <div className="flex items-center justify-between rounded-[24px] bg-[#171717] px-4 py-3 text-white">
              <div className="flex items-center gap-3">
                <HistoryNav onBackFallback={handleLogout} />
                <div>
                  <p className="text-sm font-semibold">{deptInfo.label}</p>
                  <p className="text-xs text-slate-400">{hospital.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/hospital/${slug}/scan`}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-slate-400 transition hover:bg-sky-500/15 hover:text-sky-400"
                  title="Bed Scanner"
                >
                  <Camera size={15} />
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-slate-400 transition hover:bg-red-500/15 hover:text-red-400"
                  title="Exit department"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {/* Bed cards */}
              <section className="rounded-[26px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Bed Availability</p>

                {beds.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No bed data for this department yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {beds.map(bed => {
                      const label = BED_LABELS[bed.bed_type] || bed.bed_type;
                      const total = bed.total_count || 0;
                      const available = bed.available_count || 0;
                      const occupied = total - available;
                      const pct = total > 0 ? Math.round((available / total) * 100) : 0;

                      return (
                        <div key={bed.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <BedDouble size={16} className="text-slate-500" />
                              <span className="text-sm font-semibold text-slate-900">{label}</span>
                            </div>
                            <span className={`text-xs font-bold ${available > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {available} / {total}
                            </span>
                          </div>

                          {/* Progress bar */}
                          <div className="h-2 rounded-full bg-slate-200 overflow-hidden mb-3">
                            <div
                              className={`h-full rounded-full transition-all ${available > 0 ? 'bg-emerald-500' : 'bg-red-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>

                          {/* +/- buttons */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleDecrement(bed.bed_type)}
                                disabled={actionLoading[`dec_${bed.bed_type}`] || available <= 0}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-red-50 hover:border-red-200 hover:text-red-500 disabled:opacity-40"
                              >
                                {actionLoading[`dec_${bed.bed_type}`] ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />}
                              </button>
                              <span className="text-2xl font-bold text-slate-900 tabular-nums w-12 text-center">{available}</span>
                              <button
                                onClick={() => handleIncrement(bed.bed_type)}
                                disabled={actionLoading[`inc_${bed.bed_type}`]}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-500 disabled:opacity-40"
                              >
                                {actionLoading[`inc_${bed.bed_type}`] ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                              </button>
                            </div>
                            <div className="text-right text-[10px] text-slate-400">
                              {occupied} occupied · {available} free
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Incoming patients */}
              {(requestedHS.length > 0 || acceptedHS.length > 0) && (
                <section className="rounded-[26px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Incoming Patients ({requestedHS.length + acceptedHS.length})
                  </p>

                  <div className="mt-3 space-y-2">
                    {/* Accepted — waiting for arrival */}
                    {acceptedHS.map(hs => (
                      <div key={hs.id} className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-sm font-bold text-slate-900">{hs.transfer_code}</span>
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                ACCEPTED
                              </span>
                            </div>
                            <p className="text-sm text-slate-600">{hs.patient_summary || 'Patient'}</p>
                            <p className="text-[10px] text-slate-400 mt-1">
                              {BED_LABELS[hs.bed_type] || hs.bed_type}
                            </p>
                          </div>
                          <ArrivalVerify
                            onVerify={(code) => handleComplete(hs.id, code)}
                            loading={actionLoading[`hs_${hs.id}`]}
                          />
                        </div>
                      </div>
                    ))}

                    {/* Requested — pending */}
                    {requestedHS.map(hs => (
                      <div key={hs.id} className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm font-bold text-slate-900">{hs.transfer_code}</span>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            PENDING
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">{hs.patient_summary || 'Patient'}</p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Waiting for hospital to accept · {BED_LABELS[hs.bed_type] || hs.bed_type}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Quick stats */}
              <section className="rounded-[26px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Department Summary</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                    <p className="text-2xl font-bold text-slate-900">
                      {beds.reduce((s, b) => s + (b.available_count || 0), 0)}
                    </p>
                    <p className="text-[11px] text-slate-500">Available</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                    <p className="text-2xl font-bold text-slate-900">{acceptedHS.length}</p>
                    <p className="text-[11px] text-slate-500">Expected</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                    <p className="text-2xl font-bold text-slate-900">{requestedHS.length}</p>
                    <p className="text-[11px] text-slate-500">Pending</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline arrival verification — type transfer code to confirm
function ArrivalVerify({ onVerify, loading }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={loading}
        className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-emerald-500 px-3 text-xs font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
        Arrived
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <form onSubmit={e => { e.preventDefault(); if (code.trim()) onVerify(code.trim()); }} className="flex items-center gap-1.5">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="CODE"
          autoFocus
          maxLength={6}
          className="w-[76px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center font-mono text-sm font-bold tracking-widest text-slate-900 outline-none focus:border-emerald-400"
        />
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="inline-flex min-h-[34px] items-center gap-1 rounded-full bg-emerald-500 px-3 text-xs font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
        </button>
      </form>
      <button onClick={() => { setOpen(false); setCode(''); }} className="text-slate-400 hover:text-slate-600">
        <X size={14} />
      </button>
    </div>
  );
}
