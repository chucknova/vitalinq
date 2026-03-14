import { useState, useEffect } from 'react';
import api from '../../lib/api';

/**
 * TimeSlider — scrub through 24 hours to see predicted capacity.
 *
 * Fetches surge_predictions from the API and lets users drag a slider
 * to see how hospital occupancy changes throughout the day.
 * The parent component receives the predictions and adjusts dot colors.
 */
export default function TimeSlider({ onPredictionsChange }) {
  const [hour, setHour] = useState(new Date().getHours());
  const [dayOfWeek, setDayOfWeek] = useState(getDayOfWeek());
  const [predictions, setPredictions] = useState([]);
  const [isActive, setIsActive] = useState(false);

  // Fetch predictions when day/hour changes
  useEffect(() => {
    if (!isActive) {
      onPredictionsChange(null); // null = show live data
      return;
    }

    async function fetchPredictions() {
      try {
        const res = await api.get('/api/hospitals', {
          params: { city: 'Lagos', include_beds: true },
        });
        // For now, we'll use the surge_predictions directly from Supabase
        // since there's no dedicated predictions endpoint yet
        setPredictions(res.data.hospitals);
        onPredictionsChange({ hour, dayOfWeek });
      } catch (err) {
        console.error('Failed to fetch predictions:', err);
      }
    }
    fetchPredictions();
  }, [hour, dayOfWeek, isActive]);

  function handleSliderChange(e) {
    setHour(parseInt(e.target.value));
  }

  function toggleActive() {
    setIsActive(!isActive);
  }

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hourLabel = `${hour.toString().padStart(2, '0')}:00`;

  return (
    <div className="absolute bottom-6 right-6 z-10 bg-gray-900/90 backdrop-blur-sm rounded-xl p-4 min-w-[280px]">
      {/* Toggle */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-white text-xs font-medium">
          Surge Pulse
          {isActive && (
            <span className="text-blue-400 ml-1">· Prediction Mode</span>
          )}
        </span>
        <button
          onClick={toggleActive}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            isActive ? 'bg-blue-500' : 'bg-gray-600'
          }`}
        >
          <div
            className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${
              isActive ? 'left-5.5' : 'left-0.5'
            }`}
            style={{ left: isActive ? '22px' : '2px' }}
          />
        </button>
      </div>

      {isActive && (
        <>
          {/* Day selector */}
          <div className="flex gap-1 mb-3">
            {dayNames.map((name, i) => (
              <button
                key={i}
                onClick={() => setDayOfWeek(i)}
                className={`text-[10px] px-2 py-1 rounded transition-colors ${
                  dayOfWeek === i
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Hour slider */}
          <div className="mb-1">
            <input
              type="range"
              min="0"
              max="23"
              value={hour}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none
                         [&::-webkit-slider-thumb]:w-4
                         [&::-webkit-slider-thumb]:h-4
                         [&::-webkit-slider-thumb]:bg-blue-400
                         [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:cursor-pointer"
            />
          </div>

          {/* Time display */}
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>00:00</span>
            <span className="text-blue-400 font-bold text-xs">{hourLabel}</span>
            <span>23:00</span>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-700">
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full bg-green-500" /> &lt;70%
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> 70-85%
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full bg-red-500" /> &gt;85%
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function getDayOfWeek() {
  // PRD convention: 0=Monday, 6=Sunday
  const jsDay = new Date().getDay(); // 0=Sunday
  return jsDay === 0 ? 6 : jsDay - 1;
}
