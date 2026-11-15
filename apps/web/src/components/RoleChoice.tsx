import { forwardRef, type InputHTMLAttributes } from 'react';
import { Briefcase, Search } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Two large picture cards instead of a drop-down: "I need work" and "I am hiring". Works with react-hook-form's register. */
export const RoleChoice = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { current: string; workerLabel: string; employerLabel: string; legend: string }>(
  function RoleChoice({ current, workerLabel, employerLabel, legend, ...rest }, ref) {
    const items = [
      { value: 'WORKER', label: workerLabel, hint: 'Find a job', icon: Search },
      { value: 'EMPLOYER', label: employerLabel, hint: 'Find workers', icon: Briefcase },
    ];
    return (
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
        <div className="grid grid-cols-2 gap-3">
          {items.map((it) => (
            <label
              key={it.value}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 px-3 py-5 text-center transition-colors focus-within:ring-2 focus-within:ring-accent',
                current === it.value ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              <input type="radio" value={it.value} className="sr-only" ref={ref} {...rest} />
              <it.icon className="h-9 w-9" aria-hidden />
              <span className="text-base font-bold">{it.label}</span>
              <span className="text-xs text-muted">{it.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  },
);
