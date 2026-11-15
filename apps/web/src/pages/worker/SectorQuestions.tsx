import { useEffect, useMemo, useState } from 'react';
import { Badge, SelectField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { CriterionField } from '@/components/CriterionField';
import { ApiError } from '@/lib/api';
import { defsForCategory, useCriteriaDefs, useLabel, useMyCriteria, useSaveMyCriteria, type AnswerValue } from '@/lib/criteria';
import { useCategories, type WorkerProfile } from '@/lib/profile';
import { SectionCard } from '@/pages/worker/sections';
import { VerifyControl } from '@/pages/worker/VerifyControl';

/**
 * Sector questions: licences, certificates, shifts, tools... Employers in your sector ask for these, and matching uses
 * them. A question you leave unanswered is never counted against you (it is shown to the employer as "not answered").
 * Answers are marked self-reported until an administrator checks the evidence you upload.
 */
export function SectorQuestions({ profile }: { profile: WorkerProfile }) {
  const defs = useCriteriaDefs();
  const mine = useMyCriteria();
  const categories = useCategories();
  const save = useSaveMyCriteria();
  const label = useLabel();
  const [sector, setSector] = useState<string>(profile.categoryId ?? '');
  const [draft, setDraft] = useState<Record<string, AnswerValue | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  const saved = useMemo(() => new Map((mine.data ?? []).map((m) => [m.criterionId, m])), [mine.data]);
  useEffect(() => {
    if (mine.data) setDraft(Object.fromEntries(mine.data.map((m) => [m.criterionId, m.value])));
  }, [mine.data]);

  const visible = defsForCategory(defs.data, sector || null);
  const changed = useMemo(
    () => (defs.data ?? []).filter((d) => JSON.stringify(draft[d.id] ?? null) !== JSON.stringify(saved.get(d.id)?.value ?? null)),
    [defs.data, draft, saved],
  );

  async function onSave() {
    setError(null);
    setSavedAt(false);
    try {
      await save.mutateAsync(changed.map((d) => ({ criterionId: d.id, value: draft[d.id] ?? null })));
      setSavedAt(true);
    } catch (e) {
      const details = e instanceof ApiError ? (Object.values(e.details ?? {}).flat() as string[]) : [];
      setError(details[0] ?? (e instanceof ApiError ? e.message : 'Could not save. Check your connection and try again.'));
    }
  }

  return (
    <SectionCard
      title="Sector details"
      description="Employers in your field ask about things like licences, certificates, shifts and tools. Answer what applies to you. Unanswered questions are not held against you."
    >
      <div className="mb-4 max-w-sm">
        <SelectField label="Questions for sector" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">Only questions for every sector</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
        </SelectField>
      </div>
      {!profile.categoryId && !sector && <p className="mb-3 text-sm text-muted">Choose your main category in "Basics" above, or pick a sector here, to see sector questions.</p>}

      <ul className="divide-y divide-border">
        {visible.map((d) => {
          const row = saved.get(d.id);
          return (
            <li key={d.id} className="py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{label(d)}</p>
                {d.category === null && <span className="text-[11px] text-muted">all sectors</span>}
                {row?.source === 'VERIFIED' && <Badge tone="success">Verified</Badge>}
                {row && row.source !== 'VERIFIED' && <Badge tone="neutral">Self-reported</Badge>}
              </div>
              {d.helpEn && <p className="text-xs text-muted">{d.helpEn}</p>}
              <div className="mt-2"><CriterionField def={d} mode="answer" value={draft[d.id]} onChange={(v) => { setSavedAt(false); setDraft((x) => ({ ...x, [d.id]: v })); }} /></div>
              {row && d.evidenceSuggested && row.source !== 'VERIFIED' && !changed.includes(d) && (
                <div className="mt-2"><VerifyControl targetType="CRITERION" targetId={row.id} /></div>
              )}
              {row && d.evidenceSuggested && changed.includes(d) && <p className="mt-2 text-xs text-muted">Save first, then you can upload proof.</p>}
            </li>
          );
        })}
        {defs.isSuccess && visible.length === 0 && <li className="py-3 text-sm text-muted">No sector questions for this selection yet.</li>}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={onSave} loading={save.isPending} disabled={changed.length === 0}>Save sector details</Button>
        {savedAt && <span role="status" className="text-sm font-medium text-success">Saved</span>}
        {error && <span role="alert" className="text-sm text-danger">{error}</span>}
        {changed.length > 0 && !save.isPending && <span className="text-xs text-muted">{changed.length} unsaved change{changed.length === 1 ? '' : 's'}</span>}
      </div>
    </SectionCard>
  );
}
