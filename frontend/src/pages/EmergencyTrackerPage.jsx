import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Ambulance,
  BedDouble,
  Bell,
  Building2,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPinned,
  Phone,
  ShieldAlert,
} from 'lucide-react';
import api from '../lib/api';
import useHandshake from '../hooks/useHandshake';

const ACTIVE_TRANSPORT_POLL_MS = 10000;
const STABLE_TRANSPORT_POLL_MS = 20000;

const ASSIGNMENT_LABELS = {
  assigned: 'Ambulance assigned',
  dispatched: 'Ambulance dispatched',
  en_route_to_patient: 'Heading to patient',
  at_scene: 'At pickup point',
  en_route_to_hospital: 'Heading to hospital',
  delivered: 'Arrived at hospital',
  rerouted: 'Destination changed',
};

function formatTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function DetailRow({ icon, label, value }) {
  if (!value) return null;
  const Icon = icon;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
      <Icon size={15} className="mt-0.5 text-sky-300" />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-100">{value}</p>
      </div>
    </div>
  );
}

function Step({ icon, label, detail, active, done }) {
  const Icon = icon;
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border ${
        done ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300' :
        active ? 'border-sky-400/40 bg-sky-500/15 text-sky-300' :
        'border-white/[0.08] bg-white/[0.04] text-slate-500'
      }`}>
        <Icon size={16} />
      </div>
      <div className="pb-4">
        <p className={`text-sm font-medium ${done || active ? 'text-white' : 'text-slate-400'}`}>{label}</p>
        {detail ? <p className="mt-1 text-xs leading-relaxed text-slate-400">{detail}</p> : null}
      </div>
    </div>
  );
}

export default function EmergencyTrackerPage() {
  const { handshakeId } = useParams();
  const { handshake, countdown, loading } = useHandshake(handshakeId);
  const [transport, setTransport] = useState(null);
  const [transportLoading, setTransportLoading] = useState(true);
  const assignmentStatus = transport?._assignment_status;
  const transportPollMs = assignmentStatus && !['assigned', 'dispatched', 'en_route_to_patient', 'at_scene'].includes(assignmentStatus)
    ? STABLE_TRANSPORT_POLL_MS
    : ACTIVE_TRANSPORT_POLL_MS;

  useEffect(() => {
    if (!handshakeId) return;
    let active = true;

    async function pollTransport() {
      try {
        const res = await api.get(`/api/transport/by-handshake/${handshakeId}?include_timeline=1`);
        if (active) setTransport(res.data.transport || null);
      } catch {
        if (active) setTransport(null);
      } finally {
        if (active) setTransportLoading(false);
      }
    }

    pollTransport();
    const interval = setInterval(pollTransport, transportPollMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [handshakeId, transportPollMs]);

  if (loading && !handshake) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#08101b]">
        <Loader2 size={24} className="animate-spin text-sky-400" />
      </div>
    );
  }

  if (!handshake) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#08101b] p-6">
        <div className="max-w-md rounded-3xl border border-white/[0.08] bg-[#0d1523] px-6 py-8 text-center">
          <ShieldAlert size={34} className="mx-auto text-red-400" />
          <p className="mt-4 text-[1rem] font-semibold text-white sm:text-lg">Tracker not found</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            This emergency link may have expired or may be incorrect.
          </p>
        </div>
      </div>
    );
  }

  const contactPhone = handshake.parsed_requirements?.contact_phone;
  const emergencyPhone = handshake.parsed_requirements?.emergency_contact_phone;
  const timeline = transport?._timeline || [];
  const currentHospital = transport?._hospital || handshake.receiving_hospital;

  return (
    <div className="min-h-screen bg-[#08101b] px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-[28px] border border-white/[0.08] bg-[#0d1523] px-6 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-sky-300">Emergency tracker</p>
          <h1 className="mt-3 text-[1.85rem] font-semibold tracking-tight text-white sm:text-3xl">Live request updates</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-400 sm:text-sm">
            This is a read-only link for following the same hospital request and ambulance updates.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <DetailRow icon={BedDouble} label="Booking code" value={handshake.transfer_code} />
            <DetailRow
              icon={countdown > 0 ? Clock3 : CheckCircle2}
              label="Current status"
              value={handshake.status.replace(/_/g, ' ')}
            />
            <DetailRow icon={Phone} label="Phone" value={contactPhone} />
            <DetailRow icon={ShieldAlert} label="Emergency contact" value={emergencyPhone} />
            <DetailRow icon={Building2} label="Hospital" value={currentHospital?.name} />
            <DetailRow icon={MapPinned} label="Address" value={currentHospital?.address} />
          </div>

          {handshake.patient_summary ? (
            <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Notes</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{handshake.patient_summary}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-white/[0.08] bg-[#0d1523] px-6 py-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500">Hospital request</p>
          <div className="mt-4 space-y-1">
            <Step icon={BedDouble} label="Request created" done detail={currentHospital?.name} />
            <Step icon={Bell} label="Hospital notified" done />
            <Step
              icon={handshake.status === 'declined' || handshake.status === 'expired' || handshake.status === 'overridden' ? ShieldAlert : Clock3}
              label={handshake.status === 'accepted' ? 'Bed confirmed' : handshake.status.replace(/_/g, ' ')}
              active={['requested'].includes(handshake.status)}
              done={['accepted', 'completed'].includes(handshake.status)}
              detail={
                handshake.status === 'accepted' && countdown > 0
                  ? `Spot held for ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`
                  : handshake.status === 'completed'
                  ? 'Arrival has been confirmed.'
                  : undefined
              }
            />
          </div>
        </div>

        <div className="rounded-[28px] border border-white/[0.08] bg-[#0d1523] px-6 py-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500">Transport</p>
              <p className="mt-2 text-sm text-slate-300">
                {transport
                  ? transport.status.replace(/_/g, ' ')
                  : transportLoading
                  ? 'Checking transport...'
                  : 'No ambulance requested yet'}
              </p>
            </div>
            <Ambulance size={18} className="text-sky-300" />
          </div>

          {transport ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <DetailRow icon={MapPinned} label="Pickup" value={transport.pickup_address} />
                <DetailRow
                  icon={Ambulance}
                  label="Ambulance"
                  value={transport._ambulance?.vehicle_id || transport._company?.name || transport.crew_phone}
                />
              </div>

              <div className="mt-4 space-y-1">
                {timeline.length > 0 ? timeline.map((entry) => (
                  <Step
                    key={`${entry.status}-${entry.created_at}`}
                    icon={entry.status === 'rerouted' ? ShieldAlert : Ambulance}
                    label={ASSIGNMENT_LABELS[entry.status] || entry.status.replace(/_/g, ' ')}
                    done={entry.status !== assignmentStatus}
                    active={entry.status === assignmentStatus}
                    detail={[entry.note, formatTime(entry.created_at)].filter(Boolean).join(' • ')}
                  />
                )) : (
                  <Step
                    icon={Ambulance}
                    label="Waiting for transport updates"
                    active
                    detail="We’ll show ambulance progress here as soon as it moves forward."
                  />
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
