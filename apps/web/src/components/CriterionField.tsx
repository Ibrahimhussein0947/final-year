import { useId } from 'react';
import { cn } from '@/lib/cn';
import { labelFor, type AnswerValue, type CriterionDef } from '@/lib/criteria';
import { useI18n } from '@/i18n';

const inputClass = 'h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * One input for a sector criterion, shaped by its type.
 *  mode "answer":      a worker describing themselves (yes/no, number, one option, several options)
 *  mode "requirement": an employer asking for something (yes, a minimum, any of these options, all of these options)
 * `value` undefined means "not answered": it is never silently turned into No or 0.
 */
export function CriterionField({
  def, value, onChange, mode,
}: { def: CriterionDef; value: AnswerValue | undefined; onChange: (v: AnswerValue | undefined) => void; mode: 'answer' | 'requirement' }) {
  const { locale } = useI18n();
  const id = useId();
  const name = labelFor(def, locale);

  if (def.type === 'BOOLEAN') {
    if (mode === 'requirement') return <p className="text-sm text-muted">Required: yes</p>;
    return (
      <div role="radiogroup" aria-label={name} className="flex gap-2">
        {([[true, 'Yes'], [false, 'No']] as const).map(([v, l]) => (
          <button key={l} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(value === v ? undefined : v)}
            className={cn('h-9 min-w-16 rounded-xl border px-3 text-sm font-medium', value === v ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface')}>
            {l}
          </button>
        ))}
        {value !== undefined && <button type="button" className="text-xs text-muted underline" onClick={() => onChange(undefined)}>clear</button>}
      </div>
    );
  }

  if (def.type === 'NUMBER') {
    return (
      <div className="flex items-center gap-2">
        <input id={id} aria-label={name} type="number" inputMode="numeric" className={cn(inputClass, 'max-w-32')} min={def.minValue ?? undefined} max={def.maxValue ?? undefined}
          placeholder={mode === 'requirement' ? 'minimum' : ''} value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
        {def.unit && <span className="text-sm text-muted">{def.unit}</span>}
      </div>
    );
  }

  const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  // A worker picks ONE option for a CHOICE question; every other case is a set of checkboxes.
  if (def.type === 'CHOICE' && mode === 'answer') {
    return (
      <select id={id} aria-label={name} className={inputClass} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Not answered</option>
        {def.options.map((o) => <option key={o.value} value={o.value}>{labelFor(o, locale)}</option>)}
      </select>
    );
  }
  const hint = mode === 'requirement' ? (def.type === 'CHOICE' ? 'Any of these is fine' : 'The worker needs all of these') : '';
  return (
    <fieldset>
      <legend className="sr-only">{name}</legend>
      <div className="flex flex-wrap gap-2">
        {def.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label key={o.value} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm', on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface')}>
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={on}
                onChange={() => { const next = on ? selected.filter((x) => x !== o.value) : [...selected, o.value]; onChange(next.length ? next : mode === 'answer' && def.type === 'MULTI_CHOICE' ? [] : undefined); }} />
              {labelFor(o, locale)}
            </label>
          );
        })}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
