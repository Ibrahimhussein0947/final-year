import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, BadgeCheck } from 'lucide-react';
import { Alert, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

interface Views {
  windowDays: number;
  organizations: number;
  totalViews: number;
  items: { organization: { name: string; type: string; verified: boolean }; firstViewedAt: string; lastViewedAt: string; viewCount: number }[];
}

const typeLabel = (t: string) => (t.length <= 3 ? t : t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));

export default function ProfileViewsPage() {
  const q = useQuery({ queryKey: ['profile-views'], queryFn: () => api<Views>('/workers/me/views') });

  return (
    <>
      <PageHeader title="Who viewed your profile" subtitle="Employers that opened your profile from the worker search." />
      <PageBody narrow>
        {q.isLoading && <Skeleton className="h-48" />}
        {q.isError && <Alert tone="danger">Could not load this list. Please refresh the page.</Alert>}
        {q.data && (
          <div className="space-y-4">
            <Card className="grid grid-cols-2 gap-4 p-5 text-center">
              <div><p className="text-3xl font-extrabold">{q.data.organizations}</p><p className="text-sm text-muted">organizations in the last {q.data.windowDays} days</p></div>
              <div><p className="text-3xl font-extrabold">{q.data.totalViews}</p><p className="text-sm text-muted">views in total</p></div>
            </Card>
            {q.data.items.length === 0 ? (
              <EmptyState icon={Eye} title="No views yet" body="A complete, visible profile with the right skills gets found more often." action={<Link to="/profile" className="font-semibold text-accent underline">Improve your profile</Link>} />
            ) : (
              <ul className="space-y-3">
                {q.data.items.map((v) => (
                  <li key={v.organization.name + v.firstViewedAt}>
                    <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
                      <div>
                        <p className="flex items-center gap-1.5 font-semibold">
                          {v.organization.name}
                          {v.organization.verified && <BadgeCheck className="h-4 w-4 text-accent" aria-label="Verified organization" />}
                        </p>
                        <p className="text-sm text-muted">{typeLabel(v.organization.type)}</p>
                      </div>
                      <div className="text-right text-sm">
                        <p>Last viewed {timeAgo(v.lastViewedAt)}</p>
                        <p className="text-muted">{v.viewCount} {v.viewCount === 1 ? 'view' : 'views'}</p>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              You see which organization looked, never which person. Only employers count. If you set your profile to hidden, employers cannot find you in the search.
            </p>
          </div>
        )}
      </PageBody>
    </>
  );
}
