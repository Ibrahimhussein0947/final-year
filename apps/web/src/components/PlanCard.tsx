import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';

interface PlanStatus {
  plan: { name: string; description: string | null; priceEtbMonthly: number; maxActiveJobs: number | null; maxInvitationsPerMonth: number | null; maxFeaturedJobs: number | null; maxApplicationsReviewedPerMonth: number | null; canSearchWorkers: boolean };
  subscription: { endsAt: string | null } | null;
  isDefault: boolean;
  usage: { activeJobs: number; invitationsThisMonth: number; featuredJobs: number; reviewedThisMonth: number };
}

const of = (used: number, max: number | null) => (max === null ? `${used} (no limit)` : `${used} of ${max}`);

/** The employer's plan and how much of it is used. Plans are set by the platform administrator. */
export function PlanCard() {
  const q = useQuery({ queryKey: ['my-plan'], queryFn: () => api<PlanStatus>('/employers/me/subscription') });
  if (!q.data) return null;
  const { plan, usage, subscription } = q.data;
  const nearLimit = (plan.maxActiveJobs !== null && usage.activeJobs >= plan.maxActiveJobs) || (plan.maxInvitationsPerMonth !== null && usage.invitationsThisMonth >= plan.maxInvitationsPerMonth)
    || (plan.maxApplicationsReviewedPerMonth !== null && usage.reviewedThisMonth >= plan.maxApplicationsReviewedPerMonth);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Your plan: {plan.name}</h2>
        <span className="text-xs text-muted">{subscription?.endsAt ? `Until ${new Date(subscription.endsAt).toLocaleDateString('en-GB')}` : q.data.isDefault ? 'Standard plan for all employers' : 'No end date'}</span>
      </div>
      {plan.description && <p className="mt-1 text-sm text-muted">{plan.description}</p>}
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">Featured jobs</dt><dd className="font-medium">{plan.maxFeaturedJobs === 0 ? 'Not included' : of(usage.featuredJobs, plan.maxFeaturedJobs)}</dd></div>
        <div><dt className="text-muted">New applications reviewed this month</dt><dd className="font-medium">{of(usage.reviewedThisMonth, plan.maxApplicationsReviewedPerMonth)}</dd></div>
        <div><dt className="text-muted">Open jobs</dt><dd className="font-medium">{of(usage.activeJobs, plan.maxActiveJobs)}</dd></div>
        <div><dt className="text-muted">Invitations this month</dt><dd className="font-medium">{of(usage.invitationsThisMonth, plan.maxInvitationsPerMonth)}</dd></div>
        <div><dt className="text-muted">Search workers</dt><dd className="font-medium">{plan.canSearchWorkers ? 'Included' : 'Not included'}</dd></div>
      </dl>
      {nearLimit && <p className="mt-3 text-sm text-warning">You have reached a limit of this plan. Close a job, wait for the next month, or contact the administrator to change your plan. Applications already under review are never blocked.</p>}
    </Card>
  );
}
