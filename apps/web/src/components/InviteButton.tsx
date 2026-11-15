import { useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useInviteWorker, type InvitationState } from '@/lib/talent';

/**
 * Invite a worker to apply to one of your open jobs. An invitation is not an application: the worker decides, and
 * nothing about them is shared with you until they apply. Your message must describe the work, not who the person is.
 */
export function InviteButton({ jobId, workerId, invitation, applied }: { jobId: string; workerId: string; invitation?: InvitationState | null; applied?: boolean }) {
  const invite = useInviteWorker(jobId);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (applied || invitation === 'APPLIED') return <Badge tone="success">Applied</Badge>;
  if (invitation === 'SENT') return <Badge tone="accent">Invited</Badge>;
  if (invitation === 'DECLINED') return <Badge>Declined the invitation</Badge>;

  async function send() {
    setError(null);
    try {
      await invite.mutateAsync({ workerId, message });
      setOpen(false);
    } catch (e) {
      const detail = e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) : undefined;
      setError(detail ?? (e instanceof ApiError ? e.message : 'Could not send. Check your connection and try again.'));
    }
  }

  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Invite to apply</Button>;
  return (
    <div className="mt-1 w-full max-w-md space-y-2 rounded-xl border border-border p-3">
      <label className="block text-sm font-medium">
        Message (optional)
        <textarea className="mt-1.5 w-full rounded-xl border border-border bg-surface p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent" rows={3} maxLength={300}
          placeholder="Why this job fits their skills. Do not include phone numbers; messaging opens when they apply." value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="accent" loading={invite.isPending} onClick={send}>Send invitation</Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
        <span className="ml-auto text-xs text-muted">{message.length}/300</span>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
