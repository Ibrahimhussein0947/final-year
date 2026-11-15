import { useState } from 'react';
import { Alert, Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction, useAdminQuery } from '@/lib/admin';
import { api } from '@/lib/api';
import { useSkillSearch } from '@/lib/profile';
import type { TrainingCourse } from '@/components/TrainingSuggestions';

const blank = { title: '', provider: '', description: '', url: '', online: false, costEtb: '', durationText: '', languages: '', skills: [] as { id: string; name: string }[] };

function SkillPicker({ value, onChange }: { value: { id: string; name: string }[]; onChange: (v: { id: string; name: string }[]) => void }) {
  const [q, setQ] = useState('');
  const found = useSkillSearch(q);
  return (
    <div className="sm:col-span-2">
      <TextField label="Skills this course teaches (type to search)" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.data && found.data.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {found.data.filter((s) => !value.some((v) => v.id === s.id)).slice(0, 8).map((s) => (
            <li key={s.id}><button type="button" className="rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2" onClick={() => { onChange([...value, { id: s.id, name: s.nameEn }]); setQ(''); }}>+ {s.nameEn}</button></li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {value.map((s) => (
          <Badge key={s.id} tone="accent">{s.name} <button type="button" aria-label={`Remove ${s.name}`} className="ml-1" onClick={() => onChange(value.filter((v) => v.id !== s.id))}>×</button></Badge>
        ))}
        {value.length === 0 && <span className="text-sm text-muted">Choose at least one.</span>}
      </div>
    </div>
  );
}

function CourseForm({ initial, id, onDone }: { initial: typeof blank; id?: string; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const save = useAdminAction(
    () => {
      const body = {
        title: f.title, provider: f.provider, description: f.description || null, url: f.url || null, online: f.online,
        costEtb: f.costEtb.trim() === '' ? null : Number(f.costEtb), durationText: f.durationText || null,
        languages: f.languages.split(',').map((x) => x.trim()).filter(Boolean), skillIds: f.skills.map((s) => s.id),
      };
      return id ? api(`/admin/training/${id}`, { method: 'PATCH', body }) : api('/admin/training', { method: 'POST', body });
    },
    { invalidate: ['training'] },
  );
  return (
    <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onDone }); }}>
      <TextField label="Course title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <TextField label="Provider (school, centre or website)" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} />
      <TextField label="Web address (optional)" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      <TextField label="Duration (for example 6 weeks)" value={f.durationText} onChange={(e) => setF({ ...f, durationText: e.target.value })} />
      <TextField label="Cost in ETB (0 = free, empty = not stated)" inputMode="numeric" value={f.costEtb} onChange={(e) => setF({ ...f, costEtb: e.target.value.replace(/\D/g, '') })} />
      <TextField label="Languages taught (comma separated)" value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} />
      <TextField label="Short description (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.online} onChange={(e) => setF({ ...f, online: e.target.checked })} /> Can be taken online</label>
      <SkillPicker value={f.skills} onChange={(skills) => setF({ ...f, skills })} />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={save.isPending} disabled={f.title.trim().length < 3 || f.provider.trim().length < 2 || f.skills.length === 0}>{id ? 'Save course' : 'Add course'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {save.error && <p role="alert" className="text-sm text-danger">{save.error}</p>}
      </div>
    </form>
  );
}

function Row({ c }: { c: TrainingCourse }) {
  const [editing, setEditing] = useState(false);
  const toggle = useAdminAction(() => api(`/admin/training/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }), { invalidate: ['training'] });
  const remove = useAdminAction(() => api(`/admin/training/${c.id}`, { method: 'DELETE' }), { invalidate: ['training'] });
  if (editing) {
    return (
      <Card className="p-4">
        <CourseForm id={c.id} onDone={() => setEditing(false)} initial={{ title: c.title, provider: c.provider, description: c.description ?? '', url: c.url ?? '', online: c.online, costEtb: c.costEtb === null ? '' : String(c.costEtb), durationText: c.durationText ?? '', languages: c.languages.join(', '), skills: c.skills }} />
      </Card>
    );
  }
  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-semibold">{c.title} {!c.isActive && <Badge tone="neutral">Hidden</Badge>}</p>
        <p className="text-sm text-muted">{c.provider}{c.durationText ? ` · ${c.durationText}` : ''}{c.online ? ' · Online' : ''}{c.costEtb === null ? '' : c.free ? ' · Free' : ` · ${c.costEtb} ETB`}</p>
        <p className="mt-1 text-sm">Teaches: {c.skills.map((s) => s.name).join(', ')}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate()}>{c.isActive ? 'Hide' : 'Show'}</Button>
        <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => { if (window.confirm(`Delete "${c.title}"?`)) remove.mutate(); }}>Delete</Button>
      </div>
    </Card>
  );
}

export function AdminTraining() {
  const q = useAdminQuery<{ items: TrainingCourse[] }>(['training'], '/training');
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <Alert tone="info">
        Workers see these courses when a job or their field asks for a skill they do not list. Only add real courses you have checked. Nothing is shown to workers unless it is listed here.
      </Alert>
      {adding ? (
        <Card className="p-4"><CourseForm initial={blank} onDone={() => setAdding(false)} /></Card>
      ) : (
        <Button onClick={() => setAdding(true)}>Add a course</Button>
      )}
      {q.isLoading && <Skeleton className="h-32" />}
      {q.data?.items.length === 0 && !adding && <p className="text-sm text-muted">No courses yet.</p>}
      {q.data?.items.map((c) => <Row key={c.id} c={c} />)}
    </div>
  );
}
