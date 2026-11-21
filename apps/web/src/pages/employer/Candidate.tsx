import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Check, Download, MessageSquare, Phone, X } from 'lucide-react';
import { useOpenConversation } from '@/pages/Messages';
import { Alert, Badge, Card, SelectField, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { StatusActions } from '@/pages/employer/Applicants';
import { api, ApiError, fetchBlobUrl } from '@/lib/api';
import { STATUS_META, useCandidate, type CandidateView, type PublicProfile } from '@/lib/applications';
import { useProtectedImage } from '@/lib/profile';
import { TrustBadge } from '@/components/TrustBadge';
import { PortfolioGallery } from '@/pages/worker/Portfolio';
import { EmployerOffer } from '@/components/OfferPanels';
import { useInterviewConfig } from '@/lib/interviews';
import { MatchPanel } from '@/components/MatchPanel';
import { ApplicantReviewPanel } from '@/components/ReviewPanel';
import { describeRecorded, STEP_FORM_LABEL, useHiringSteps, type StepKind } from '@/lib/selectionSteps';
import { EDU_LABEL, formatSalary, TYPE_LABEL } from '@/lib/format';

const MODE = { IN_PERSON: 'In person', PHONE: 'Phone call', VIDEO: 'Video call' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function Source({ s }: { s: string }) {
  return s === 'VERIFIED' ? <Badge tone="success"><BadgeCheck className="h-3 w-3" aria-hidden />Verified</Badge> : <Badge>Self-reported</Badge>;
}

/** Supporting documents are served only to the owner and to employers the worker applied to, so they are fetched with the session and opened as a temporary local file. */
async function openDocument(url: string) {
  try {
    const blob = await fetchBlobUrl(url);
    window.open(blob, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(blob), 60_000);
  } catch { /* the button simply does nothing if the file is gone */ }
}

export function ProfileSummary({ p }: { p: PublicProfile }) {
  const photo = useProtectedImage(p.photoUrl);
  const salary = formatSalary(p.expectedSalaryMin, p.expectedSalaryMax);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-xl font-bold text-muted">
          {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : p.fullName.slice(0, 1)}
        </div>
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold">{p.fullName} <TrustBadge trust={p.trust} /></h2>
          <p className="text-muted">{p.headline ?? p.occupation ?? 'No headline'}</p>
          <p className="text-sm text-muted">{p.locationPath.map((l) => l.name).join(', ') || 'Location not set'} · {p.yearsExperience} yr experience</p>
        </div>
      </div>
      {p.contact && <p className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4" aria-hidden /><a className="font-medium text-accent hover:underline" href={`tel:${p.contact.phone}`}>{p.contact.phone}</a></p>}
      {p.bio && <p className="whitespace-pre-line text-sm text-muted">{p.bio}</p>}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Expected salary</dt><dd className="font-medium">{salary ?? 'Not stated'}</dd></div>
        <div><dt className="text-muted">Availability</dt><dd className="font-medium">{p.availability.replace(/_/g, ' ').toLowerCase()}</dd></div>
        <div><dt className="text-muted">Prefers</dt><dd className="font-medium">{p.preferredTypes.map((t) => TYPE_LABEL[t]).join(', ') || 'Any'}</dd></div>
        <div><dt className="text-muted">Languages</dt><dd className="font-medium">{p.languages.join(', ') || 'Not stated'}</dd></div>
      </dl>

      <section>
        <h3 className="mb-2 font-semibold">Skills</h3>
        <ul className="flex flex-wrap gap-2">
          {p.skills.length === 0 && <li className="text-sm text-muted">No skills listed</li>}
          {p.skills.map((s) => <li key={s.skillId} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">{s.name} <span className="text-muted">L{s.proficiency}</span><Source s={s.source} />{s.tested && <Badge tone="info">Tested {s.tested.score}%</Badge>}</li>)}
        </ul>
      </section>
      {p.sectorAnswers && p.sectorAnswers.length > 0 && (
        <section><h3 className="mb-2 font-semibold">Sector details</h3>
          <ul className="space-y-1 text-sm">
            {p.sectorAnswers.map((a) => <li key={a.criterionId} className="flex flex-wrap items-center gap-2"><span className="text-muted">{a.labelEn}:</span><span className="font-medium">{a.text}</span><Source s={a.verified ? 'VERIFIED' : 'SELF_REPORTED'} /></li>)}
          </ul>
          <p className="mt-1 text-xs text-muted">Questions the worker did not answer are not shown and are not held against them.</p>
        </section>
      )}
      <PortfolioGallery items={p.portfolio ?? []} />
      {p.experiences.length > 0 && (
        <section><h3 className="mb-2 font-semibold">Work history</h3>
          <ul className="space-y-2 text-sm">{p.experiences.map((e) => <li key={e.id}><span className="font-medium">{e.title}</span>{e.employer ? ` · ${e.employer}` : ''}<span className="text-muted"> ({e.startDate.slice(0, 4)} to {e.endDate ? e.endDate.slice(0, 4) : 'present'})</span> {e.source === 'VERIFIED' && <Source s="VERIFIED" />}{e.documentUrl && <button type="button" className="ml-2 text-accent hover:underline" onClick={() => void openDocument(e.documentUrl!)}>Experience letter</button>}</li>)}</ul></section>
      )}
      {(p.education.length > 0 || p.certifications.length > 0) && (
        <section><h3 className="mb-2 font-semibold">Education and certificates</h3>
          <ul className="space-y-2 text-sm">
            {p.education.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-2">{EDU_LABEL[e.level]}{e.field ? `, ${e.field}` : ''}{e.institution ? ` · ${e.institution}` : ''}{e.department ? ` · ${e.department}` : ''}{e.gpa != null ? ` · GPA ${e.gpa}/${e.gpaScale}` : ''} <Source s={e.source} />{e.documentUrl && <button type="button" className="text-accent hover:underline" onClick={() => void openDocument(e.documentUrl!)}>Document</button>}</li>)}
            {p.certifications.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2">{c.name}{c.issuer ? ` · ${c.issuer}` : ''} <Source s={c.source} />{c.documentUrl && <button type="button" className="text-accent hover:underline" onClick={() => void openDocument(c.documentUrl!)}>Document</button>}</li>)}
          </ul></section>
      )}
      {p.activities.length > 0 && (
        <section><h3 className="mb-2 font-semibold">Internships, training, volunteering, apprenticeships and references</h3>
          <ul className="space-y-2 text-sm">
            {p.activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.title}</span>
                <span className="text-muted">{[a.kind.charAt(0) + a.kind.slice(1).toLowerCase(), a.organization, a.hours && `${a.hours} hours`].filter(Boolean).join(' · ')}</span>
                <Source s={a.source} />
                {a.documentUrl && <button type="button" className="text-accent hover:underline" onClick={() => void openDocument(a.documentUrl!)}>Document</button>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">These are self-reported unless marked verified. References are names only: contact them through the worker.</p>
        </section>
      )}
    </div>
  );
}

const interviewFields = { scheduledAt: '', mode: 'IN_PERSON', locationOrLink: '', createVideoRoom: false };

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function InterviewForm({ view, onError }: { view: CandidateView; onError: (m: string | null) => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, reset, watch } = useForm({ defaultValues: interviewFields });
  const cfg = useInterviewConfig();
  const isVideo = watch('mode') === 'VIDEO';
  const makeRoom = isVideo && !!cfg.data?.videoRooms && watch('createVideoRoom');
  const [editing, setEditing] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const refresh = () => Promise.all(['candidate', 'job-applicants', 'summary'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const book = useMutation({
    mutationFn: (v: typeof interviewFields) => {
      const body = { scheduledAt: new Date(v.scheduledAt).toISOString(), mode: v.mode, locationOrLink: v.createVideoRoom && v.mode === 'VIDEO' ? '' : v.locationOrLink, ...(v.createVideoRoom && v.mode === 'VIDEO' ? { createVideoRoom: true } : {}) };
      return editing
        ? api<{ warnings?: string[] }>(`/applications/${view.application.id}/interviews/${editing}`, { method: 'PATCH', body })
        : api<{ warnings?: string[] }>(`/applications/${view.application.id}/interviews`, { method: 'POST', body });
    },
    onSuccess: (r) => { onError(null); setWarnings(r?.warnings ?? []); setEditing(null); reset(interviewFields); void refresh(); },
    onError: (e) => onError(e instanceof ApiError ? Object.values(e.details ?? {}).flat()[0] as string ?? e.message : 'Could not reach the server'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/applications/${view.application.id}/interviews/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void refresh(); },
    onError: () => onError('Could not cancel the interview'),
  });
  const scheduled = view.interviews.filter((i) => i.status === 'SCHEDULED');

  return (
    <Card className="p-5">
      <h3 className="font-semibold">Interviews</h3>
      <ul className="mt-3 space-y-2">
        {scheduled.length === 0 && <li className="text-sm text-muted">No interview scheduled.</li>}
        {scheduled.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning">
            <span><strong>{when(i.scheduledAt)}</strong> · {MODE[i.mode]}{i.locationOrLink ? ` · ${i.locationOrLink}` : ''}</span>
            <span className="flex shrink-0 items-center gap-1">
            <button type="button" className="rounded px-1.5 text-xs underline hover:bg-warning/10" onClick={() => { setEditing(i.id); reset({ scheduledAt: toLocalInput(i.scheduledAt), mode: i.mode, locationOrLink: i.locationOrLink ?? '', createVideoRoom: false }); }}>Change</button>
            <button type="button" aria-label="Cancel interview" className="shrink-0 rounded p-1 hover:bg-warning/10" onClick={() => { if (window.confirm('Cancel this interview? The candidate will be notified.')) cancel.mutate(i.id); }}><X className="h-4 w-4" aria-hidden /></button>
            </span>
          </li>
        ))}
      </ul>
      {warnings.length > 0 && <ul className="mt-3 space-y-1 rounded-xl bg-warning-soft p-3 text-sm text-warning">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {view.application.canSchedule ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" noValidate onSubmit={handleSubmit((v) => v.scheduledAt ? book.mutate(v) : onError('Choose a date and time'))}>
          <TextField label="Date and time" type="datetime-local" {...register('scheduledAt')} />
          <SelectField label="Type" {...register('mode')}><option value="IN_PERSON">In person</option><option value="PHONE">Phone call</option><option value="VIDEO">Video call</option></SelectField>
          {isVideo && cfg.data?.videoRooms && (
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" {...register('createVideoRoom')} />
              <span>Make a private video room for me <span className="text-muted">(on {cfg.data.videoHost}). Anyone with the link can join, so it is shared only with you and the candidate. The call opens 15 minutes before the start.</span></span>
            </label>
          )}
          {!makeRoom && <div className="sm:col-span-2"><TextField label={isVideo ? 'Meeting link' : 'Place or link'} placeholder={isVideo ? 'Paste a Google Meet, Zoom or Teams link' : 'Address, phone number or meeting link'} {...register('locationOrLink')} /></div>}
          <div className="sm:col-span-2"><Button type="submit" variant="accent" size="sm" loading={book.isPending}>{editing ? 'Save new time' : 'Schedule interview'}</Button>{editing && <Button type="button" variant="ghost" size="sm" className="ml-2" onClick={() => { setEditing(null); reset(interviewFields); }}>Cancel change</Button>}</div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted">{view.application.status === 'PENDING' ? 'Start the review or shortlist this candidate before scheduling an interview.' : 'Interviews can no longer be scheduled for this application.'}</p>
      )}
    </Card>
  );
}

const SCORE_FIELDS = ['skills', 'experience', 'communication', 'suitability'] as const;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Builds the request body for one recruitment step from the plain form values. */
function stepBody(kind: StepKind, f: Record<string, string>) {
  const note = f.note?.trim() || null;
  switch (kind) {
    case 'WRITTEN_EXAM': return { kind, score: Number(f.score), examDate: f.date, note };
    case 'PRACTICAL_TEST': return { kind, score: Number(f.score), testDate: f.date, task: f.task, note };
    case 'SCORE_SHEET': return { kind, panelist: f.person, scores: Object.fromEntries(SCORE_FIELDS.map((k) => [k, Number(f[k] || 3)])), note };
    case 'REFERENCE_CHECKED': return { kind, referee: f.person, outcome: f.outcome || 'POSITIVE', note };
    case 'GUARANTOR_RECORDED': return { kind, guarantor: f.person, relationship: f.relationship, idSeen: f.idSeen === 'yes' };
  }
}

function SelectionSteps({ applicationId, onError }: { applicationId: string; onError: (m: string | null) => void }) {
  const qc = useQueryClient();
  const q = useHiringSteps(applicationId);
  const [kind, setKind] = useState<StepKind>('WRITTEN_EXAM');
  const [f, setF] = useState<Record<string, string>>({ date: todayIso() });
  const set = (k: string) => (e: { target: { value: string; type?: string; checked?: boolean } }) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 'yes' : '') : e.target.value }));
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['hiring-steps', applicationId] }), qc.invalidateQueries({ queryKey: ['candidate'] })]);
  const fail = (e: unknown) => onError(e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) ?? e.message : 'Could not reach the server');
  const add = useMutation({
    mutationFn: () => api(`/applications/${applicationId}/steps`, { method: 'POST', body: stepBody(kind, f) }),
    onSuccess: () => { onError(null); setF({ date: todayIso() }); void done(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/applications/${applicationId}/steps/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void done(); },
    onError: fail,
  });
  if (!q.data) return null;
  const v = q.data;
  const needsScore = kind === 'WRITTEN_EXAM' || kind === 'PRACTICAL_TEST';

  return (
    <Card className="p-5">
      <h3 className="font-semibold">Selection steps</h3>
      <p className="mt-1 text-xs text-muted">Record the checks you did before deciding. The system records and checks that required steps were done; it cannot judge how well they were done.</p>
      {v.steps.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {v.steps.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2">
              {s.done ? <Check className="h-4 w-4 text-success" aria-hidden /> : <X className="h-4 w-4 text-muted" aria-hidden />}
              <span className="font-medium">{s.label}</span>
              {s.required ? <Badge tone="warning">Required</Badge> : <Badge>Suggested</Badge>}
              <span className="text-muted">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {v.recorded.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
          {v.recorded.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2">
              <span><strong>{STEP_FORM_LABEL[r.kind]}</strong>: {describeRecorded(r)}</span>
              {v.open && <button type="button" aria-label={`Delete ${STEP_FORM_LABEL[r.kind]}`} className="shrink-0 rounded p-1 hover:bg-surface-2" onClick={() => { if (window.confirm('Delete this record?')) remove.mutate(r.id); }}><X className="h-4 w-4" aria-hidden /></button>}
            </li>
          ))}
        </ul>
      )}
      {v.open ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <SelectField label="Add a step" value={kind} onChange={(e) => { setKind(e.target.value as StepKind); setF({ date: todayIso() }); }}>
            {(Object.keys(STEP_FORM_LABEL) as StepKind[]).map((k) => <option key={k} value={k}>{STEP_FORM_LABEL[k]}</option>)}
          </SelectField>
          {needsScore && <TextField label="Score (out of 100)" type="number" min={0} max={100} value={f.score ?? ''} onChange={set('score')} />}
          {needsScore && <TextField label="Date" type="date" max={todayIso()} value={f.date ?? ''} onChange={set('date')} />}
          {kind === 'PRACTICAL_TEST' && <div className="sm:col-span-2"><TextField label="Task given" placeholder="For example: lay a 2 m wall, change a tyre" value={f.task ?? ''} onChange={set('task')} /></div>}
          {kind === 'SCORE_SHEET' && <TextField label="Panel member" value={f.person ?? ''} onChange={set('person')} />}
          {kind === 'SCORE_SHEET' && SCORE_FIELDS.map((k) => <SelectField key={k} label={`${k.charAt(0).toUpperCase()}${k.slice(1)} (1 to 5)`} value={f[k] ?? '3'} onChange={set(k)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</SelectField>)}
          {kind === 'REFERENCE_CHECKED' && <TextField label="Referee name" value={f.person ?? ''} onChange={set('person')} />}
          {kind === 'REFERENCE_CHECKED' && <SelectField label="What they said" value={f.outcome ?? 'POSITIVE'} onChange={set('outcome')}><option value="POSITIVE">Positive</option><option value="CONCERNS">Concerns</option></SelectField>}
          {kind === 'GUARANTOR_RECORDED' && <TextField label="Guarantor name" value={f.person ?? ''} onChange={set('person')} />}
          {kind === 'GUARANTOR_RECORDED' && <TextField label="Relationship" value={f.relationship ?? ''} onChange={set('relationship')} />}
          {kind === 'GUARANTOR_RECORDED' && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.idSeen === 'yes'} onChange={set('idSeen')} />I checked the guarantor's ID. Do not enter their phone number or address.</label>}
          {kind !== 'GUARANTOR_RECORDED' && <div className="sm:col-span-2"><TextField label="Note (optional, private to you)" maxLength={200} value={f.note ?? ''} onChange={set('note')} /></div>}
          <div className="sm:col-span-2"><Button type="submit" variant="accent" size="sm" loading={add.isPending}>Record step</Button></div>
        </form>
      ) : <p className="mt-3 text-sm text-muted">This application is decided, so its record is closed.</p>}
    </Card>
  );
}

export default function CandidatePage() {
  const { id } = useParams();
  const q = useCandidate(id);
  const [error, setError] = useState<string | null>(null);
  const chat = useOpenConversation();
  useEffect(() => { if (chat.error) setError(chat.error); }, [chat.error]);

  async function downloadCv(url: string) {
    try {
      const blob = await fetchBlobUrl(url);
      const a = document.createElement('a');
      a.href = blob; a.download = 'cv.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(blob), 10_000);
    } catch { setError('Could not download the CV.'); }
  }

  if (q.isLoading) return <PageBody narrow><div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-64" /></div></PageBody>;
  if (q.isError || !q.data) return <PageBody narrow><Alert tone="danger">This application could not be found.</Alert><Link to="/employer/jobs" className="mt-3 inline-block text-accent hover:underline">Back to your jobs</Link></PageBody>;
  const v = q.data;
  const meta = STATUS_META[v.application.status];

  return (
    <>
      <PageHeader title={v.profile.fullName} subtitle={`Applied for ${v.application.job.title}`} />
      <PageBody narrow>
        <Link to={`/employer/jobs/${v.application.job.id}/applications`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden />All applicants</Link>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <StatusActions applicationId={v.application.id} allowed={v.application.allowedNext} onChanged={() => setError(null)} onError={setError} rules={v.rules} />
            </div>
            {v.application.coverNote && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">“{v.application.coverNote}”</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {v.cvUrl && <Button variant="outline" size="sm" onClick={() => downloadCv(v.cvUrl!)}><Download className="h-4 w-4" aria-hidden />Download CV</Button>}
              {v.application.status !== 'REJECTED' && v.application.status !== 'WITHDRAWN' && (
                <Button variant="outline" size="sm" loading={chat.busy === v.application.id} onClick={() => chat.open(v.application.id)}><MessageSquare className="h-4 w-4" aria-hidden />Message</Button>
              )}
            </div>
            {!v.profile.contact && <p className="mt-3 text-xs text-muted">The candidate's phone number is revealed when you shortlist them.</p>}
          </Card>

          {v.match && <MatchPanel match={v.match} title="Match analysis" />}
          <ApplicantReviewPanel applicationId={v.application.id} />

          <Card className="p-5">
            <h3 className="font-semibold">Fit with this job's skills</h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {v.skillOverlap.map((s) => (
                <li key={s.name} className="flex items-center gap-2 text-sm">
                  {s.has ? <Check className="h-4 w-4 text-success" aria-hidden /> : <X className="h-4 w-4 text-muted" aria-hidden />}
                  <span>{s.name}</span><span className="text-xs text-muted">{s.importance === 'REQUIRED' ? 'required' : 'nice to have'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">This is a plain list comparison. The match analysis above also credits related skills.</p>
          </Card>

          <Card className="p-5"><ProfileSummary p={v.profile} /></Card>
          <InterviewForm view={v} onError={setError} />
          <SelectionSteps applicationId={v.application.id} onError={setError} />
          <EmployerOffer applicationId={v.application.id} accepted={v.application.status === 'ACCEPTED'} />

          <Card className="p-5">
            <h3 className="font-semibold">History</h3>
            <ol className="mt-3 space-y-2 border-l-2 border-border pl-4 text-sm">
              {v.history.map((h, i) => <li key={i}><span className="font-medium">{STATUS_META[h.to].label}</span><span className="ml-2 text-muted">{when(h.at)}</span>{h.note && <p className="text-muted">“{h.note}”</p>}</li>)}
            </ol>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
