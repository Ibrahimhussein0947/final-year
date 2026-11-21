import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Clock } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { api, ApiError } from '@/lib/api';

interface TestItem {
  id: string; title: string; description: string | null; skill: { id: string; name: string }; questionsAsked: number; passPercent: number;
  timeLimitMinutes: number; hasSkill: boolean; tested: { score: number | null; at: string } | null; attemptsLeftToday: number; canTake: boolean; reason: string | null;
}
interface Started { attemptId: string; title: string; startedAt: string; expiresAt: string; questions: { n: number; text: string; options: string[] }[] }
interface Result { correct: number; total: number; percent: number; passed: boolean; passPercent: number; attemptsLeftToday: number }

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server. Try again.');

function useCountdown(expiresAt: string) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now())), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

function Running({ started, onDone }: { started: Started; onDone: (r: Result | null, message?: string) => void }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => started.questions.map(() => null));
  const left = useCountdown(started.expiresAt);
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  const submit = useMutation({
    mutationFn: () => api<{ result: Result }>(`/skill-test-attempts/${started.attemptId}/submit`, { method: 'POST', body: { answers } }),
    onSuccess: (r) => onDone(r.result),
    onError: (e) => onDone(null, errText(e)),
  });
  const answered = answers.filter((a) => a !== null).length;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{started.title}</h2>
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${left < 5 * 60_000 ? 'text-warning' : 'text-muted'}`} role="timer" aria-live="off"><Clock className="h-4 w-4" aria-hidden />{mins}:{String(secs).padStart(2, '0')} left</span>
      </div>
      <ol className="mt-5 space-y-6">
        {started.questions.map((q, qi) => (
          <li key={q.n}>
            <fieldset>
              <legend className="font-medium">{q.n}. {q.text}</legend>
              <div className="mt-2 grid gap-2">
                {q.options.map((o, oi) => (
                  <label key={oi} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${answers[qi] === oi ? 'border-accent bg-accent-soft' : 'border-border'}`}>
                    <input type="radio" name={`q${q.n}`} className="mt-0.5" checked={answers[qi] === oi} onChange={() => setAnswers(answers.map((a, i) => (i === qi ? oi : a)))} />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="accent" loading={submit.isPending} onClick={() => { if (answered === answers.length || window.confirm(`You answered ${answered} of ${answers.length}. Hand in anyway? Empty answers count as wrong.`)) submit.mutate(); }}>Hand in my answers</Button>
        <span className="text-sm text-muted">{answered} of {answers.length} answered</span>
      </div>
    </Card>
  );
}

export default function SkillTestsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['skill-tests'], queryFn: async () => (await api<{ items: TestItem[] }>('/skill-tests')).items });
  const [started, setStarted] = useState<Started | null>(null);
  const [result, setResult] = useState<{ r: Result; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const begin = useMutation({
    mutationFn: (id: string) => api<Started>(`/skill-tests/${id}/start`, { method: 'POST' }),
    onSuccess: (s) => { setError(null); setResult(null); setStarted(s); },
    onError: (e) => setError(errText(e)),
  });
  const finish = async (r: Result | null, message?: string) => {
    const title = started?.title ?? '';
    setStarted(null);
    if (r) setResult({ r, title }); else setError(message ?? 'Something went wrong.');
    await Promise.all(['skill-tests', 'worker-profile'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };

  return (
    <>
      <PageHeader title="Skill tests" subtitle="Show what you know. A passed test puts a Tested mark on that skill of your profile." />
      <PageBody narrow>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
        {started && <Running started={started} onDone={finish} />}
        {!started && result && (
          <Card className="mb-5 p-5 sm:p-6">
            <h2 role="status" className="flex items-center gap-2 text-lg font-bold"><Award className="h-5 w-5 text-accent" aria-hidden />{result.r.passed ? 'You passed!' : 'Not passed this time'}</h2>
            <p className="mt-2">{result.title}: {result.r.correct} of {result.r.total} right ({result.r.percent}%). You needed {result.r.passPercent}%.</p>
            <p className="mt-1 text-sm text-muted">{result.r.passed ? 'The skill now shows a Tested mark on your profile.' : `You can try again. Attempts left today: ${result.r.attemptsLeftToday}. The questions are chosen again each time.`}</p>
          </Card>
        )}
        {!started && (
          <>
            {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
            {q.isError && <Alert tone="danger">Could not load the tests.</Alert>}
            {q.data?.length === 0 && <EmptyState icon={Award} title="No tests yet" body="Tests are added by the administrators. Check back later." />}
            {q.data && q.data.length > 0 && (
              <ul className="space-y-3">
                {q.data.map((t) => (
                  <li key={t.id}>
                    <Card className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="text-lg font-semibold">{t.title}</h2>
                          <p className="text-sm text-muted">Skill: {t.skill.name}</p>
                        </div>
                        {t.tested && <Badge tone="success">Tested {t.tested.score}%</Badge>}
                      </div>
                      {t.description && <p className="mt-2 text-sm">{t.description}</p>}
                      <p className="mt-2 text-xs text-muted">{t.questionsAsked} questions · pass at {t.passPercent}% · {t.timeLimitMinutes} minutes · multiple choice</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button variant="accent" size="sm" disabled={!t.canTake} loading={begin.isPending && begin.variables === t.id} onClick={() => begin.mutate(t.id)}>{t.tested ? 'Take again' : 'Take the test'}</Button>
                        {t.reason && <span className="text-sm text-muted">{t.reason}{!t.hasSkill && <> <LinkButton to="/profile#skills" variant="ghost" size="sm">Open my profile</LinkButton></>}</span>}
                        {!t.reason && <span className="text-sm text-muted">Attempts left today: {t.attemptsLeftToday}</span>}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-6 text-xs text-muted">A test shows what you could answer on the day. It is not the same as Verified, which means an administrator checked a document. Employers see the Tested mark, but it does not change your match score, and not having taken a test never lowers it.</p>
          </>
        )}
      </PageBody>
    </>
  );
}
