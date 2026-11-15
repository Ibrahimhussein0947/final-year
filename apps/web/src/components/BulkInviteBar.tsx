import { useState } from 'react';
import { Send, X } from 'lucide-react';
import { Alert, Card, TextAreaField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useBulkInvite, type BulkInviteResult } from '@/lib/talent';

export const BULK_MAX = 20;

/**
 * Appears when an employer ticks workers in the search: one message, one tap, up to 20 invitations.
 * Afterwards it says, person by person, who was invited and why anyone was skipped.
 */
export function BulkInviteBar({ jobId, selected, names, onClear }: { jobId: string; selected: string[]; names: Record<string, string>; onClear: () => void }) {
  const invite = useBulkInvite(jobId);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkInviteResult | null>(null);

  async function send() {
    setError(null);
    try {
      const r = await invite.mutateAsync({ workerIds: selected, message });
      setResult(r);
      setMessage('');
      onClear();
    } catch (e) {
      const detail = e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) : undefined;
      setError(detail ?? (e instanceof ApiError ? e.message : 'Could not send. Check your connection and try again.'));
    }
  }

  const skipped = result?.results.filter((r) => !r.sent) ?? [];

  return (
    <>
      {result && (
        <div className="mb-4">
          <Alert tone={result.sent > 0 ? 'success' : 'warning'}>
            <p className="font-semibold">{result.sent} invitation{result.sent === 1 ? '' : 's'} sent{result.failed ? `, ${result.failed} not sent` : ''}.</p>
            {skipped.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {skipped.map((r) => <li key={r.workerId}>{names[r.workerId] ?? 'A worker'}: {r.reason}</li>)}
              </ul>
            )}
            <button type="button" className="mt-2 text-sm underline" onClick={() => setResult(null)}>Dismiss</button>
          </Alert>
        </div>
      )}
      {selected.length > 0 && (
        <div className="sticky bottom-3 z-30 mt-4">
          <Card className="space-y-3 p-4 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{selected.length} selected{selected.length >= BULK_MAX ? ` (the most you can invite at once is ${BULK_MAX})` : ''}</p>
              <Button variant="ghost" size="sm" onClick={onClear}><X className="h-4 w-4" aria-hidden /> Clear</Button>
            </div>
            <TextAreaField voice label="One message for everyone (optional)" className="min-h-20" maxLength={300}
              hint="Describe the work. Do not include phone numbers, and never who the person is: messaging opens when they apply."
              value={message} onChange={(e) => setMessage(e.target.value)} />
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button variant="accent" loading={invite.isPending} onClick={send}>
              <Send className="h-4 w-4" aria-hidden /> Invite {selected.length} {selected.length === 1 ? 'person' : 'people'} to apply
            </Button>
          </Card>
        </div>
      )}
    </>
  );
}
