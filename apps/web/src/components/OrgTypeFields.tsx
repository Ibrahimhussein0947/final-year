import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { useEmployerBadge, useOrgType, useOrgTypeCatalog } from '@/lib/orgTypes';

/**
 * The options of an organization-type select, grouped (businesses, government and public bodies, non-profit,
 * individuals and households, agencies, schools). Older industry-flavoured types are offered only to an account that
 * already has one (`keep`), since industry is expressed by the sector of each job.
 */
export function OrgTypeOptions({ keep }: { keep?: string }) {
  const c = useOrgTypeCatalog();
  const shown = c.types.filter((t) => !t.legacy || t.value === keep);
  if (c.groups.length === 1) return <>{shown.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</>;
  return (
    <>
      {c.groups.map((g) => {
        const inGroup = shown.filter((t) => t.group === g.group);
        return inGroup.length === 0 ? null : (
          <optgroup key={g.group} label={g.label}>
            {inGroup.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}

/** A short explanation of the chosen type and the rules that come with it. */
export function OrgTypeHelp({ value }: { value: string | undefined }) {
  const t = useOrgType(value);
  if (!t || !t.description) return null;
  return (
    <div className="rounded-xl bg-surface-2 p-3 text-xs text-muted sm:col-span-2">
      <p>{t.description}</p>
      {t.rules.length > 0 && (
        <>
          <p className="mt-1.5 font-medium text-text">Formal hiring rules apply to this type:</p>
          <ul className="list-disc pl-5">{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
    </div>
  );
}

/** What to upload to get verified, for this type of organization. */
export function OrgTypeDocuments({ value }: { value: string }) {
  const t = useOrgType(value);
  if (!t || t.documents.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-border p-3 text-sm">
      <p className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4 text-muted" aria-hidden />For {t.label}, prepare one of these:</p>
      <ul className="mt-1.5 list-disc pl-9 text-muted">{t.documents.map((d) => <li key={d}>{d}</li>)}</ul>
      <p className="mt-1.5 text-xs text-muted">An administrator reviews your document and decides. Upload a clear scan or photo; it is never shown to workers.</p>
    </div>
  );
}

/** "Government vacancy", "Individual employer"...: shown for employers that are not an ordinary business. */
export function EmployerKindBadge({ type, label }: { type: string | undefined; label?: string | null }) {
  const fallback = useEmployerBadge(type);
  const text = label ?? fallback;
  return text ? <Badge tone="info">{text}</Badge> : null;
}
