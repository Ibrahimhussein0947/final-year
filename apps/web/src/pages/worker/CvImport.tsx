import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileSearch } from 'lucide-react';
import { Alert, Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/pages/worker/sections';
import { api, ApiError } from '@/lib/api';
import type { CvAnalysisResult, CvDraft } from '@/lib/analysis';
import type { WorkerProfile } from '@/lib/profile';
import { EDU_LABEL } from '@/lib/format';

type On<T> = T & { on: boolean };
const input = 'h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm';

function Item({ on, onChange, children, existing }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; existing: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <input type="checkbox" className="mt-2 h-4 w-4" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label="Include" />
      <div className="min-w-0 flex-1">
        {existing && <Badge tone="info">Already on your profile</Badge>}
        {children}
      </div>
    </li>
  );
}

export function CvImport({ profile }: { profile: WorkerProfile }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [draft, setDraft] = useState<CvAnalysisResult | null>(null);
  const [skills, setSkills] = useState<On<CvDraft['skills'][number] & { proficiency: number }>[]>([]);
  const [exps, setExps] = useState<On<CvDraft['experiences'][number]>[]>([]);
  const [edus, setEdus] = useState<On<CvDraft['education'][number]>[]>([]);
  const [certs, setCerts] = useState<On<CvDraft['certifications'][number]>[]>([]);
  const [useYears, setUseYears] = useState(false);
  const [useBio, setUseBio] = useState(false);

  async function analyze() {
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await api<CvAnalysisResult>('/workers/me/cv/analyze', { method: 'POST' });
      const p = r.parsed;
      setDraft(r);
      setSkills(p.skills.map((s) => ({ ...s, on: !s.alreadyOnProfile, proficiency: 3 })));
      setExps(p.experiences.map((e) => ({ ...e, on: !e.alreadyOnProfile })));
      setEdus(p.education.map((e) => ({ ...e, on: !e.alreadyOnProfile })));
      setCerts(p.certifications.map((c) => ({ ...c, on: !c.alreadyOnProfile })));
      setUseYears(p.estimatedYearsExperience !== null && p.estimatedYearsExperience > profile.yearsExperience);
      setUseBio(!!p.summary && !profile.bio);
    } catch (e) {
      setDraft(null);
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      const month = (v: string) => (v.length === 7 ? `${v}-01` : v);
      const body = {
        skills: skills.filter((s) => s.on).map((s) => ({ skillId: s.skillId, proficiency: s.proficiency })),
        experiences: exps.filter((e) => e.on && e.title.trim().length >= 2).map((e) => ({ title: e.title.trim(), employer: e.employer?.trim() || null, startDate: month(e.startDate), endDate: e.endDate ? month(e.endDate) : null, description: e.description || null })),
        education: edus.filter((e) => e.on).map((e) => ({ level: e.level, field: e.field?.trim() || null, institution: e.institution?.trim() || null, year: e.year })),
        certifications: certs.filter((c) => c.on && c.name.trim().length >= 2).map((c) => ({ name: c.name.trim(), year: c.year })),
        ...(useYears && draft.parsed.estimatedYearsExperience !== null ? { yearsExperience: Math.round(draft.parsed.estimatedYearsExperience) } : {}),
        ...(useBio && draft.parsed.summary ? { bio: draft.parsed.summary } : {}),
      };
      const r = await api<{ added: Record<string, number>; skipped: Record<string, number>; profile: WorkerProfile }>('/workers/me/cv/apply', { method: 'POST', body });
      qc.setQueryData(['worker-profile'], r.profile);
      const n = r.added;
      setDone(`Saved: ${n.skills} skills, ${n.experiences} jobs, ${n.education} education, ${n.certifications} certificates.`);
      setDraft(null);
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string) ?? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const up = <T,>(list: T[], set: (l: T[]) => void, i: number, patch: Partial<T>) => set(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const p = draft?.parsed;

  return (
    <SectionCard title="Fill in my profile from my CV" description="Reads the CV you uploaded and suggests skills, jobs, education and certificates. You check and correct everything before anything is saved.">
      {!profile.cvUrl && <p className="text-sm text-muted">Upload a CV (a PDF, or a clear photo or scan) above first.</p>}
      {profile.cvUrl && !draft && (
        <Button variant="outline" loading={busy} onClick={analyze}><FileSearch className="h-4 w-4" aria-hidden /> Read my CV</Button>
      )}
      {busy && <p className="mt-2 text-sm text-muted">Reading your CV. A photo or scan can take up to a minute.</p>}
      {done && <div className="mt-3"><Alert tone="success">{done}</Alert></div>}
      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}

      {draft && p && (
        <div className="space-y-6">
          {draft.ocr?.used && (
            <Alert tone="warning">
              Your CV is a picture, so the text was read by OCR (text recognition){draft.ocr.confidence !== null ? `, about ${draft.ocr.confidence}% sure of the letters` : ''}. Letters and numbers can be misread, so check every line, especially dates and names, before you save.
            </Alert>
          )}
          <Alert tone="warning">
            Read by keyword rules, not by a language model, so some lines may be misread or missed. Only English text is understood, and every saved item is marked as self-reported.
            {p.warnings.map((w) => <span key={w} className="mt-1 block">{w}</span>)}
          </Alert>

          <section>
            <h3 className="font-semibold">Skills</h3>
            {skills.length === 0 && <p className="mt-1 text-sm text-muted">No skills from our list were found in your CV.</p>}
            <ul className="divide-y divide-border">
              {skills.map((s, i) => (
                <Item key={s.skillId} on={s.on} onChange={(v) => up(skills, setSkills, i, { on: v })} existing={s.alreadyOnProfile}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{s.name}</span>
                    <select aria-label={`Level for ${s.name}`} className="h-8 rounded border border-border bg-surface px-1 text-xs" value={s.proficiency} onChange={(e) => up(skills, setSkills, i, { proficiency: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Level {n}</option>)}
                    </select>
                    {s.inSkillsSection && <Badge tone="success">in your skills list</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs italic text-muted">“{s.evidence}”</p>
                </Item>
              ))}
            </ul>
            {p.unrecognizedSkills.length > 0 && <p className="mt-2 text-xs text-muted">Not in our skills list, so not imported: {p.unrecognizedSkills.join(', ')}</p>}
          </section>

          <section>
            <h3 className="font-semibold">Work history</h3>
            {exps.length === 0 && <p className="mt-1 text-sm text-muted">No jobs with dates were found.</p>}
            <ul className="divide-y divide-border">
              {exps.map((e, i) => (
                <Item key={i} on={e.on} onChange={(v) => up(exps, setExps, i, { on: v })} existing={e.alreadyOnProfile}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input aria-label="Job title" className={input} value={e.title} onChange={(ev) => up(exps, setExps, i, { title: ev.target.value })} />
                    <input aria-label="Employer" className={input} placeholder="Employer" value={e.employer ?? ''} onChange={(ev) => up(exps, setExps, i, { employer: ev.target.value })} />
                    <input aria-label="Start" type="month" className={input} value={e.startDate.slice(0, 7)} onChange={(ev) => up(exps, setExps, i, { startDate: ev.target.value })} />
                    <input aria-label="End (empty if current)" type="month" className={input} value={e.endDate?.slice(0, 7) ?? ''} onChange={(ev) => up(exps, setExps, i, { endDate: ev.target.value || null })} />
                  </div>
                </Item>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">Education and certificates</h3>
            {edus.length === 0 && certs.length === 0 && <p className="mt-1 text-sm text-muted">None found.</p>}
            <ul className="divide-y divide-border">
              {edus.map((e, i) => (
                <Item key={`e${i}`} on={e.on} onChange={(v) => up(edus, setEdus, i, { on: v })} existing={e.alreadyOnProfile}>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <select aria-label="Level" className={input} value={e.level} onChange={(ev) => up(edus, setEdus, i, { level: ev.target.value })}>
                      {Object.entries(EDU_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input aria-label="Field of study" className={input} placeholder="Field" value={e.field ?? ''} onChange={(ev) => up(edus, setEdus, i, { field: ev.target.value })} />
                    <input aria-label="Institution" className={input} placeholder="School" value={e.institution ?? ''} onChange={(ev) => up(edus, setEdus, i, { institution: ev.target.value })} />
                    <input aria-label="Year" className={input} inputMode="numeric" placeholder="Year" value={e.year ?? ''} onChange={(ev) => up(edus, setEdus, i, { year: ev.target.value ? Number(ev.target.value.replace(/\D/g, '')) || null : null })} />
                  </div>
                </Item>
              ))}
              {certs.map((c, i) => (
                <Item key={`c${i}`} on={c.on} onChange={(v) => up(certs, setCerts, i, { on: v })} existing={c.alreadyOnProfile}>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input aria-label="Certificate" className={`${input} sm:col-span-2`} value={c.name} onChange={(ev) => up(certs, setCerts, i, { name: ev.target.value })} />
                    <input aria-label="Certificate year" className={input} inputMode="numeric" placeholder="Year" value={c.year ?? ''} onChange={(ev) => up(certs, setCerts, i, { year: ev.target.value ? Number(ev.target.value.replace(/\D/g, '')) || null : null })} />
                  </div>
                </Item>
              ))}
            </ul>
          </section>

          <section className="space-y-2 text-sm">
            {p.estimatedYearsExperience !== null && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={useYears} onChange={(e) => setUseYears(e.target.checked)} /> Set my years of experience to {Math.round(p.estimatedYearsExperience)} (estimated from the dates; you currently have {profile.yearsExperience})</label>
            )}
            {p.summary && (
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={useBio} disabled={!!profile.bio} onChange={(e) => setUseBio(e.target.checked)} /> <span>Use the CV summary as my biography{profile.bio ? ' (you already have one, which is never overwritten)' : ''}: <span className="italic text-muted">“{p.summary.slice(0, 160)}{p.summary.length > 160 ? '…' : ''}”</span></span></label>
            )}
          </section>

          <div className="flex gap-3">
            <Button variant="accent" loading={busy} onClick={save}>Save selected to my profile</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
