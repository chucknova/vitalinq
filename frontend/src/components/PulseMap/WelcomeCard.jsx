/**
 * WelcomeCard — subtle onboarding tooltip for first-time visitors.
 *
 * Positioned bottom-center over the map. Explains what the interface shows
 * and points to the search panel. Dismisses on click and doesn't return.
 * 
 * Inspired by Salesforce coachmark — small, pointed, actionable.
 */

import { X, ArrowLeft } from 'lucide-react';

export default function WelcomeCard({ onDismiss }) {
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 animate-fade-in">
      <div className="bg-[#0d1320]/95 backdrop-blur-md border border-gray-700/50 rounded-2xl p-5 max-w-sm shadow-2xl shadow-black/40">
        {/* Close */}
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 text-gray-600 hover:text-gray-300 transition-colors"
        >
          <X size={14} />
        </button>

        {/* Content */}
        <p className="text-cyan-400 text-xs font-medium mb-2 tracking-wider uppercase">
          Welcome to BedSignal
        </p>
        <p className="text-gray-300 text-sm leading-relaxed">
          Each marker is a Lagos hospital. The number shows
          available beds right now. Colors tell you capacity at a glance.
        </p>

        {/* Legend mini */}
        <div className="flex items-center gap-4 mt-3 mb-4">
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-gray-400">Available</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-gray-400">Limited</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-gray-400">Full</span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="w-3 h-3 rounded-full bg-gray-500" />
            <span className="text-gray-400">Stale</span>
          </span>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-cyan-400 text-xs">
            <ArrowLeft size={12} />
            <span>Use the search panel to find help fast</span>
          </div>
          <button
            onClick={onDismiss}
            className="ml-auto bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
          >
            Got it
          </button>
        </div>
      </div>

      {/* Inject fade-in animation */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out both;
          animation-delay: 0.8s;
        }
      `}</style>
    </div>
  );
}
