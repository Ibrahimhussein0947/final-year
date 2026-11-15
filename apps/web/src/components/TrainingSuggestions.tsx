import { useQuery } from '@tanstack/react-query';
import { GraduationCap, ExternalLink, MapPin, Wifi } from 'lucide-react';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export interface TrainingCourse {
  id: string; title: string; provider: string; description: string | null; url: string | null; online: boolean;
  location: { id: string; name: string } | null; costEtb: number | null; free: boolean; durationText: string | null; languages: string[];
  isActive: boolean; skills: { id: string; name: string }[];
}
interface Suggestions {
  basis: 'job' | 'market';
  job: { id: string; title: string } | null;
  gaps: { skillId: string; name: string; reason: string; hasCourse: boolean }[];
  items: (TrainingCourse & { covers: string[]; nearYou: boolean })[];
  note: string;
}

const cost = (c: TrainingCourse) => (c.costEtb === null ? 'Cost not stated' : c.free ? 'Free' : `${c.costEtb.toLocaleString('en-US')} ETB`);

/** Courses that teach the skills a worker is missing, for one job or in general. Shows nothing when there is no gap. */
export function TrainingSuggestions({ jobId, title = 'Learn the skills you are missing' }: { jobId?: string; title?: string }) {
  const q = useQuery({
    queryKey: ['training-suggestions', jobId ?? 'market'],
    queryFn: () => api<Suggestions>(`/training/suggestions${jobId ? `?jobId=${jobId}` : ''}`),
  });
  if (q.isLoading) return <Skeleton className="mt-6 h-32" />;
  if (!q.data || q.data.gaps.length === 0) return null;
  const d = q.data;
  const unmatched = d.gaps.filter((g) => !g.hasCourse);

  return (
    <Card className="mt-6 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><GraduationCap className="h-4 w-4 text-accent" aria-hidden />{title}</h2>
      <p className="mt-1 text-sm text-muted">
        {d.basis === 'job' ? 'This job also asks for' : 'Open jobs in your field often ask for'}: {d.gaps.map((g) => g.name).join(', ')}.
      </p>

      {d.items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No training has been listed for these skills yet. Check back later.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {d.items.map((c) => (
            <li key={c.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-sm text-muted">{c.provider}</p>
                </div>
                <Badge tone={c.free ? 'success' : 'neutral'}>{cost(c)}</Badge>
              </div>
              <p className="mt-1 text-sm">Teaches: {c.covers.join(', ')}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                {c.online && <span className="inline-flex items-center gap-1"><Wifi className="h-3.5 w-3.5" aria-hidden />Online</span>}
                {c.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{c.location.name}{c.nearYou ? ' (near you)' : ''}</span>}
                {c.durationText && <span>{c.durationText}</span>}
                {c.languages.length > 0 && <span>{c.languages.join(', ')}</span>}
              </p>
              {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
              {c.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Open course page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {d.items.length > 0 && unmatched.length > 0 && <p className="mt-3 text-xs text-muted">No course listed yet for: {unmatched.map((g) => g.name).join(', ')}.</p>}
      <p className="mt-3 text-xs text-muted">{d.note}</p>
    </Card>
  );
}
