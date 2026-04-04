/**
 * ProtectedRoute — wraps pages that require authentication.
 *
 * Usage:
 *   <Route path="/hospital/:slug/dashboard" element={
 *     <ProtectedRoute role="hospital_admin">
 *       <HospitalDashboard />
 *     </ProtectedRoute>
 *   } />
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0f1a]">
        <Loader2 size={24} className="animate-spin text-sky-400" />
      </div>
    );
  }

  if (!user) {
    // Redirect to login, preserving the intended destination
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Check role if specified
  if (role && user.role !== role && user.role !== 'super_admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0f1a] p-6">
        <div className="text-center">
          <p className="text-white text-lg font-semibold mb-2">Access denied</p>
          <p className="text-slate-400 text-sm mb-4">
            You're logged in as <span className="text-white">{user.role?.replace('_', ' ')}</span>,
            but this page requires <span className="text-white">{role?.replace('_', ' ')}</span> access.
          </p>
          <a href="/" className="text-sky-400 text-sm hover:underline">Back to map</a>
        </div>
      </div>
    );
  }

  return children;
}