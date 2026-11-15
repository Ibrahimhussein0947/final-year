import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Alert, Card, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useAuth } from '@/app/auth';
import { useProtectedImage, useWorkerProfile, ACTIVITY_LABEL, type WorkerProfile } from '@/lib/profile';
import { EDU_LEVELS } from '@/pages/worker/sections';

type Template = 'classic' | 'compact';
const SECTIONS = [
  ['summary', 'Summary'], ['experience', 'Work experience'], ['education', 'Education'], ['skills', 'Skills'],
  ['certifications', 'Certificates'], ['activities', 'Training and volunteering'], ['languages', 'Languages'],
] as const;
type SectionKey = (typeof SECTIONS)[number][0];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const period = (from: string | null, to: string | null) => {
  const a = month(from);
  const b = to ? month(to) : a ? 'Present' : '';
  return [a, b].filter(Boolean).join(' – ');
};
const PROFICIENCY = ['', 'Basic', 'Basic', 'Good', 'Very good', 'Expert'];

function Block({ title, children, template }: { title: string; children: ReactNode; template: Template }) {
  return (
    <section className={template === 'compact' ? 'mt-4 break-inside-avoid' : 'mt-6 break-inside-avoid'}>
      <h2 className={template === 'compact' ? 'border-b border-slate-300 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-700' : 'border-b-2 border-teal-700 pb-1 text-sm font-bold uppercase tracking-wider text-teal-800'}>
        {title}
      </h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

function Sheet({ profile, name, phone, email, show, template, showContact, photo }: {
  profile: WorkerProfile; name: string; phone: string; email: string | null; show: Record<SectionKey, boolean>;
  template: Template; showContact: boolean; photo: string | null;
}) {
  const place = profile.locationPath.map((p) => p.name).reverse().slice(0, 2).join(', ');
  const contact = [showContact ? phone : null, showContact ? email : null, place || null].filter(Boolean);
  const skills = [...profile.skills].sort((a, b) => b.proficiency - a.proficiency);
  const experiences = [...profile.experiences].sort((a, b) => (b.startDate > a.startDate ? 1 : -1));
  const hasAny = (k: SectionKey) => {
    switch (k) {
      case 'summary': return !!profile.bio;
      case 'experience': return experiences.length > 0;
      case 'education': return profile.education.length > 0;
      case 'skills': return skills.length > 0;
      case 'certifications': return profile.certifications.length > 0;
      case 'activities': return profile.activities.filter((a) => a.kind !== 'REFERENCE').length > 0;
      case 'languages': return profile.languages.length > 0;
    }
  };
  const on = (k: SectionKey) => show[k] && hasAny(k);

  return (
    <article className="cv-sheet mx-auto bg-white p-8 text-[13px] leading-relaxed text-slate-900 shadow-lg print:p-0 print:shadow-none" style={{ maxWidth: '210mm' }}>
      <header className="flex items-start gap-5">
        {photo && <img src={photo} alt="" className="h-24 w-24 rounded-lg object-cover" />}
        <div className="flex-1">
          <h1 className={template === 'compact' ? 'text-2xl font-extrabold' : 'text-3xl font-extrabold text-teal-800'}>{name}</h1>
          {(profile.headline || profile.occupation) && <p className="mt-0.5 text-base text-slate-700">{profile.headline || profile.occupation}</p>}
          {contact.length > 0 && <p className="mt-1 text-slate-600">{contact.join('  ·  ')}</p>}
        </div>
      </header>

      {on('summary') && <Block title="Summary" template={template}><p>{profile.bio}</p></Block>}

      {on('experience') && (
        <Block title="Work experience" template={template}>
          {experiences.map((x) => (
            <div key={x.id}>
              <div className="flex flex-wrap justify-between gap-x-4">
                <p className="font-semibold">{x.title}{x.employer ? `, ${x.employer}` : ''}</p>
                <p className="text-slate-600">{period(x.startDate, x.endDate)}</p>
              </div>
              {x.description && <p className="mt-0.5 whitespace-pre-line text-slate-700">{x.description}</p>}
            </div>
          ))}
        </Block>
      )}

      {on('education') && (
        <Block title="Education" template={template}>
          {profile.education.map((e) => (
            <div key={e.id} className="flex flex-wrap justify-between gap-x-4">
              <p>
                <span className="font-semibold">{EDU_LEVELS.find(([v]) => v === e.level)?.[1] ?? e.level}{e.field ? `, ${e.field}` : ''}</span>
                {e.institution ? ` – ${e.institution}` : ''}
                {e.gpa != null && e.gpaScale ? ` (GPA ${e.gpa}/${e.gpaScale})` : ''}
              </p>
              {e.year && <p className="text-slate-600">{e.year}</p>}
            </div>
          ))}
        </Block>
      )}

      {on('skills') && (
        <Block title="Skills" template={template}>
          <ul className="grid gap-x-8 gap-y-0.5 sm:grid-cols-2 print:grid-cols-2">
            {skills.map((s) => (
              <li key={s.skillId} className="flex justify-between gap-3">
                <span>{s.name}{s.years ? ` · ${s.years} yr` : ''}</span>
                <span className="text-slate-600">{PROFICIENCY[s.proficiency]}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {on('certifications') && (
        <Block title="Certificates" template={template}>
          {profile.certifications.map((c) => (
            <div key={c.id} className="flex flex-wrap justify-between gap-x-4">
              <p><span className="font-semibold">{c.name}</span>{c.issuer ? ` – ${c.issuer}` : ''}</p>
              {c.year && <p className="text-slate-600">{c.year}</p>}
            </div>
          ))}
        </Block>
      )}

      {on('activities') && (
        <Block title="Training and volunteering" template={template}>
          {profile.activities.filter((a) => a.kind !== 'REFERENCE').map((a) => (
            <div key={a.id}>
              <div className="flex flex-wrap justify-between gap-x-4">
                <p><span className="font-semibold">{a.title}</span>{a.organization ? ` – ${a.organization}` : ''} <span className="text-slate-500">({ACTIVITY_LABEL[a.kind].split(' (')[0]})</span></p>
                <p className="text-slate-600">{period(a.startDate, a.endDate)}</p>
              </div>
              {a.description && <p className="text-slate-700">{a.description}</p>}
            </div>
          ))}
        </Block>
      )}

      {on('languages') && <Block title="Languages" template={template}><p>{profile.languages.join(', ')}</p></Block>}
    </article>
  );
}

export default function CvBuilderPage() {
  const { user } = useAuth();
  const q = useWorkerProfile();
  const photo = useProtectedImage(q.data?.photoUrl ?? null);
  const [template, setTemplate] = useState<Template>('classic');
  const [showContact, setShowContact] = useState(true);
  const [showPhoto, setShowPhoto] = useState(false);
  const [show, setShow] = useState<Record<SectionKey, boolean>>(() => Object.fromEntries(SECTIONS.map(([k]) => [k, true])) as Record<SectionKey, boolean>);
  const thin = useMemo(() => (q.data ? q.data.completion.pct < 40 : false), [q.data]);

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Build your CV" subtitle="Made from your profile. Choose what to include, then print it or save it as a PDF." />
      </div>
      <PageBody>
        {q.isLoading && <Skeleton className="h-96" />}
        {q.isError && <Alert tone="danger">Could not load your profile. Please refresh the page.</Alert>}
        {q.data && user && (
          <div className="grid gap-6 lg:grid-cols-[18rem_1fr] print:block">
            <aside className="space-y-4 print:hidden">
              <Card className="space-y-4 p-5">
                <fieldset>
                  <legend className="text-sm font-semibold">Style</legend>
                  <div className="mt-2 flex gap-2">
                    {(['classic', 'compact'] as const).map((t) => (
                      <button key={t} type="button" aria-pressed={template === t} onClick={() => setTemplate(t)}
                        className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium capitalize ${template === t ? 'border-accent bg-accent-soft text-accent' : 'border-border'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-semibold">Include</legend>
                  <div className="mt-2 space-y-1.5">
                    {SECTIONS.map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {label}
                      </label>
                    ))}
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showContact} onChange={(e) => setShowContact(e.target.checked)} /> Phone and email</label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={showPhoto} disabled={!photo} onChange={(e) => setShowPhoto(e.target.checked)} /> Photo{!photo && ' (none uploaded)'}
                    </label>
                  </div>
                </fieldset>
                <Button variant="accent" className="w-full" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" aria-hidden /> Print or save as PDF
                </Button>
                <p className="text-xs text-muted">In the print window choose “Save as PDF” as the printer. Skills and certificates not yet verified are shown as you wrote them.</p>
              </Card>
              {thin && (
                <Alert tone="warning">
                  Your profile is only {q.data.completion.pct}% complete, so the CV will look thin. <Link to="/profile" className="font-semibold underline">Add more to your profile</Link>.
                </Alert>
              )}
            </aside>
            <div className="min-w-0 overflow-x-auto">
              <Sheet profile={q.data} name={user.fullName} phone={user.phone} email={user.email} show={show} template={template} showContact={showContact} photo={showPhoto ? photo : null} />
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
