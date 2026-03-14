import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

/**
 * useHandshake — polls a handshake's status and manages countdown timer.
 *
 * Keeps polling through "accepted" (so it can detect "completed").
 * Only stops on truly terminal states: declined, expired, completed.
 * Manages a local countdown timer that ticks every second for smooth UI.
 */
export default function useHandshake(handshakeId) {
  const [handshake, setHandshake] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  // Polling
  useEffect(() => {
    if (!handshakeId) {
      setHandshake(null);
      setCountdown(null);
      return;
    }

    setLoading(true);
    setError(null);

    async function poll() {
      try {
        const res = await api.get(`/api/handshakes/${handshakeId}`);
        setHandshake(res.data);
        setLoading(false);

        // Sync countdown from server on each poll
        if (res.data.status === 'accepted' && res.data.time_remaining_sec > 0) {
          setCountdown(res.data.time_remaining_sec);
        }

        // Only stop polling on truly terminal states
        const terminal = ['declined', 'expired', 'completed'];
        if (terminal.includes(res.data.status)) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setCountdown(null);
        }
      } catch (err) {
        console.error('Handshake poll failed:', err);
        setError('Failed to check status');
        setLoading(false);
      }
    }

    // First fetch immediately
    poll();

    // Poll every 3 seconds
    pollRef.current = setInterval(poll, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [handshakeId]);

  // Local countdown timer — ticks every second for smooth UI
  useEffect(() => {
    if (countdown === null || countdown <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [countdown !== null && countdown > 0]);

  return { handshake, loading, error, countdown };
}