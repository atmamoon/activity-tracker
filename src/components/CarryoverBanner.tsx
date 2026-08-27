import { useState } from 'react';
import { useStore } from '../state/store';

export default function CarryoverBanner() {
  const candidates = useStore((s) => s.carryoverCandidates);
  const carryover = useStore((s) => s.carryover);
  const date = useStore((s) => s.date);
  const today = useStore((s) => s.today);
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (candidates.length === 0 || date < today || dismissed === date) return null;

  return (
    <div className="carryover-banner">
      <div className="carryover-text">
        <b>{candidates.length}</b> unfinished task{candidates.length > 1 ? 's' : ''} from earlier
        day{candidates.length > 1 ? 's' : ''}:{' '}
        <span className="carryover-titles">
          {candidates
            .slice(0, 3)
            .map((t) => t.title)
            .join(', ')}
          {candidates.length > 3 ? '…' : ''}
        </span>
      </div>
      <div className="carryover-actions">
        <button className="pill-btn accent" onClick={() => carryover(candidates.map((t) => t.id))}>
          Bring here
        </button>
        <button className="pill-btn subtle" onClick={() => setDismissed(date)}>
          Not now
        </button>
      </div>
    </div>
  );
}
