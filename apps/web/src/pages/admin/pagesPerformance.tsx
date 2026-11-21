import { useState, type ReactNode } from 'react';
import { Alert, Card, Skeleton } from '@/components/ui/primitives';
import { useAdminQuery } from '@/lib/admin';

interface Dist { n: number; medianDays: number | null; p75Days: number | null }
interface Week { weekStart: string; count: number }
interface Performance {
  windowDays: number;
  generatedAt: string;
  applicationsInWindow: number;
  truncated: boolean;
  funnel: {
    stages: { stage: string; applications: number; pctOfApplied: number | null; pctOfPrevious: number | null }[];
    current: { open: number; hired: number; rejected: number; withdrawn: number };
  };
  timing: {
    firstResponse: Dist; applicationToHire: Dist; jobTimeToFill: Dist;
    unansweredAfter7Days: { applications: number | null; outOf: number; pct: number | null };
  };
  byCategory: { category: string; applications: number | null; hired: number | null; hireRatePct: number | null; medianDaysToHire: number | null }[];
  matchQuality: {
    decidedWithScore: number; averageScoreHired: number | null; averageScoreRejected: number | null;
    byScoreBand: { band: string; decided: number | null; hiredPct: number | null }[];
  };
  autoApply: { shareOfApplicationsPct: number | null; auto: { decided: number | null; hiredPct: number | null }; manual: { decided: number | null; hiredPct: number | null } };
  growth: { weeks: number; newWorkers: Week[]; newEmployers: Week[]; jobsPublished: Week[]; applications: Week[] };
  privacy: string;
  caveats: string[];
}

const HIDDEN = <span className="text-muted" title="Fewer than 5 in this group, so the figure is hidden">hidden</span>;
const num = (v: number | null, suffix = ''): ReactNode => (v === null ? HIDDEN : `${v}${suffix}`);
const days = (v: number | null): ReactNode => (v === null ? HIDDEN : `${v} ${v === 1 ? 'day' : 'days'}`);

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

/** Horizontal bars, one per funnel stage, with the share lost at each step written out. */
function Funnel({ stages }: { stages: Performance['funnel']['stages'] }) {
  return (
    <ol className="mt-4 space-y-3">
      {stages.map((s) => {
        const lost = s.pctOfPrevious === null ? null : Math.round((100 - s.pctOfPrevious) * 10) / 10;
        return (
          <li key={s.stage}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{s.stage}</span>
              <span>{s.applications.toLocaleString()} <span className="text-muted">({s.pctOfApplied === null ? 'no data' : `${s.pctOfApplied}%`} of all)</span></span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(s.pctOfApplied ?? 0, s.applications > 0 ? 1.5 : 0)}%` }} />
            </div>
            {lost !== null && s.pctOfPrevious !== null && (
              <p className="mt-0.5 text-xs text-muted">{lost}% did not get from the previous stage to this one</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Twelve weekly bars. The values are also in the accessible label, so the chart is not the only way to read them. */
function WeeklyBars({ title, weeks }: { title: string; weeks: Week[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const total = weeks.reduce((s, w) => s + w.count, 0);
  const label = `${title}, last ${weeks.length} weeks, oldest first: ${weeks.map((w) => w.count).join(', ')}`;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-sm text-muted">{total.toLocaleString()} in {weeks.length} weeks</span>
      </div>
      <div role="img" aria-label={label} className="mt-3 flex h-24 items-end gap-1">
        {weeks.map((w) => (
          <div key={w.weekStart} className="flex h-full flex-1 items-end" title={`Week of ${w.weekStart}: ${w.count}`}>
            <div className="w-full rounded-t bg-accent" style={{ height: `${w.count === 0 ? 2 : Math.max(6, (w.count / max) * 100)}%`, opacity: w.count === 0 ? 0.25 : 1 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{weeks[0]?.weekStart}</span><span>this week</span></div>
    </Card>
  );
}

const th = 'py-2 pr-3 font-medium';

export function AdminPerformance() {
  const [windowDays, setWindowDays] = useState<30 | 90 | 365>(90);
  const q = useAdminQuery<Performance>(['performance', windowDays], `/analytics/performance?days=${windowDays}`);
  const p = q.data;

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-semibold">Platform performance</h2>
          <p className="text-sm text-muted">How applications move through hiring, how fast employers respond, and how the platform is growing.</p>
        </div>
        <label className="text-sm font-medium">
          Applications from the last{' '}
          <select className="ml-1 h-9 rounded-lg border border-border bg-surface px-2" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value) as 30 | 90 | 365)}>
            <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>12 months</option>
          </select>
        </label>
      </Card>

      {q.isLoading && <Skeleton className="h-72" />}
      {q.isError && <Alert tone="danger">Could not load the performance report.</Alert>}

      {p && (
        <>
          <Alert tone="info">{p.privacy}</Alert>
          {p.truncated && <Alert tone="warning">There are more applications than can be analysed at once, so only the newest are included.</Alert>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Applications" value={p.applicationsInWindow.toLocaleString()} hint={`${p.funnel.current.open} still open`} />
            <Kpi label="Hired" value={p.funnel.current.hired.toLocaleString()} hint={`${p.funnel.stages[4].pctOfApplied ?? 0}% of applications`} />
            <Kpi label="Typical first response" value={days(p.timing.firstResponse.medianDays)} hint="Median, from applying to a first answer" />
            <Kpi label="Unanswered after a week" value={num(p.timing.unansweredAfter7Days.pct, '%')} hint={`Of ${p.timing.unansweredAfter7Days.outOf} applications older than 7 days`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-semibold">Hiring funnel</h2>
              <p className="text-sm text-muted">The furthest step each application reached. A candidate who was shortlisted and later rejected still counts as shortlisted.</p>
              <Funnel stages={p.funnel.stages} />
              <p className="mt-4 text-sm text-muted">
                Today: {p.funnel.current.open} open, {p.funnel.current.hired} hired, {p.funnel.current.rejected} rejected, {p.funnel.current.withdrawn} withdrawn.
              </p>
            </Card>

            <Card className="overflow-x-auto p-5">
              <h2 className="font-semibold">How long things take</h2>
              <table className="mt-3 w-full text-left text-sm">
                <thead><tr className="border-b border-border text-muted"><th className={th}>Measure</th><th className={th}>Cases</th><th className={th}>Median</th><th className={th}>Slower quarter</th></tr></thead>
                <tbody>
                  {([['Applying to first response', p.timing.firstResponse], ['Applying to hire', p.timing.applicationToHire], ['Publishing a job to its first hire', p.timing.jobTimeToFill]] as const).map(([label, d]) => (
                    <tr key={label} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">{label}</td><td className="pr-3">{d.n}</td><td className="pr-3">{days(d.medianDays)}</td><td>{days(d.p75Days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">“Slower quarter” is the 75th percentile: three in four cases were faster than this.</p>
            </Card>
          </div>

          <section aria-labelledby="growth-h">
            <h2 id="growth-h" className="mb-3 font-semibold">Weekly growth</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <WeeklyBars title="New workers" weeks={p.growth.newWorkers} />
              <WeeklyBars title="New employers" weeks={p.growth.newEmployers} />
              <WeeklyBars title="Jobs published" weeks={p.growth.jobsPublished} />
              <WeeklyBars title="Applications" weeks={p.growth.applications} />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-x-auto p-5">
              <h2 className="font-semibold">Does a higher match score lead to hiring?</h2>
              <p className="mt-1 text-sm">
                Average score of people hired: <strong>{num(p.matchQuality.averageScoreHired)}</strong>; of people rejected: <strong>{num(p.matchQuality.averageScoreRejected)}</strong>
                <span className="text-muted"> ({p.matchQuality.decidedWithScore} decided applications with a score)</span>
              </p>
              <table className="mt-3 w-full text-left text-sm">
                <thead><tr className="border-b border-border text-muted"><th className={th}>Match score</th><th className={th}>Decided</th><th className={th}>Hired</th></tr></thead>
                <tbody>
                  {p.matchQuality.byScoreBand.map((b) => (
                    <tr key={b.band} className="border-b border-border last:border-0"><td className="py-2 pr-3">{b.band}</td><td className="pr-3">{num(b.decided)}</td><td>{num(b.hiredPct, '%')}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm">
                Applications sent automatically: {num(p.autoApply.shareOfApplicationsPct, '%')} of all. Hired when decided: automatic {num(p.autoApply.auto.hiredPct, '%')}, manual {num(p.autoApply.manual.hiredPct, '%')}.
              </p>
            </Card>

            <Card className="overflow-x-auto p-5">
              <h2 className="font-semibold">By job category</h2>
              <table className="mt-3 w-full text-left text-sm">
                <thead><tr className="border-b border-border text-muted"><th className={th}>Category</th><th className={th}>Applications</th><th className={th}>Hired</th><th className={th}>Hire rate</th><th className={th}>Median days to hire</th></tr></thead>
                <tbody>
                  {p.byCategory.length === 0 && <tr><td colSpan={5} className="py-3 text-muted">No applications in this period.</td></tr>}
                  {p.byCategory.map((c) => (
                    <tr key={c.category} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">{c.category}</td><td className="pr-3">{num(c.applications)}</td><td className="pr-3">{num(c.hired)}</td><td className="pr-3">{num(c.hireRatePct, '%')}</td><td>{num(c.medianDaysToHire)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="font-semibold">How to read this</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">{p.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          </Card>
        </>
      )}
    </div>
  );
}
