import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Ambulance, Loader2, MapPin, Phone, RefreshCw } from 'lucide-react';
import api from '../lib/api';

function timeSince(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

const URGENCY_STYLES = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/25',
  high: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  medium: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
  low: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
};

export default function TransportQueue() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});

  async function fetchRequests() {
    try {
      const res = await api.get('/api/transport/requests');
      setRequests(res.data.requests || []);
    } catch (err) {
      console.error('Failed to load transport requests:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRequests();
    const interval = setInterval(fetchRequests, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleDispatch(handshakeId, providerId) {
    setActionLoading((prev) => ({ ...prev, [handshakeId]: true }));
    try {
      await api.post(`/api/transport/requests/${handshakeId}/dispatch`, {
        provider_id: providerId,
      });
      await fetchRequests();
    } catch (err) {
      console.error('Dispatch failed:', err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [handshakeId]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a]">
      <div className="border-b border-gray-800/50 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-white text-lg font-semibold flex items-center gap-2">
                <Ambulance size={18} className="text-red-400" />
                Transport Queue
              </h1>
              <p className="text-gray-500 text-xs mt-0.5">Accepted bed holds that also need pickup coordination</p>
            </div>
          </div>
          <button
            onClick={fetchRequests}
            className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-gray-300 text-sm font-medium px-3.5 py-2 rounded-xl transition-all flex items-center gap-2"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center py-16">
            <Loader2 size={24} className="text-red-400 animate-spin mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading transport requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-16">
            <Ambulance size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm mb-1">No active transport requests</p>
            <p className="text-gray-600 text-xs">Requests appear here when a patient taps “I need transport”.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const urgency = request.urgency || 'medium';
              const transport = request.transport || {};
              const suggestions = request.provider_suggestions || [];

              return (
                <div key={request.handshake_id} className="bg-[#151d2e] border border-gray-800/50 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-mono font-bold">{request.transfer_code}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full border ${URGENCY_STYLES[urgency] || URGENCY_STYLES.medium}`}>
                          {urgency}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase px-2 py-1 rounded-full ${
                          transport.status === 'dispatched'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}>
                          {transport.status}
                        </span>
                      </div>
                      <p className="text-gray-200 text-sm leading-relaxed max-w-2xl">
                        {request.patient_summary || 'Emergency patient awaiting transport'}
                      </p>
                      <p className="text-gray-500 text-xs flex items-center gap-1.5">
                        <MapPin size={12} />
                        Pickup: {request.pickup_address || 'Patient live location'}
                      </p>
                      <p className="text-gray-500 text-xs">
                        Destination: <span className="text-gray-300">{request.destination_hospital?.name || 'Receiving hospital'}</span>
                        {request.destination_hospital?.address ? `, ${request.destination_hospital.address}` : ''}
                      </p>
                    </div>

                    <div className="text-right min-w-[130px]">
                      <p className="text-gray-600 text-[11px]">Requested</p>
                      <p className="text-gray-300 text-sm">{timeSince(transport.requested_at || request.created_at)}</p>
                      {transport.provider_eta_min && (
                        <>
                          <p className="text-gray-600 text-[11px] mt-3">ETA</p>
                          <p className="text-emerald-300 text-xl font-semibold">{transport.provider_eta_min} min</p>
                        </>
                      )}
                    </div>
                  </div>

                  {transport.status === 'dispatched' ? (
                    <div className="mt-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-emerald-300 text-sm font-semibold">{transport.provider_name || 'Provider assigned'}</p>
                        <p className="text-gray-400 text-xs mt-1">Patient and receiving hospital have been alerted.</p>
                      </div>
                      {transport.provider_phone && (
                        <a
                          href={`tel:${transport.provider_phone}`}
                          className="text-emerald-300 text-xs font-medium flex items-center gap-1.5"
                        >
                          <Phone size={12} />
                          {transport.provider_phone}
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="text-gray-500 text-xs font-medium mb-2.5">Suggested ambulance-capable providers</p>
                      <div className="space-y-2">
                        {suggestions.map((provider) => (
                          <div key={provider.provider_id} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <p className="text-white text-sm font-medium">{provider.name}</p>
                              <p className="text-gray-500 text-xs mt-1">
                                {provider.distance_km}km away, about {provider.eta_min} min
                              </p>
                            </div>
                            <button
                              onClick={() => handleDispatch(request.handshake_id, provider.provider_id)}
                              disabled={actionLoading[request.handshake_id]}
                              className="min-h-[40px] bg-red-500 hover:bg-red-600 disabled:bg-gray-700 text-white text-xs font-semibold px-4 rounded-lg transition-all flex items-center justify-center gap-2"
                            >
                              {actionLoading[request.handshake_id] ? <Loader2 size={12} className="animate-spin" /> : <Ambulance size={12} />}
                              Dispatch
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
