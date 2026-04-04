import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function HistoryNav({
  backFallback = '/',
  onBackFallback,
  className = '',
  buttonClassName = 'bg-white/10 hover:bg-white/15 text-white',
}) {
  const navigate = useNavigate();
  const historyIndex = typeof window !== 'undefined' ? window.history.state?.idx ?? 0 : 0;
  const canGoBack = historyIndex > 0;

  function handleBack() {
    if (canGoBack) {
      navigate(-1);
      return;
    }

    if (onBackFallback) {
      onBackFallback();
      return;
    }

    navigate(backFallback, { replace: true });
  }

  function handleForward() {
    navigate(1);
  }

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <button
        type="button"
        onClick={handleBack}
        className={`flex h-10 w-10 items-center justify-center rounded-full transition ${buttonClassName}`}
        aria-label="Go back"
        title="Go back"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        onClick={handleForward}
        className={`flex h-10 w-10 items-center justify-center rounded-full transition ${buttonClassName}`}
        aria-label="Go forward"
        title="Go forward"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
