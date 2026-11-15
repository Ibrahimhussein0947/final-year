import { useEffect } from 'react';
import { CriterionField } from '@/components/CriterionField';
import { defsForCategory, useCriteriaDefs, useLabel, type AnswerValue, type JobRequirement } from '@/lib/criteria';

/**
 * Sector requirements for a job. "Must have" is for conditions that are not a matter of degree (a licence, a
 * registration): people who clearly lack it are not recommended. "Preferred" only raises the score. Only ask for what
 * the work needs: requirements about gender, age, religion, ethnicity or marital status are not allowed.
 */
export function SectorRequirements({ categoryId, value, onChange, filterMode = false }: { categoryId: string; value: JobRequirement[]; onChange: (v: JobRequirement[]) => void; /** used by worker search: no must-have / preferred choice */ filterMode?: boolean }) {
  const defs = useCriteriaDefs();
  const label = useLabel();
  const visible = defsForCategory(defs.data, categoryId || null);

  // Changing the category removes requirements that belong to the old sector.
  useEffect(() => {
    if (!defs.data || !categoryId) return;
    const ok = new Set(visible.map((d) => d.id));
    if (value.some((r) => !ok.has(r.criterionId))) onChange(value.filter((r) => ok.has(r.criterionId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, defs.data]);

  if (!categoryId) return <p className="text-sm text-muted">Choose a category above to see the requirements that matter in that sector.</p>;
  if (defs.isLoading) return <p className="text-sm text-muted">Loading sector requirements…</p>;
  if (visible.length === 0) return <p className="text-sm text-muted">No sector requirements are defined for this category yet.</p>;

  const byId = new Map(value.map((r) => [r.criterionId, r]));
  const set = (id: string, next: JobRequirement | null) => onChange(next ? [...value.filter((r) => r.criterionId !== id), next] : value.filter((r) => r.criterionId !== id));
  const initial = (type: string): AnswerValue => (type === 'BOOLEAN' ? true : type === 'NUMBER' ? 1 : []);

  return (
    <ul className="divide-y divide-border">
      {visible.map((d) => {
        const r = byId.get(d.id);
        return (
          <li key={d.id} className="py-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={!!r}
                onChange={(e) => set(d.id, e.target.checked ? { criterionId: d.id, importance: 'PREFERRED', value: initial(d.type) } : null)} />
              <span>
                <span className="text-sm font-medium">{label(d)}</span>
                {d.category === null && <span className="ml-2 text-[11px] text-muted">all sectors</span>}
                {d.helpEn && <span className="block text-xs text-muted">{d.helpEn}</span>}
              </span>
            </label>
            {r && (
              <div className="ml-7 mt-2 space-y-2">
                <CriterionField def={d} mode="requirement" value={r.value} onChange={(v) => set(d.id, v === undefined ? null : { ...r, value: v })} />
                {!filterMode && <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">This is</span>
                  <select aria-label={`How important: ${label(d)}`} className="h-9 rounded-xl border border-border bg-surface px-2 text-sm" value={r.importance}
                    onChange={(e) => set(d.id, { ...r, importance: e.target.value as JobRequirement['importance'] })}>
                    <option value="PREFERRED">preferred (raises the score)</option>
                    {d.mustHaveAllowed && <option value="MUST_HAVE">a must-have (people without it are not recommended)</option>}
                  </select>
                </div>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
