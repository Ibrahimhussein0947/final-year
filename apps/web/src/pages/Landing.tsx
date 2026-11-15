import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, Check, MapPin, Search, ShieldCheck, Sparkles, UserPlus, Users } from 'lucide-react';
import { LinkButton } from '@/components/ui/Button';
import { Accordion } from '@/components/ui/Accordion';
import { Badge, Card, EmptyState, SectionHeading, Skeleton } from '@/components/ui/primitives';
import { JobCard } from '@/components/JobCard';
import { useJobSearch } from '@/lib/jobs';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ComponentBar, ScoreRing } from '@/components/MatchBreakdown';
import { useI18n } from '@/i18n';
import { CATEGORIES, REGIONS } from '@/lib/taxonomy';

function Hero() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [category, setCategory] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (region) params.set('region', region);
    if (category) params.set('category', category);
    navigate(`/jobs?${params.toString()}`);
  }

  const field = 'h-12 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text';
  return (
    <section className="bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] text-white">
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        <div className="animate-fade-up max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm">
            <Sparkles className="h-4 w-4 text-teal-300" aria-hidden /> {t('hero.badge')}
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            {t('hero.title')}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-200">{t('hero.subtitle')}</p>
        </div>

        <form
          onSubmit={onSubmit}
          role="search"
          className="animate-fade-up mt-9 grid gap-3 rounded-2xl bg-white/10 p-3 backdrop-blur md:grid-cols-[2fr_1fr_1fr_auto]"
          style={{ animationDelay: '0.1s' }}
        >
          <label className="relative">
            <span className="sr-only">{t('hero.search.keyword')}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('hero.search.keyword')}
              className={`${field} pl-9`}
            />
          </label>
          <label className="relative">
            <span className="sr-only">{t('common.region')}</span>
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={`${field} pl-9`}>
              <option value="">{t('hero.search.location')}</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{t('common.category')}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
              <option value="">{t('hero.search.category')}</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-12 rounded-xl bg-accent px-6 text-sm font-semibold text-on-accent hover:bg-accent-hover"
          >
            {t('hero.search.button')}
          </button>
        </form>

        <div className="animate-fade-up mt-6 flex flex-wrap gap-3" style={{ animationDelay: '0.2s' }}>
          <LinkButton to="/register?role=worker" variant="light" size="lg">
            <UserPlus className="h-5 w-5" aria-hidden /> {t('hero.cta.seeker')}
          </LinkButton>
          <LinkButton to="/register?role=employer" variant="accent" size="lg">
            <Briefcase className="h-5 w-5" aria-hidden /> {t('hero.cta.employer')}
          </LinkButton>
        </div>
      </div>
    </section>
  );
}

function Categories() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <SectionHeading title={t('section.categories.title')} subtitle={t('section.categories.subtitle')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORIES.slice(0, 8).map((c) => (
          <Link
            key={c.slug}
            to={`/jobs?category=${c.slug}`}
            className="group flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-accent"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <c.icon className="h-5 w-5" aria-hidden />
            </span>
            <span>
              <span className="block font-semibold group-hover:text-accent">{c.name}</span>
              <span className="mt-0.5 block text-xs text-muted">{c.examples}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-5">
        <LinkButton to="/categories" variant="outline" size="sm">
          {t('nav.categories')} →
        </LinkButton>
      </div>
    </section>
  );
}

/** Real totals from the platform. Numbers below 5 are hidden by the server, and the whole block hides if none qualify. */
function PlatformStats() {
  const q = useQuery({ queryKey: ['public-stats'], staleTime: 60_000, queryFn: () => api<{ activeJobs: number | null; registeredWorkers: number | null; hiringEmployers: number | null; successfulHires: number | null }>('/public/stats') });
  const items: [string, number | null | undefined][] = [
    ['Open jobs', q.data?.activeJobs], ['Job seekers', q.data?.registeredWorkers], ['Hiring employers', q.data?.hiringEmployers], ['Successful hires', q.data?.successfulHires],
  ];
  const shown = items.filter(([, n]) => typeof n === 'number') as [string, number][];
  if (shown.length === 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-12 sm:px-6" aria-label="Platform statistics">
      <dl className="grid grid-cols-2 gap-4 rounded-2xl border border-border bg-surface p-6 shadow-card sm:grid-cols-4">
        {shown.map(([label, n]) => (
          <div key={label} className="text-center"><dd className="text-3xl font-extrabold text-accent">{n.toLocaleString('en-US')}</dd><dt className="text-sm text-muted">{label}</dt></div>
        ))}
      </dl>
    </section>
  );
}

function Featured() {
  const { t } = useI18n();
  const q = useJobSearch('pageSize=6');
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <SectionHeading title={t('section.featured.title')} />
      {q.isLoading && <div className="grid gap-3 md:grid-cols-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>}
      {q.isError && <EmptyState icon={Briefcase} title="Jobs could not be loaded" body="Please refresh the page in a moment." />}
      {q.data && q.data.items.length === 0 && (
        <EmptyState icon={Briefcase} title={t('section.featured.empty.title')} body="Jobs posted by employers will appear here." />
      )}
      {q.data && q.data.items.length > 0 && (
        <>
          <div className="grid gap-3 md:grid-cols-2">{q.data.items.map((j) => <JobCard key={j.id} job={j} />)}</div>
          <div className="mt-5"><LinkButton to="/jobs" variant="outline" size="sm">{t('nav.jobs')} →</LinkButton></div>
        </>
      )}
    </section>
  );
}

function HowItWorks() {
  const { t } = useI18n();
  const steps = [
    { icon: UserPlus, n: 1 },
    { icon: Sparkles, n: 2 },
    { icon: Users, n: 3 },
  ];
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <SectionHeading title={t('section.how.title')} subtitle={t('section.how.subtitle')} center />
      <ol className="grid gap-5 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n}>
            <Card className="h-full p-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-on-primary">
                  <s.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-sm font-semibold text-muted">0{s.n}</span>
              </div>
              <h3 className="text-lg font-semibold">{t(`how.${s.n}.title`)}</h3>
              <p className="mt-1 text-sm text-muted">{t(`how.${s.n}.body`)}</p>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AiExplainer() {
  const { t } = useI18n();
  // Illustrative values only. Real scores come from the matching engine (Phase 8).
  const factors: [string, number][] = [
    ['ai.factor.skills', 0.84],
    ['ai.factor.experience', 0.75],
    ['ai.factor.location', 0.95],
    ['ai.factor.qualification', 0.7],
    ['ai.factor.availability', 1],
    ['ai.factor.preferences', 0.8],
  ];
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('section.ai.title')}</h2>
          <p className="mt-3 text-muted">{t('section.ai.subtitle')}</p>
        </div>
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <Badge tone="warning">{t('ai.example.label')}</Badge>
          </div>
          <div className="flex items-center gap-5">
            <ScoreRing value={82} />
            <div>
              <p className="text-sm text-muted">{t('ai.example.score')}</p>
              <p className="text-lg font-semibold">{t('ai.example.role')}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {factors.map(([k, v]) => (
              <ComponentBar key={k} label={t(k)} value={v} />
            ))}
          </div>
          <p className="mt-5 rounded-xl bg-accent-soft p-3 text-sm text-accent">{t('ai.example.reason')}</p>
        </Card>
      </div>
    </section>
  );
}

function Audiences() {
  const { t } = useI18n();
  const block = (kind: 'seeker' | 'employer', cta: string, to: string, variant: 'primary' | 'accent') => (
    <Card className="p-7">
      <h3 className="text-xl font-bold">{t(`section.audience.${kind}.title`)}</h3>
      <ul className="mt-4 space-y-2.5">
        {[1, 2, 3].map((i) => (
          <li key={i} className="flex gap-2.5 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            {t(`section.audience.${kind}.${i}`)}
          </li>
        ))}
      </ul>
      <LinkButton to={to} variant={variant} className="mt-6">
        {t(cta)}
      </LinkButton>
    </Card>
  );
  return (
    <section className="mx-auto grid max-w-7xl gap-5 px-4 pt-16 sm:px-6 md:grid-cols-2">
      {block('seeker', 'section.audience.seeker.cta', '/register?role=worker', 'accent')}
      {block('employer', 'section.audience.employer.cta', '/register?role=employer', 'primary')}
    </section>
  );
}

function Trust() {
  const { t } = useI18n();
  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
      <div className="flex flex-col items-start gap-4 rounded-2xl bg-primary p-8 text-on-primary sm:flex-row sm:items-center">
        <ShieldCheck className="h-10 w-10 shrink-0" aria-hidden />
        <div>
          <h2 className="text-xl font-bold">{t('section.trust.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm opacity-90">{t('section.trust.body')}</p>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const { t } = useI18n();
  const items = [1, 2, 3, 4, 5].map((i) => ({ q: t(`faq.${i}.q`), a: t(`faq.${i}.a`) }));
  return (
    <section className="mx-auto max-w-3xl px-4 pt-16 sm:px-6">
      <SectionHeading title={t('section.faq.title')} center />
      <Accordion items={items} />
    </section>
  );
}

export default function Landing() {
  return (
    <>
      <Hero />
      <PlatformStats />
      <Categories />
      <Featured />
      <HowItWorks />
      <AiExplainer />
      <Audiences />
      <Trust />
      <Faq />
    </>
  );
}
