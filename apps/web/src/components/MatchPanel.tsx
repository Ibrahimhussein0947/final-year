import { Check, Info, ShieldCheck, X } from 'lucide-react';
import { Alert, Badge, Card } from '@/components/ui/primitives';
import { ComponentBar, ScoreRing } from '@/components/MatchBreakdown';
import { COMPONENT_LABEL, type BriefMatch, type ComponentKey, type Match, type Strength } from '@/lib/matching';

const STRENGTH: Record<Strength, { label: string; tone: 'success' | 'accent' | 'warning' | 'neutral' }> = {
  strong: { label: 'Strong match', tone: 'success' },
  good: { label: 'Good match', tone: 'accent' },
  partial: { label: 'Partial match', tone: 'warning' },
  weak: { label: 'Weak match', tone: 'neutral' },
};
const ORDER: ComponentKey[] = ['skills', 'experience', 'location', 'availability', 'qualification', 'preferences', 'criteria'];

/** Compact score for lists. The number is the weighted score out of 100, never a made-up percentage. */
export function MatchBadge({ match }: { match: BriefMatch | null }) {
  if (!match) return null;
  const s = STRENGTH[match.strength];
  if (match.eligibility === 'not_eligible') {
    return <span title="A required sector condition is not met"><Badge tone="danger">Not eligible</Badge></span>;
  }
  return (
    <span title={`Match score ${match.score} out of 100 (${Math.round(match.confidence * 100)}% of the profile could be assessed)`}>
      <Badge tone={s.tone}>{match.score} · {s.label}</Badge>
    </span>
  );
}

/** Full breakdown: score, plain-language reason, each component with its weight, skills, and what was not assessed. */
export function MatchPanel({ match, title = 'Why this match' }: { match: Match; title?: string }) {
  const s = STRENGTH[match.strength];
  const c = match.criteria;
  const hasCriteria = !!c && c.met.length + c.unmet.length + c.unknown.length > 0;
  return (
    <Card className="p-5">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-4 flex items-center gap-5">
        <ScoreRing value={match.score} size={92} label="Match score" />
        <div>
          {match.eligibility === 'not_eligible' ? <Badge tone="danger">Not eligible</Badge> : <Badge tone={s.tone}>{s.label}</Badge>}
          <p className="mt-1 text-xs text-muted">Based on {Math.round(match.confidence * 100)}% of the information available</p>
        </div>
      </div>

      {match.eligibility === 'not_eligible' && (
        <div className="mt-4"><Alert tone="danger">A required condition for this job is not met: {match.criteria?.unmet.filter((u) => u.mustHave).map((u) => u.label).join('; ')}. You may still apply, but the employer will see this.</Alert></div>
      )}
      {match.eligibility === 'unknown' && (
        <div className="mt-4"><Alert tone="warning">Not yet confirmed: {match.criteria?.unknown.filter((u) => u.mustHave).map((u) => u.label).join('; ')}. Answer these in "Sector details" on your profile.</Alert></div>
      )}
      <p className="mt-4 rounded-xl bg-accent-soft p-3 text-sm text-accent">{match.explanation}</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {ORDER.filter((k) => k !== 'criteria' || hasCriteria).map((k) => (
          <div key={k}>
            <ComponentBar label={`${COMPONENT_LABEL[k]} (${Math.round(match.components[k].weight * 100)}%)`} value={match.components[k].score} />
          </div>
        ))}
      </div>

      {(match.matchedSkills.length > 0 || match.relatedSkills.length > 0 || match.missingSkills.length > 0) && (
        <div className="mt-5 space-y-2 text-sm">
          {match.matchedSkills.map((n) => <p key={n} className="flex items-center gap-2"><Check className="h-4 w-4 text-success" aria-hidden />{n}</p>)}
          {match.relatedSkills.map((r) => (
            <p key={r.required} className="flex items-center gap-2"><Check className="h-4 w-4 text-warning" aria-hidden />{r.required} <span className="text-muted">through related skill {r.has} ({Math.round(r.credit * 100)}% credit)</span></p>
          ))}
          {match.missingSkills.map((n) => <p key={n} className="flex items-center gap-2"><X className="h-4 w-4 text-danger" aria-hidden />{n} <span className="text-muted">not listed</span></p>)}
        </div>
      )}

      {hasCriteria && c && (
        <div className="mt-5 space-y-1.5 text-sm">
          <p className="font-medium">Sector requirements</p>
          {c.met.map((m) => <p key={m.label} className="flex items-center gap-2"><Check className="h-4 w-4 text-success" aria-hidden />{m.label}{m.verified ? <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />verified</span> : <span className="text-xs text-muted">self-reported</span>}</p>)}
          {c.unmet.map((u) => <p key={u.label} className="flex items-center gap-2"><X className="h-4 w-4 text-danger" aria-hidden />{u.label} <span className="text-xs text-muted">{u.mustHave ? 'required, not met' : 'preferred, not met'}</span></p>)}
          {c.unknown.map((u) => <p key={u.label} className="flex items-center gap-2"><Info className="h-4 w-4 text-muted" aria-hidden />{u.label} <span className="text-xs text-muted">{u.mustHave ? 'required, not answered' : 'not answered'}</span></p>)}
        </div>
      )}

      {match.notAssessed.length > 0 && (
        <div className="mt-5 flex gap-2 text-xs text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Not assessed</p>
            <ul>{match.notAssessed.map((n) => <li key={n.component}>{COMPONENT_LABEL[n.component]}: {n.reason}</li>)}</ul>
            <p className="mt-1">Missing information is left out, not counted as zero.</p>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">
        {match.semantic?.similarity != null
          ? `Hybrid score (${match.engineVersion}): rule-based facts plus semantic similarity of the profile wording to the job (${Math.round((match.semantic.score ?? 0) * 100)}%, adding ${Math.round(match.semantic.lift * 100)} points to the skills part).`
          : `Rule-based score (${match.engineVersion}); semantic similarity was not available.`}{' '}
        It supports decisions; people make the final choice.
      </p>
    </Card>
  );
}
