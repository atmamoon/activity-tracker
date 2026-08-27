import { useStore } from '../state/store';

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-icon">
            {t.kind === 'success' ? '✓' : t.kind === 'error' ? '⚠' : 'ℹ'}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
