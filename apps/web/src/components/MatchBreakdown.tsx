import { cn } from '@/lib/cn';

/** Circular score indicator, 0-100. */
export function ScoreRing({ value, size = 88, label = 'Match score' }: { value: number; size?: number; label?: string }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label} ${pct} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="8" className="stroke-surface-2" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="stroke-accent transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-bold">{Math.round(pct)}</span>
    </div>
  );
}

/** One labeled horizontal bar for a score component in [0,1]. */
export function ComponentBar({ label, value, className }: { label: string; value: number | null; className?: string }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  return (
    <div className={cn('text-sm', className)}>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span className="font-medium text-muted">{value === null ? 'n/a' : `${pct}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
