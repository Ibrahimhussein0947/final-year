import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Alert, Badge, SelectField, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/pages/worker/sections';
import { api, ApiError } from '@/lib/api';
import { useProtectedImage, type WorkerProfile } from '@/lib/profile';

export interface PortfolioItem { id: string; url: string; caption: string | null; skillId: string | null; skill: string | null; createdAt: string }
const MAX_ITEMS = 8;

/** A picture that needs the signed-in session to load. */
export function PortfolioPicture({ item, className = '' }: { item: Pick<PortfolioItem, 'url' | 'caption'>; className?: string }) {
  const src = useProtectedImage(item.url);
  return src
    ? <img src={src} alt={item.caption ?? 'Photo of finished work'} loading="lazy" className={`aspect-[4/3] w-full rounded-xl object-cover ${className}`} />
    : <div className={`aspect-[4/3] w-full animate-pulse rounded-xl bg-surface-2 ${className}`} aria-hidden />;
}

const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) ?? e.message : 'Could not reach the server. Try again.');

/** The worker's own editor: add photos of finished work, say what each shows, and delete them. */
export function PortfolioSection({ profile }: { profile: WorkerProfile }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portfolio'], queryFn: async () => (await api<{ items: PortfolioItem[] }>('/workers/me/portfolio')).items });
  const [caption, setCaption] = useState('');
  const [skillId, setSkillId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['portfolio'] });
  const add = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      if (caption.trim()) body.append('caption', caption.trim());
      if (skillId) body.append('skillId', skillId);
      return api('/workers/me/portfolio', { method: 'POST', body });
    },
    onSuccess: async () => { setError(null); setCaption(''); setSkillId(''); await refresh(); },
    onError: (e) => setError(errText(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/workers/me/portfolio/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => setError(errText(e)),
  });
  const items = q.data ?? [];
  const full = items.length >= MAX_ITEMS;

  return (
    <SectionCard id="portfolio" title="Photos of my work" description="Show employers what you can do: a table you made, a dress you sewed, a wall you built. Up to 8 photos. Employers see them on your profile.">
      {items.length === 0 && !q.isLoading && <p className="mb-4 text-sm text-muted">No photos yet. A few clear photos of finished work help people trust what you say you can do.</p>}
      {items.length > 0 && (
        <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((i) => (
            <li key={i.id} className="space-y-1.5">
              <PortfolioPicture item={i} />
              <p className="line-clamp-2 text-sm">{i.caption ?? <span className="text-muted">No description</span>}</p>
              <div className="flex items-center justify-between gap-2">
                {i.skill ? <Badge tone="info">{i.skill}</Badge> : <span />}
                <button type="button" aria-label={`Delete photo${i.caption ? `: ${i.caption}` : ''}`} className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => { if (window.confirm('Delete this photo?')) del.mutate(i.id); }}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="What does the photo show? (optional)" maxLength={120} placeholder="e.g. Wardrobe I built for a client in Adama" value={caption} onChange={(e) => setCaption(e.target.value)} />
        <SelectField label="Which of your skills is it? (optional)" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
          <option value="">Not sure</option>
          {profile.skills.map((s) => <option key={s.skillId} value={s.skillId}>{s.name}</option>)}
        </SelectField>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" aria-label="Choose a photo of your work" onChange={(e) => { const f = e.target.files?.[0]; if (f) add.mutate(f); e.target.value = ''; }} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" loading={add.isPending} disabled={full} onClick={() => input.current?.click()}><ImagePlus className="h-4 w-4" aria-hidden /> Add a photo</Button>
        {full && <span className="text-sm text-muted">You have the most photos allowed. Delete one to add another.</span>}
      </div>
      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
      <p className="mt-3 text-xs text-muted">Only photos of your own work. JPG or PNG. We remove hidden information such as the place a photo was taken. Nobody checks that the work is yours, and employers are told these are shown by you.</p>
    </SectionCard>
  );
}

/** What an employer sees: the photos, labelled as shown by the worker. */
export function PortfolioGallery({ items }: { items: PortfolioItem[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-2 font-semibold">Photos of work</h3>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((i) => (
          <li key={i.id} className="space-y-1">
            <PortfolioPicture item={i} />
            {(i.caption || i.skill) && <p className="text-xs text-muted">{[i.caption, i.skill].filter(Boolean).join(' · ')}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Shown by the worker. Nobody has checked that the work is theirs.</p>
    </section>
  );
}
