import { NavLink, Outlet } from 'react-router-dom';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { cn } from '@/lib/cn';

const TABS: [string, string][] = [
  ['/admin', 'Overview'], ['/admin/users', 'Users'], ['/admin/jobs', 'Jobs and applications'], ['/admin/announcements', 'Announcements'], ['/admin/settings', 'Settings and health'], ['/admin/verification', 'Verification'], ['/admin/moderation', 'Moderation'],
  ['/admin/taxonomy', 'Skills and categories'], ['/admin/criteria', 'Sector criteria'], ['/admin/hiring', 'Hiring rules'], ['/admin/organizations', 'Organizations'], ['/admin/translations', 'Translations'], ['/admin/matching', 'Matching and AI'],
  ['/admin/performance', 'Performance'], ['/admin/analytics', 'Analytics and reports'], ['/admin/audit', 'Activity log'], ['/admin/plans', 'Subscriptions'], ['/admin/training', 'Training'], ['/admin/places', 'Places'], ['/admin/team', 'Administrators'],
];

export function AdminLayout() {
  return (
    <>
      <PageHeader title="Administration" subtitle="Manage users, trust and safety, the skill list, translations and matching." />
      <PageBody>
        <nav aria-label="Administration" className="mb-6 flex flex-wrap gap-2">
          {TABS.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              className={({ isActive }) => cn('rounded-full border px-3 py-1.5 text-sm font-medium', isActive ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface hover:bg-surface-2')}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </PageBody>
    </>
  );
}
