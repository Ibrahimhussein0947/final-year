import { Alert } from '@/components/ui/primitives';
import { describeRules, useHiringRules } from '@/lib/hiring';

/** Shows an employer the hiring rules that come with their organization type. Renders nothing when there are none. */
export function HiringRulesNotice() {
  const q = useHiringRules();
  if (!q.data) return null;
  const items = describeRules(q.data.rules);
  if (items.length === 0) return null;
  const type = q.data.rules.label ?? 'Your organization type';
  return (
    <Alert tone="info">
      <p className="font-semibold">{type}: formal hiring rules apply</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{items.map((t) => <li key={t}>{t}</li>)}</ul>
      <p className="mt-1 text-xs">The platform checks these when you publish a vacancy and when you decide on a candidate. They depend on your organization type; contact an administrator if it is wrong.</p>
    </Alert>
  );
}
