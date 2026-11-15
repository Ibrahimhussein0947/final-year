import { useState } from 'react';
import { cn } from '@/lib/cn';
import { CATEGORIES } from '@/lib/taxonomy';

const shortName = (name: string) => name.split(/ and |, /)[0];

/** Big picture tiles for choosing a kind of work with one tap, for people who find icons easier than lists. */
const FIRST = 12;

export function CategoryTiles({ value, onChange }: { value: string | null; onChange: (slug: string) => void }) {
  const [all, setAll] = useState(false);
  // Keep a chosen tile visible even when the list is collapsed.
  const shown = all ? CATEGORIES : CATEGORIES.filter((c, i) => i < FIRST || c.slug === value);
  return (
    <div role="group" aria-label="Kind of work" className="mt-4">
      <p className="mb-2 text-sm font-semibold">Tap the kind of work you want</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {shown.map((c) => {
          const on = value === c.slug;
          return (
            <li key={c.slug}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? '' : c.slug)}
                className={cn(
                  'flex h-full min-h-[5.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center text-xs font-semibold transition-colors',
                  on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <c.icon className="h-7 w-7" aria-hidden />
                <span>{shortName(c.name)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {CATEGORIES.length > FIRST && (
        <button type="button" className="mt-2 text-sm font-medium text-accent hover:underline" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${CATEGORIES.length} kinds of work`}
        </button>
      )}
    </div>
  );
}
