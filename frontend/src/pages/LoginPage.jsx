/**
 * LoginPage — authentication page for BedSignal.
 *
 * Handles both login and signup. After login, redirects to the user's
 * dashboard based on their role (hospital or dispatch).
 */

import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader2, ShieldCheck, Building2, Truck, ArrowLeft, CircleDot } from 'lucide-react';
import api from '../lib/api';

export default function LoginPage() {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('hospital_admin');
  const [entityId, setEntityId] = useState('');
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user) {
      if (user.entity_slug) {
        navigate(
          user.role === 'hospital_admin'
            ? `/hospital/${user.entity_slug}/dashboard`
            : `/dispatch/${user.entity_slug}`,
          { replace: true }
        );
      } else {
        navigate(from, { replace: true });
      }
    }
  }, [user, navigate, from]);

  useEffect(() => {
    if (mode !== 'signup') return;
    setEntityId('');

    if (role === 'hospital_admin') {
      api.get('/api/hospitals')
        .then((res) => {
          setEntities((res.data.hospitals || []).map((hospital) => ({ id: hospital.id, name: hospital.name })));
        })
        .catch(() => setEntities([]));
    } else {
      api.get('/api/dispatch')
        .then((res) => {
          setEntities((res.data.companies || []).map((company) => ({ id: company.id, name: company.name })));
        })
        .catch(() => setEntities([]));
    }
  }, [mode, role]);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === 'login') {
        const userData = await login(email, password);
        if (userData.entity_slug) {
          navigate(
            userData.role === 'hospital_admin'
              ? `/hospital/${userData.entity_slug}/dashboard`
              : `/dispatch/${userData.entity_slug}`,
            { replace: true }
          );
        } else {
          navigate(from, { replace: true });
        }
      } else {
        const userData = await signup({
          email,
          password,
          full_name: fullName,
          role,
          hospital_id: role === 'hospital_admin' ? entityId || null : null,
          dispatch_company_id: role === 'dispatch_manager' ? entityId || null : null,
        });

        if (userData?.entity_slug) {
          navigate(
            userData.role === 'hospital_admin'
              ? `/hospital/${userData.entity_slug}/dashboard`
              : `/dispatch/${userData.entity_slug}`,
            { replace: true }
          );
        } else {
          navigate(from, { replace: true });
        }
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen px-4 py-6"
      style={{ background: 'radial-gradient(circle at top, #f7faf8 0%, #edf2ef 52%, #e3ebe7 100%)' }}
    >
      <div className="mx-auto max-w-[420px]">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft size={14} />
            Back
          </Link>
          <div className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-slate-900">
            <CircleDot size={12} className="text-emerald-500" />
            BedSignal
          </div>
        </div>

        <div className="rounded-[30px] border border-black/5 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.10)] sm:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
              <ShieldCheck size={20} className="text-slate-700" />
            </div>
            <h1 className="text-[2rem] font-semibold tracking-tight text-slate-950">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {mode === 'login'
                ? 'Log in to access your dashboard.'
                : 'Sign up to manage your hospital or dispatch team.'}
            </p>
          </div>

          <div className="mb-6 flex rounded-2xl border border-slate-200 bg-[#e8ece8] p-1">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 rounded-[14px] border py-2.5 text-sm font-medium transition ${
                mode === 'login'
                  ? 'border-white bg-white text-slate-950 shadow-sm'
                  : 'border-slate-200 bg-white/85 text-slate-800'
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null); }}
              className={`flex-1 rounded-[14px] border py-2.5 text-sm font-medium transition ${
                mode === 'signup'
                  ? 'border-white bg-white text-slate-950 shadow-sm'
                  : 'border-slate-200 bg-white/85 text-slate-800'
              }`}
            >
              Sign up
            </button>
          </div>

          {error ? (
            <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' ? (
              <Field label="Full name">
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Dr. Adebayo"
                  className={inputClassName}
                />
              </Field>
            ) : null}

            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@hospital.com"
                required
                className={inputClassName}
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className={inputClassName}
              />
            </Field>

            {mode === 'signup' ? (
              <>
                <Field label="I am a">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole('hospital_admin')}
                      className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-medium transition ${
                        role === 'hospital_admin'
                          ? 'border-sky-200 bg-sky-50 text-sky-700'
                          : 'border-slate-200 bg-white text-slate-800 shadow-sm'
                      }`}
                    >
                      <Building2 size={14} />
                      Hospital
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('dispatch_manager')}
                      className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-medium transition ${
                        role === 'dispatch_manager'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-800 shadow-sm'
                      }`}
                    >
                      <Truck size={14} />
                      Dispatch
                    </button>
                  </div>
                </Field>

                <Field label={role === 'hospital_admin' ? 'Select your hospital' : 'Select your company'}>
                  <select
                    value={entityId}
                    onChange={(event) => setEntityId(event.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select one</option>
                    {entities.map((entity) => (
                      <option key={entity.id} value={entity.id}>{entity.name}</option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-slate-800 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }}
              className="font-medium text-slate-900 transition hover:text-slate-700"
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputClassName = 'w-full rounded-2xl border border-slate-200 bg-[#f5f5f7] px-4 py-3 text-sm text-slate-900 placeholder-slate-500 outline-none transition-colors focus:border-slate-400 focus:bg-white';
