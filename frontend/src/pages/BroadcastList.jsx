/**
 * BroadcastList — view all emergency broadcasts.
 *
 * Route: /broadcast
 * Shows active broadcasts first, then resolved. Click to open dashboard.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Radio, Plus, Clock, Users, Building2, MapPin, Trash2, Ambulance
} from 'lucide-react';
import api from '../lib/api';

function timeSince(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function BroadcastList() {
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/broadcast');
        setBroadcasts(res.data.broadcasts || []);
      } catch (err) {
        console.error('Failed to load broadcasts:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleDelete(broadcastId) {
    try {
      await api.delete(`/api/broadcast/${broadcastId}`);
      setBroadcasts(prev => prev.filter(b => b.id !== broadcastId));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  const active = broadcasts.filter(b => b.status === 'active');
  const resolved = broadcasts.filter(b => b.status !== 'active');

  return (
    <div className="min-h-screen bg-[#0a0f1a]">
      {/* Header */}
      <div className="border-b border-gray-800/50 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-white text-lg font-semibold flex items-center gap-2">
                <Radio size={18} className="text-red-400" />
                Emergency Broadcasts
              </h1>
              <p className="text-gray-500 text-xs mt-0.5">Mass casualty incident coordination</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/dispatch"
              className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-gray-300 text-sm font-medium px-4 py-2 rounded-lg transition-all flex items-center gap-2"
            >
              <Ambulance size={14} />
              Dispatch Queue
            </Link>
            <Link
              to="/broadcast/new"
              className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all flex items-center gap-2"
            >
              <Plus size={14} />
              New Broadcast
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center py-16">
            <div className="w-8 h-8 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading broadcasts...</p>
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="text-center py-16">
            <Radio size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm mb-1">No broadcasts yet</p>
            <p className="text-gray-600 text-xs mb-4">Emergency broadcasts will appear here when triggered.</p>
            <Link
              to="/broadcast/new"
              className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
            >
              <Plus size={14} />
              Create First Broadcast
            </Link>
          </div>
        ) : (
          <>
            {/* Active broadcasts */}
            {active.length > 0 && (
              <div className="mb-8">
                <h2 className="text-red-400 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                  Active ({active.length})
                </h2>
                <div className="space-y-2">
                  {active.map(b => (
                    <BroadcastCard key={b.id} broadcast={b} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            )}

            {/* Resolved broadcasts */}
            {resolved.length > 0 && (
              <div>
                <h2 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                  Resolved ({resolved.length})
                </h2>
                <div className="space-y-2">
                  {resolved.map(b => (
                    <BroadcastCard key={b.id} broadcast={b} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


function BroadcastCard({ broadcast: b, onDelete }) {
  const isActive = b.status === 'active';

  return (
    <div className={`bg-[#151d2e] border rounded-xl p-4 transition-all hover:bg-[#1a2435] ${
      isActive ? 'border-red-500/30 hover:border-red-500/50' : 'border-gray-800/50 hover:border-gray-700'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <Link to={`/broadcast/${b.id}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Radio size={12} className={isActive ? 'text-red-400 animate-pulse' : 'text-gray-600'} />
            <h3 className="text-white text-sm font-semibold truncate">{b.title}</h3>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              isActive ? 'bg-red-500/20 text-red-400' : 'bg-gray-700/50 text-gray-500'
            }`}>
              {b.status.toUpperCase()}
            </span>
          </div>

          {b.description && (
            <p className="text-gray-400 text-xs line-clamp-1 mb-2">{b.description}</p>
          )}

          <div className="flex items-center gap-4 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <Clock size={10} /> {timeSince(b.created_at)}
            </span>
            <span className="flex items-center gap-1">
              <Building2 size={10} />
              <span className={b.hospitals_responded > 0 ? 'text-cyan-400' : ''}>
                {b.hospitals_responded}/{b.hospitals_pinged}
              </span> responded
            </span>
            <span className="flex items-center gap-1">
              <Users size={10} /> ~{b.expected_patients} expected
            </span>
            <span className="flex items-center gap-1">
              <MapPin size={10} /> {b.radius_km}km radius
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Evidence thumbnail */}
          {b.images && b.images.length > 0 && (
            <div className="w-14 h-14 rounded-lg overflow-hidden border border-gray-700/50">
              <img src={b.images[0]} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          {/* Delete button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm(`Delete broadcast "${b.title}"? This removes all patients and responses.`)) {
                onDelete(b.id);
              }
            }}
            className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
