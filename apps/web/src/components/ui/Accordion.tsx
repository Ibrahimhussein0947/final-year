import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <h3>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium hover:bg-surface-2"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                {item.q}
                <ChevronDown className={cn('h-5 w-5 shrink-0 transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
            </h3>
            {isOpen && <p className="px-5 pb-5 text-sm text-muted">{item.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
