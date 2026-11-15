import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, X } from 'lucide-react';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/primitives';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { MatchBadge } from '@/components/MatchPanel';
import { STATUS_META, useCompare, type CompareResult } from '@/lib/applications';
import { EDU_LABEL, formatSalary, TYPE_LABEL } from '@/lib/format';

type Col = CompareResult['columns'][number];

export default function ComparePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const ids = params.get('ids') ?? '';
  const q = useCompare(ids);

  const rows: { label: string; cell: (c: Col, data: CompareResult) => React.ReactNode }[] = [
    { label: 'Status', cell: (c) => <Badge tone={STATUS_META[c.status].tone}>{STATUS_META[c.status].label}</Badge> },
    { label: 'Match score', cell: (c) => <MatchBadge match={c.match} /> },
    { label: 'Headline', cell: (c) => c.profile.headline ?? c.profile.occupation ?? '–' },
    { label: 'Experience', cell: (c) => `${c.profile.yearsExperience} yr` },
    { label: 'Location', cell: (c) => c.profile.locationPath.map((l) => l.name).join(', ') || '–' },
    {
      label: 'Required skills held',
      cell: (c, d) => (
        <div>
          <p className="font-medium">{c.requiredSkillsHeld} of {d.requiredSkills.length}</p>
          <ul className="mt-1 space-y-0.5">
            {d.requiredSkills.map((name) => {
              const has = c.profile.skills.some((s) => s.name === name);
              return <li key={name} className="flex items-center gap-1 text-xs">{has ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <X className="h-3.5 w-3.5 text-muted" aria-hidden />}{name}</li>;
            })}
          </ul>
        </div>
      ),
    },
    { label: 'All skills', cell: (c) => <span className="text-xs">{c.profile.skills.map((s) => `${s.name} (L${s.proficiency})`).join(', ') || '–'}</span> },
    { label: 'Education', cell: (c) => c.profile.education.map((e) => EDU_LABEL[e.level]).join(', ') || '–' },
    { label: 'Certificates', cell: (c) => c.profile.certifications.map((x) => x.name).join(', ') || '–' },
    { label: 'Expected salary', cell: (c) => formatSalary(c.profile.expectedSalaryMin, c.profile.expectedSalaryMax) ?? '–' },
    { label: 'Availability', cell: (c) => c.profile.availability.replace(/_/g, ' ').toLowerCase() },
    { label: 'Job types', cell: (c) => c.profile.preferredTypes.map((t) => TYPE_LABEL[t]).join(', ') || 'Any' },
    { label: 'Languages', cell: (c) => c.profile.languages.join(', ') || '–' },
  ];

  return (
    <>
      <PageHeader title="Compare candidates" subtitle={q.data ? q.data.job.title : undefined} />
      <PageBody>
        <Link to={`/employer/jobs/${id}/applications`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden />Back to applicants</Link>
        {q.isLoading && <Skeleton className="h-80" />}
        {(q.isError || ids.split(',').filter(Boolean).length < 2) && <Alert tone="warning">Select 2 to 4 applicants of the same job to compare them.</Alert>}
        {q.data && (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-36 p-4 text-muted">Candidate</th>
                  {q.data.columns.map((c) => (
                    <th key={c.applicationId} scope="col" className="p-4 align-top"><Link className="font-semibold hover:text-accent" to={`/employer/applications/${c.applicationId}`}>{c.profile.fullName}</Link></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <th scope="row" className="p-4 align-top font-medium text-muted">{r.label}</th>
                    {q.data.columns.map((c) => <td key={c.applicationId} className="p-4 align-top">{r.cell(c, q.data)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="mt-4 text-xs text-muted">The match score is a rule-based aid and the rest of the table is plain profile facts. Open a candidate to see how their score was calculated. The decision is yours.</p>
      </PageBody>
    </>
  );
}
