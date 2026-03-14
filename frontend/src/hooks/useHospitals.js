import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import api from '../lib/api';

/**
 * useHospitals — fetches hospitals + subscribes to realtime bed updates.
 *
 * When a nurse updates bed counts via WhatsApp, the hospital_beds table
 * changes in Supabase. This hook listens for those changes and updates
 * the map instantly — no refresh needed.
 */
export default function useHospitals() {
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initial fetch
  useEffect(() => {
    async function fetchHospitals() {
      try {
        const res = await api.get('/api/hospitals', {
          params: { city: 'Lagos', include_beds: true },
        });
        setHospitals(res.data.hospitals);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch hospitals:', err);
        setError('Failed to load hospital data');
      } finally {
        setLoading(false);
      }
    }
    fetchHospitals();
  }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('bed-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'hospital_beds',
        },
        (payload) => {
          console.log('🔄 Realtime bed update:', payload);
          const updatedBed = payload.new;
          if (!updatedBed) return;

          setHospitals((prev) =>
            prev.map((hospital) => {
              if (hospital.id !== updatedBed.hospital_id) return hospital;

              // Update the matching bed in this hospital's beds array
              const updatedBeds = hospital.beds.map((bed) => {
                if (bed.bed_type === updatedBed.bed_type) {
                  return { ...bed, ...updatedBed };
                }
                return bed;
              });

              // If bed type didn't exist, add it
              const exists = hospital.beds.some(
                (b) => b.bed_type === updatedBed.bed_type
              );
              if (!exists) {
                updatedBeds.push(updatedBed);
              }

              return {
                ...hospital,
                beds: updatedBeds,
                last_report_at: updatedBed.reported_at || hospital.last_report_at,
              };
            })
          );
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription:', status);
      });

    // Also subscribe to hospital-level changes (trust tier, accuracy)
    const hospitalChannel = supabase
      .channel('hospital-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'hospitals',
        },
        (payload) => {
          console.log('🔄 Realtime hospital update:', payload);
          const updated = payload.new;
          if (!updated) return;

          setHospitals((prev) =>
            prev.map((h) => {
              if (h.id !== updated.id) return h;
              return {
                ...h,
                trust_tier: updated.trust_tier || h.trust_tier,
                accuracy_score: updated.accuracy_score ?? h.accuracy_score,
                freshness_score: updated.freshness_score ?? h.freshness_score,
                last_report_at: updated.last_report_at || h.last_report_at,
              };
            })
          );
        }
      )
      .subscribe();

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(hospitalChannel);
    };
  }, []);

  return { hospitals, loading, error, setHospitals };
}
