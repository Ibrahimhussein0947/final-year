import { Check, Circle } from 'lucide-react';
import { Alert, Card, Skeleton } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/Button';
import { ScoreRing } from '@/components/MatchBreakdown';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useWorkerProfile } from '@/lib/profile';
import { CvImport } from '@/pages/worker/CvImport';
import { SectorQuestions } from '@/pages/worker/SectorQuestions';
import {
  ActivitiesSection, BasicsForm, CertificationsSection, EducationSection, ExperienceSection, FilesSection,
  GpsCard, LocationPicker, PreferencesForm, SkillsSection,
} from '@/pages/worker/sections';
import { DocumentsSummary } from '@/components/DocumentsSummary';
import { PortfolioSection } from '@/pages/worker/Portfolio';

export default function WorkerProfilePage() {
  const q = useWorkerProfile();

  return (
    <>
      <PageHeader title="Your profile" subtitle="A complete profile gets better job recommendations." />
      <PageBody narrow>
        {q.isLoading && (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-32" /><Skeleton className="h-64" /><Skeleton className="h-64" />
          </div>
        )}
        {q.isError && <Alert tone="danger">Could not load your profile. Please refresh the page.</Alert>}
        {q.data && (
          <div className="space-y-5">
            <Card className="p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <ScoreRing value={q.data.completion.pct} size={96} label="Profile completion" />
                <div className="flex-1">
                  <h2 className="text-lg font-bold">Profile completion</h2>
                  <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {q.data.completion.items.map((i) => (
                      <li key={i.key} className="flex items-center gap-2">
                        {i.done ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Circle className="h-4 w-4 text-muted" aria-hidden />}
                        <span className={i.done ? 'text-muted line-through' : ''}>{i.label}</span>
                        <span className="ml-auto text-xs text-muted">{i.points}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h2 className="text-lg font-bold">Your CV</h2>
                <p className="text-sm text-muted">Turn this profile into a clean CV you can print or save as a PDF.</p>
              </div>
              <LinkButton to="/profile/cv" variant="accent">Build my CV</LinkButton>
            </Card>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h2 className="text-lg font-bold">Who viewed your profile</h2>
                <p className="text-sm text-muted">{q.data.profileViews} {q.data.profileViews === 1 ? 'view' : 'views'} so far. See which organizations looked.</p>
              </div>
              <LinkButton to="/profile/views" variant="outline">See who viewed</LinkButton>
            </Card>
            <BasicsForm profile={q.data} />
            <LocationPicker profile={q.data} />
            <SkillsSection profile={q.data} />
            <SectorQuestions profile={q.data} />
            <ExperienceSection profile={q.data} />
            <PortfolioSection profile={q.data} />
            <EducationSection profile={q.data} />
            <CertificationsSection profile={q.data} />
            <DocumentsSummary />
            <ActivitiesSection profile={q.data} />
            <PreferencesForm profile={q.data} />
            <GpsCard profile={q.data} />
            <FilesSection profile={q.data} />
            <CvImport profile={q.data} />
          </div>
        )}
      </PageBody>
    </>
  );
}
