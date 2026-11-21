import { useState } from 'react';
import { Alert, Card, SelectField, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction } from '@/lib/admin';
import { api } from '@/lib/api';
import { useLocations, type Option } from '@/lib/profile';
import { useQueryClient } from '@tanstack/react-query';

const LEVELS = ['Region', 'Zone or city', 'Woreda', 'Kebele'];
const CHILD_OF = ['zone', 'woreda', 'kebele'];

/** One level of the chain: pick a place, and the next level appears below it. */
function LevelSelect({ label, parentId, value, onChange }: { label: string; parentId?: string; value: string; onChange: (id: string) => void }) {
  const q = useLocations(parentId);
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">–</option>
      {q.data?.map((l) => <option key={l.id} value={l.id}>{l.nameEn}</option>)}
    </SelectField>
  );
}

function LabelRow({ place, onSaved }: { place: Option; onSaved: () => void }) {
  const [f, setF] = useState({ nameAm: place.nameAm ?? '', nameOm: place.nameOm ?? '' });
  const dirty = f.nameAm !== (place.nameAm ?? '') || f.nameOm !== (place.nameOm ?? '');
  const save = useAdminAction(() => api(`/admin/locations/${place.id}`, { method: 'PATCH', body: { nameAm: f.nameAm || null, nameOm: f.nameOm || null } }), { invalidate: [] });
  return (
    <li className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <div className="pb-2 text-sm font-medium">{place.nameEn}</div>
      <TextField label="Amharic" lang="am" value={f.nameAm} onChange={(e) => setF({ ...f, nameAm: e.target.value })} />
      <TextField label="Afaan Oromoo" lang="om" value={f.nameOm} onChange={(e) => setF({ ...f, nameOm: e.target.value })} />
      <Button type="button" variant="outline" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>Save</Button>
    </li>
  );
}

export function AdminPlaces() {
  const qc = useQueryClient();
  const [chain, setChain] = useState<string[]>([]);
  const [f, setF] = useState({ nameEn: '', nameAm: '', nameOm: '' });
  const [added, setAdded] = useState<string | null>(null);
  const parentId = chain[chain.length - 1];
  const children = useLocations(parentId);
  const levelsShown = Math.min(chain.length + 1, 3); // the picker stops at woreda: kebeles are what you add or label below it
  const refresh = () => qc.invalidateQueries({ queryKey: ['locations'] });
  const add = useAdminAction(
    () => api('/admin/locations', { method: 'POST', body: { parentId, nameEn: f.nameEn, nameAm: f.nameAm || null, nameOm: f.nameOm || null } }),
    { invalidate: [] },
  );
  const childKind = parentId ? CHILD_OF[chain.length - 1] : null;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Places</h2>
        <p className="mt-1 text-sm text-muted">
          Regions, zones and woredas come from the official OCHA/HDX list, in English only. Choose a place to add the kebeles inside a woreda, or to add the Amharic and Afaan Oromoo names people will see.
          Labels you type here should be checked by a native speaker.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: levelsShown }, (_, i) => (
            <LevelSelect key={i} label={LEVELS[i]} parentId={i === 0 ? undefined : chain[i - 1]} value={chain[i] ?? ''} onChange={(id) => { setAdded(null); setChain((c) => [...c.slice(0, i), ...(id ? [id] : [])]); }} />
          ))}
        </div>
      </Card>

      {parentId && childKind && (
        <Card className="p-5">
          <h3 className="font-semibold">Add a {childKind}</h3>
          <form
            noValidate
            className="mt-3 grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(undefined, { onSuccess: () => { setAdded(f.nameEn); setF({ nameEn: '', nameAm: '', nameOm: '' }); refresh(); } });
            }}
          >
            <TextField label="Name in English" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
            <TextField label="Amharic (optional)" lang="am" value={f.nameAm} onChange={(e) => setF({ ...f, nameAm: e.target.value })} />
            <TextField label="Afaan Oromoo (optional)" lang="om" value={f.nameOm} onChange={(e) => setF({ ...f, nameOm: e.target.value })} />
            <div className="flex items-center gap-3 sm:col-span-3">
              <Button type="submit" loading={add.isPending} disabled={f.nameEn.trim().length < 1}>Add {childKind}</Button>
              {added && <span className="text-sm text-success" role="status">Added “{added}”.</span>}
            </div>
            {add.error && <div className="sm:col-span-3"><Alert tone="danger">{add.error}</Alert></div>}
          </form>
        </Card>
      )}

      {parentId && (
        <Card className="p-5">
          <h3 className="font-semibold">Names inside the chosen place</h3>
          {children.isLoading ? <Skeleton className="mt-3 h-10" /> : children.data && children.data.length > 0 ? (
            <ul className="mt-3 space-y-3">
              {children.data.map((p) => <LabelRow key={`${p.id}-${p.nameAm}-${p.nameOm}`} place={p} onSaved={refresh} />)}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">Nothing inside this place yet.</p>}
        </Card>
      )}
    </div>
  );
}
