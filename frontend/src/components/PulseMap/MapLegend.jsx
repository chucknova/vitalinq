/**
 * MapLegend — persistent color legend in the corner of the map.
 * Small, unobtrusive, always visible so colors always have meaning.
 */

export default function MapLegend() {
  return (
    <div className="absolute top-5 right-5 z-10 bg-[#0d1320]/80 backdrop-blur-sm border border-gray-800/50 rounded-lg px-3 py-2">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
          <span className="text-[10px] text-gray-400">&gt;50% beds available</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]" />
          <span className="text-[10px] text-gray-400">Limited / overflow</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]" />
          <span className="text-[10px] text-gray-400">Full or near-full</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-500" />
          <span className="text-[10px] text-gray-400">Stale data (&gt;8hr)</span>
        </div>
      </div>
    </div>
  );
}
