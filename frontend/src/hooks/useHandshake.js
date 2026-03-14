import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

/**
 * useHandshake — polls a handshake's status until it resolves.
 *
 * Starts polling when handshakeId is set. Stops when status
 * reaches a terminal state (accepted, declined, expired, completed).
 * Polls every 3 seconds for snappy UI updates.
 */
export default function useHandshake(handshakeId) {
  const [handshake, setHandshake] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!handshakeId) {
      setHandshake(null);
      return;
    }

    setLoading(true);
    setError(null);

    async function poll() {
      try {
        const res = await api.get(`/api/handshakes/${handshakeId}`);
        setHandshake(res.data);
        setLoading(false);

        // Stop polling on terminal states
        const terminal = ['accepted', 'declined', 'expired', 'completed'];
        if (terminal.includes(res.data.status)) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } catch (err) {
        console.error('Handshake poll failed:', err);
        setError('Failed to check status');
        setLoading(false);
      }
    }

    // First fetch immediately
    poll();

    // Then poll every 3 seconds
    intervalRef.current = setInterval(poll, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [handshakeId]);

  return { handshake, loading, error };
}
