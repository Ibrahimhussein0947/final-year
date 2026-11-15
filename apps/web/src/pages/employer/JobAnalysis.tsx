import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Alert, Badge, Card } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import type { Confidence, JobAnalysis } from '@/lib/analysis';
import { EDU_LABEL, MODE_LABEL, TYPE_LABEL } from '@/lib/format';

export interface AnalysisSelection {
  skills: { skillId: string; name: string; importance: 'REQUIRED' | 'PREFERRED' }[];
  minExperienceYears?: number | null;
  requiredEducationLevel?: string | null;
  employmentType?: string;
  workMode?: string;
  categoryId?: string;
  languages?: string[];
  salary?: { min: number | null; max: number | null };
}

const TONE: Record<Confidence, 'success' | 'warning' | 'neutral'> = { high: 'success', medium: 'warning', low: 'neutral' };

function Row({ checked, onChange, label, children, confidence, evidence }: { checked: boolean; onChange: (v: boolean) => void; label: string; children: React.ReactNode; confidence?: Confidence; evidence?: string | null }) {
  return (
    <li className="py-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{label}</span> <span className="font-medium">{children}</span>
            {confidence && <Badge tone={TONE[confidence]}>{confidence === 'low' ? 'default guess' : `${confidence} confidence`}</Badge>}
          </span>
          {evidence && <span className="mt-0.5 block text-xs italic text-muted">“{evidence}”</span>}
        </span>
      </label>
    </li>
  );
}

/**
 * Analyse the job text with keyword rules and let the employer pick what to use. Nothing is applied until they
 * press the button, and every suggestion shows the words it came from.
 */
export function JobAnalysisPanel({ title, description, onApply }: { title: string; description: string; onApply: (s: AnalysisSelection) => void }) {
  const [result, setResult] = useState<JobAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [importance, setImportance] = useState<Record<string, 'REQUIRED' | 'PREFERRED'>>({});

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ analysis: JobAnalysis }>('/analysis/job', { method: 'POST', body: { title: title || undefined, description } });
      const a = r.analysis;
      setResult(a);
      // Pre-select everything that came from the text itself; leave guesses (default values) unselected.
      const next: Record<string, boolean> = {};
      a.skills.forEach((s) => (next[`skill:${s.skillId}`] = true));
      next.exp = !!a.minExperienceYears;
      next.edu = !!a.requiredEducationLevel;
      next.type = a.employmentType.confidence !== 'low';
      next.mode = a.workMode.confidence !== 'low';
      next.cat = !!a.category;
      next.lang = !!a.languages;
      next.salary = !!a.salary && a.salary.confidence === 'high';
      setSel(next);
      setImportance(Object.fromEntries(a.skills.map((s) => [s.skillId, s.importance])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    const out: AnalysisSelection = {
      skills: result.skills.filter((s) => sel[`skill:${s.skillId}`]).map((s) => ({ skillId: s.skillId, name: s.name, importance: importance[s.skillId] ?? s.importance })),
    };
    if (sel.exp && result.minExperienceYears) out.minExperienceYears = result.minExperienceYears.value;
    if (sel.edu && result.requiredEducationLevel) out.requiredEducationLevel = result.requiredEducationLevel.value;
    if (sel.type) out.employmentType = result.employmentType.value;
    if (sel.mode) out.workMode = result.workMode.value;
    if (sel.cat && result.category) out.categoryId = result.category.value.id;
    if (sel.lang && result.languages) out.languages = result.languages.value;
    if (sel.salary && result.salary) out.salary = result.salary.value;
    onApply(out);
    setResult(null);
  }

  const set = (k: string) => (v: boolean) => setSel((s) => ({ ...s, [k]: v }));
  const canRun = description.trim().length >= 20;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" loading={busy} disabled={!canRun} onClick={run}>
          <Sparkles className="h-4 w-4" aria-hidden /> Suggest requirements from my description
        </Button>
        {!canRun && <span className="text-xs text-muted">Write a few sentences first.</span>}
      </div>
      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}

      {result && (
        <Card className="mt-4 border-accent p-5">
          <h3 className="font-semibold">Suggestions from your description</h3>
          <p className="mt-1 text-xs text-muted">Found with keyword rules and our list of skills, not by a language model, so it can miss things or guess wrong. Tick what is right; nothing changes until you press “Use selected”.</p>

          <ul className="mt-3 divide-y divide-border">
            {result.skills.map((s) => (
              <Row key={s.skillId} checked={!!sel[`skill:${s.skillId}`]} onChange={set(`skill:${s.skillId}`)} label="Skill" confidence={s.confidence} evidence={s.evidence}>
                {s.name}{' '}
                <select
                  aria-label={`Importance of ${s.name}`}
                  className="ml-1 h-7 rounded border border-border bg-surface px-1 text-xs"
                  value={importance[s.skillId] ?? s.importance}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setImportance((m) => ({ ...m, [s.skillId]: e.target.value as 'REQUIRED' | 'PREFERRED' }))}
                >
                  <option value="REQUIRED">Required</option>
                  <option value="PREFERRED">Nice to have</option>
                </select>
              </Row>
            ))}
            {result.minExperienceYears && (
              <Row checked={!!sel.exp} onChange={set('exp')} label="Experience" confidence={result.minExperienceYears.confidence} evidence={result.minExperienceYears.evidence}>
                {result.minExperienceYears.value === null ? 'No minimum' : `${result.minExperienceYears.value}+ years`}
              </Row>
            )}
            {result.requiredEducationLevel && (
              <Row checked={!!sel.edu} onChange={set('edu')} label="Qualification" confidence={result.requiredEducationLevel.confidence} evidence={result.requiredEducationLevel.evidence}>
                {result.requiredEducationLevel.value ? EDU_LABEL[result.requiredEducationLevel.value] : 'None required'}
              </Row>
            )}
            <Row checked={!!sel.type} onChange={set('type')} label="Employment type" confidence={result.employmentType.confidence} evidence={result.employmentType.evidence}>{TYPE_LABEL[result.employmentType.value]}</Row>
            <Row checked={!!sel.mode} onChange={set('mode')} label="Work arrangement" confidence={result.workMode.confidence} evidence={result.workMode.evidence}>{MODE_LABEL[result.workMode.value]}</Row>
            {result.category && (
              <Row checked={!!sel.cat} onChange={set('cat')} label="Category" confidence={result.category.confidence} evidence={result.category.evidence}>{result.category.value.name}</Row>
            )}
            {result.languages && <Row checked={!!sel.lang} onChange={set('lang')} label="Languages" confidence={result.languages.confidence}>{result.languages.value.join(', ')}</Row>}
            {result.salary && (
              <Row checked={!!sel.salary} onChange={set('salary')} label="Salary" confidence={result.salary.confidence} evidence={result.salary.evidence}>
                {[result.salary.value.min?.toLocaleString('en-US'), result.salary.value.max?.toLocaleString('en-US')].filter(Boolean).join(' to ')} ETB
              </Row>
            )}
          </ul>

          {result.notes.map((n) => <p key={n} className="mt-2 text-sm text-warning">{n}</p>)}
          <div className="mt-4 flex gap-3">
            <Button type="button" variant="accent" size="sm" onClick={apply}>Use selected</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setResult(null)}>Dismiss</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
