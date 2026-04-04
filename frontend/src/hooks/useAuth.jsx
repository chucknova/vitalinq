/**
 * useAuth — authentication context for BedSignal.
 *
 * Stores the access token in localStorage, provides login/signup/logout,
 * and auto-loads the user profile on mount.
 *
 * Usage:
 *   import { AuthProvider, useAuth } from '../hooks/useAuth';
 *
 *   // In App.jsx: wrap with <AuthProvider>
 *   // In components: const { user, login, signup, logout, loading } = useAuth();
 */
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'bedsignal_token';
const USER_KEY = 'bedsignal_user';
const USER_VERIFIED_AT_KEY = 'bedsignal_user_verified_at';
const USER_CACHE_TTL_MS = 5 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;

    const cached = localStorage.getItem(USER_KEY);
    if (!cached) return null;

    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;

    const cached = localStorage.getItem(USER_KEY);
    const verifiedAtRaw = localStorage.getItem(USER_VERIFIED_AT_KEY);
    const verifiedAt = Number.parseInt(verifiedAtRaw || '', 10);
    const isFresh = Boolean(cached) && Number.isFinite(verifiedAt) && (Date.now() - verifiedAt) < USER_CACHE_TTL_MS;
    return !isFresh && !cached;
  });

  const setCachedUser = useCallback((nextUser) => {
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    localStorage.setItem(USER_VERIFIED_AT_KEY, String(Date.now()));
  }, []);

  const clearCachedAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(USER_VERIFIED_AT_KEY);
  }, []);

  // Attach token to all API requests
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }

    // Add interceptor to handle 401s (expired tokens)
    const interceptor = api.interceptors.response.use(
      (res) => res,
      (err) => {
        const hadAuthHeader = Boolean(err.config?.headers?.Authorization);
        if (err.response?.status === 401 && hadAuthHeader && !err.config?.skipAuthLogout) {
          clearCachedAuth();
          delete api.defaults.headers.common['Authorization'];
          setUser(null);
        }
        return Promise.reject(err);
      }
    );

    return () => api.interceptors.response.eject(interceptor);
  }, [clearCachedAuth]);

  // Load user on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const verifiedAtRaw = localStorage.getItem(USER_VERIFIED_AT_KEY);
    const verifiedAt = Number.parseInt(verifiedAtRaw || '', 10);

    if (!token) {
      return;
    }

    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

    const cached = localStorage.getItem(USER_KEY);
    const isFresh = Number.isFinite(verifiedAt) && (Date.now() - verifiedAt) < USER_CACHE_TTL_MS;
    if (cached && isFresh) {
      return;
    }

    const shouldBlockOnBootstrap = !cached;
    api.get('/api/auth/me')
      .then((res) => {
        setUser(res.data);
        setCachedUser(res.data);
      })
      .catch(() => {
        clearCachedAuth();
        delete api.defaults.headers.common['Authorization'];
        setUser(null);
      })
      .finally(() => {
        if (shouldBlockOnBootstrap) {
          setLoading(false);
        }
      });
  }, [clearCachedAuth, setCachedUser]);

  const login = useCallback(async (email, password) => {
    const res = await api.post('/api/auth/login', { email, password });
    const { access_token, user: userData } = res.data;

    localStorage.setItem(TOKEN_KEY, access_token);
    setCachedUser(userData);
    api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    setUser(userData);

    return userData;
  }, [setCachedUser]);

  const signup = useCallback(async ({ email, password, full_name, role, hospital_id, dispatch_company_id }) => {
    const res = await api.post('/api/auth/signup', {
      email, password, full_name, role, hospital_id, dispatch_company_id,
    });

    const { access_token } = res.data;

    if (access_token) {
      localStorage.setItem(TOKEN_KEY, access_token);
      api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;

      // Fetch full profile
      const meRes = await api.get('/api/auth/me');
      setCachedUser(meRes.data);
      setUser(meRes.data);
      return meRes.data;
    }

    return res.data;
  }, [setCachedUser]);

  const logout = useCallback(() => {
    clearCachedAuth();
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  }, [clearCachedAuth]);

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
