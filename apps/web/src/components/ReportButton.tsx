import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Alert, Card, SelectField, TextAreaField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';

const REASONS: [string, string][] = [
  ['SCAM', 'Scam or fraud (for example asks for money)'], ['FALSE_INFO', 'False or misleading information'], ['DISCRIMINATION', 'Discrimination'],
  ['OFFENSIVE', 'Offensive content'], ['DUPLICATE', 'Duplicate or spam'], ['OTHER', 'Something else'],
];

/** Lets a signed-in person report a job (or a user) to the moderators. */
export function ReportButton({ targetType, targetId, label = 'Report this job' }: { targetType: 'JOB' | 'USER' | 'SERVICE'; targetId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('SCAM');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      await api('/reports', { method: 'POST', body: { targetType, targetId, reason, ...(details.trim() ? { details: details.trim() } : {}) } });
      setMessage({ tone: 'success', text: 'Thank you. Our moderators will review your report.' });
      setOpen(false);
      setDetails('');
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Could not send the report. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {!open && <Button variant="ghost" size="sm" onClick={() => { setOpen(true); setMessage(null); }}><Flag className="h-4 w-4" aria-hidden />{label}</Button>}
      {message && <div className="mt-2"><Alert tone={message.tone}>{message.text}</Alert></div>}
      {open && (
        <Card className="mt-2 p-4">
          <h3 className="font-semibold">{label}</h3>
          <div className="mt-3 space-y-3">
            <SelectField label="What is wrong?" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
            <TextAreaField label="Details (optional)" className="min-h-20" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2"><Button size="sm" variant="accent" loading={busy} onClick={send}>Send report</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </Card>
      )}
    </div>
  );
}
