import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useUploadDocument } from '@/lib/documents';

interface Req { id: string; kind: string; targetType: string; targetId: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; note: string | null }

const useMyVerifications = () =>
  useQuery({ queryKey: ['my-verifications'], queryFn: async () => (await api<{ items: Req[] }>('/workers/me/verifications')).items });

/**
 * Ask an administrator to verify a skill, education entry, certificate or sector answer (such as a licence) by uploading evidence (PDF, JPG or PNG).
 * Nothing becomes "verified" until an administrator approves it; until then it stays labelled self-reported.
 */
export function VerifyControl({ targetType, targetId }: { targetType: 'EDUCATION' | 'CERTIFICATION' | 'EXPERIENCE' | 'SKILL' | 'CRITERION'; targetId: string }) {
  const q = useMyVerifications();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const latest = q.data?.find((r) => r.targetType === targetType && r.targetId === targetId);

  const send = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('kind', targetType === 'SKILL' ? 'SKILL' : 'QUALIFICATION');
      body.append('targetType', targetType);
      body.append('targetId', targetId);
      body.append('file', file);
      return api('/workers/me/verification', { method: 'POST', body });
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['my-verifications'] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not upload. Try again.'),
  });
  // Education, experience and certificate papers are read and compared with the entry on upload; the full result is under "Identity and certificates".
  const check = useUploadDocument();
  const pick = (f: File) => targetType === 'EDUCATION' ? check.mutate({ docType: 'EDUCATION_CERTIFICATE', educationId: targetId, file: f })
    : targetType === 'EXPERIENCE' ? check.mutate({ docType: 'EXPERIENCE_LETTER', experienceId: targetId, file: f })
    : targetType === 'CERTIFICATION' ? check.mutate({ docType: 'PROFESSIONAL_CERTIFICATE', certificationId: targetId, file: f })
    : send.mutate(f);
  const busy = send.isPending || check.isPending;
  const withdraw = useMutation({
    mutationFn: (id: string) => api(`/workers/me/verifications/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-verifications'] }),
  });

  if (latest?.status === 'PENDING') {
    return <span className="text-xs text-warning">Verification pending · <button type="button" className="underline" onClick={() => withdraw.mutate(latest.id)}>withdraw</button></span>;
  }
  return (
    <span className="text-xs">
      {latest?.status === 'REJECTED' && <span className="text-danger">Not verified{latest.note ? `: ${latest.note}` : ''}. </span>}
      <label className="cursor-pointer font-medium text-accent hover:underline">
        {busy ? (['EDUCATION', 'EXPERIENCE', 'CERTIFICATION'].includes(targetType) ? 'Reading…' : 'Uploading…') : latest?.status === 'REJECTED' ? 'Try again with new evidence' : 'Get verified'}
        <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
      </label>
      {(error ?? check.error) && <span role="alert" className="ml-2 text-danger">{error ?? check.error}</span>}
      {check.data && !busy && <span className="ml-2 text-muted">Checked: see <a href="#identity-documents" className="underline">the result below</a>.</span>}
    </span>
  );
}
