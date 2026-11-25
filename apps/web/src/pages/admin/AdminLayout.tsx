import { NavLink, Outlet } from 'react-router-dom';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { cn } from '@/lib/cn';
import { GlobalSearch } from './pagesInsights';

const GROUPS: { title: string; tabs: [string, string][] }[] = [
  { title: 'Dashboard', tabs: [['/admin', 'Overview'], ['/admin/analytics', 'Analytics and reports'], ['/admin/performance', 'Performance']] },
  { title: 'People and organizations', tabs: [['/admin/users', 'Users'], ['/admin/organizations', 'Organizations'], ['/admin/verification', 'Verification'], ['/admin/support', 'Support inbox'], ['/admin/team', 'Administrators']] },
  { title: 'Jobs and safety', tabs: [['/admin/jobs', 'Jobs and applications'], ['/admin/moderation', 'Moderation'], ['/admin/hiring', 'Hiring rules'], ['/admin/criteria', 'Sector criteria']] },
  { title: 'Content', tabs: [['/admin/announcements', 'Announcements'], ['/admin/taxonomy', 'Skills and categories'], ['/admin/translations', 'Translations'], ['/admin/places', 'Places'], ['/admin/training', 'Training']] },
  { title: 'System', tabs: [['/admin/matching', 'Matching and AI'], ['/admin/plans', 'Subscriptions'], ['/admin/settings', 'Settings and health'], ['/admin/deliveries', 'Delivery log'], ['/admin/backups', 'Backups'], ['/admin/audit', 'Activity log']] },
];

const link = ({ isActive }: { isActive: boolean }) =>
  cn('block rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap', isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text');

export function AdminLayout() {
  return (
    <>
      <PageHeader title="Administration" subtitle="Manage users, trust and safety, the skill list, translations and matching." />
      <PageBody>
        <div className="mb-6"><GlobalSearch /></div>
        <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
          <nav aria-label="Administration" className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p>
                <div className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
                  {g.tabs.map(([to, label]) => (
                    <NavLink key={to} to={to} end={to === '/admin'} className={link}>{label}</NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="min-w-0"><Outlet /></div>
        </div>
      </PageBody>
    </>
  );
}
