import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Upload, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { errorText, refreshDocuments, type DocCheck, type Status } from '@/lib/documents';

export const OUTCOME: Record<DocCheck['outcome'], { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string; help: string }> = {
  CONSISTENT: { tone: 'success', label: 'Details match', help: 'Everything we looked for was found on the document. An administrator still has to approve it before it shows as verified.' },
  PARTIAL: { tone: 'warning', label: 'Mostly matches', help: 'The main details match but something small is missing or unclear. An administrator will look at the document closely.' },
  MISMATCH: { tone: 'danger', label: "Some details don't match", help: 'Check that what you typed is spelled the same as on the document. If it is correct, you can leave it: an administrator will compare by eye. Otherwise fix it and upload again.' },
  UNREADABLE: { tone: 'neutral', label: 'Could not be read', help: 'We could not read enough of this file to compare it. An administrator will check it by eye. A sharper, well-lit photo or the original PDF reads best.' },
};
const FIELD_ICON: Record<Status, JSX.Element> = {
  FOUND: <CheckCircle2 className="h-4 w-4 text-success" aria-label="found" />,
  CLOSE: <AlertTriangle className="h-4 w-4 text-warning" aria-label="almost" />,
  NOT_FOUND: <XCircle className="h-4 w-4 text-danger" aria-label="not found" />,
};

/** The comparison of one uploaded document with the details that were typed, and where it is in review. */
export function CheckResult({ doc, label }: { doc: DocCheck; label?: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: () => api(`/documents/${doc.id}`, { method: 'DELETE' }),
    onSuccess: async () => { await refreshDocuments(qc); },
    onError: (e) => setError(errorText(e)),
  });
  const o = OUTCOME[doc.outcome];
  return (
    <div className="rounded-xl border border-border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{label ?? 'Uploaded document'} <span className="font-normal text-muted">· {new Date(doc.createdAt).toLocaleDateString('en-GB')}</span></p>
        <Badge tone={o.tone}>{o.label}</Badge>
      </div>
      <ul className="mt-3 space-y-1.5" aria-label="What was compared">
        {doc.fields.map((f) => (
          <li key={f.field} className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">{FIELD_ICON[f.status]}</span>
            <span><strong>{f.field}</strong>: {f.expected}{f.note ? <span className="text-muted"> ({f.note})</span> : null}{f.read ? <span className="block text-xs text-muted">Document says: “{f.read}”</span> : <span className="block text-xs text-muted">Nothing like this could be read on the document.</span>}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-muted">{doc.reason ? `${doc.reason} ` : ''}{o.help}</p>
      <p className="mt-2 font-medium">
        {doc.requestStatus === 'APPROVED' ? <span className="text-success">Approved by an administrator.</span>
          : doc.requestStatus === 'REJECTED' ? <span className="text-danger">Rejected{doc.reviewNote ? `: ${doc.reviewNote}` : '.'} Upload a better copy.</span>
          : <span className="text-warning">Waiting for an administrator to review it.</span>}
      </p>
      {doc.requestStatus === 'PENDING' && (
        <div className="mt-2"><Button size="sm" variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw and upload again</Button></div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function FilePicker({ label, onFile, busy, disabled, variant = 'accent' }: { label: string; onFile: (f: File) => void; busy: boolean; disabled?: boolean; variant?: 'accent' | 'outline' }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" aria-label={label} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <Button type="button" variant={variant} loading={busy} disabled={disabled} onClick={() => ref.current?.click()}><Upload className="h-4 w-4" aria-hidden /> {label}</Button>
    </>
  );
}
