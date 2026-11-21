import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

export type Status = 'FOUND' | 'CLOSE' | 'NOT_FOUND';
export interface DocField { field: string; expected: string; status: Status; required: boolean; note?: string; read?: string }
export type DocType =
  | 'BIRTH_CERTIFICATE' | 'EDUCATION_CERTIFICATE' | 'NATIONAL_ID' | 'EXPERIENCE_LETTER' | 'PROFESSIONAL_CERTIFICATE'
  | 'BUSINESS_LICENSE' | 'TIN_CERTIFICATE' | 'COMMERCIAL_REGISTRATION' | 'REPRESENTATIVE_ID' | 'AUTHORIZATION_LETTER' | 'ORG_REGISTRATION' | 'GOVERNMENT_LETTER' | 'AGENCY_LICENSE';
export interface DocCheck {
  id: string; docType: DocType; educationId: string | null; experienceId: string | null; certificationId: string | null;
  outcome: 'CONSISTENT' | 'PARTIAL' | 'MISMATCH' | 'UNREADABLE'; reason: string | null; fields: DocField[];
  requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null; reviewNote: string | null; createdAt: string;
}

export type ItemStatus = 'MISSING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DONE';
export interface ChecklistItem {
  id: string; key: string; label: string; description: string; required: boolean; checks: string[]; needs: string | null;
  perEntry?: 'education' | 'experience' | 'certification'; status: ItemStatus; check: DocCheck | null; educationId?: string; experienceId?: string; certificationId?: string; detail?: string; blockedBy: string[];
  cvOutcome?: 'ACCEPTED' | 'DECLINED' | 'UNCHECKED' | null;
}
export interface Checklist {
  audience: 'WORKER' | 'EMPLOYER'; required: number; requiredDone: number; complete: boolean; enforced: boolean; items: ChecklistItem[];
  organization?: { name: string; type: string; verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED' };
}

export const useChecklist = (enabled = true) => useQuery({ queryKey: ['checklist'], enabled, queryFn: () => api<Checklist>('/documents/checklist') });
export const useMyDocuments = () => useQuery({ queryKey: ['my-documents'], queryFn: async () => (await api<{ items: DocCheck[] }>('/documents')).items });

export const errorText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) ?? e.message : 'Could not reach the server. Try again.');

/** Everything that depends on the documents has to refresh together. */
export const refreshDocuments = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all(['checklist', 'my-documents', 'my-trust', 'my-verifications', 'identity', 'legal', 'worker-profile', 'org', 'cv-check'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

/** Upload a document. The server reads it and compares it with the details saved for this person or organization; the answer comes straight back. */
export function useUploadDocument(onDone?: (c: DocCheck) => void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async (v: { docType: DocType; educationId?: string; experienceId?: string; certificationId?: string; file: File }) => {
      const body = new FormData();
      body.append('docType', v.docType);
      if (v.educationId) body.append('educationId', v.educationId);
      if (v.experienceId) body.append('experienceId', v.experienceId);
      if (v.certificationId) body.append('certificationId', v.certificationId);
      body.append('file', v.file);
      return (await api<{ check: DocCheck }>('/documents', { method: 'POST', body })).check;
    },
    onSuccess: async (c) => { setError(null); onDone?.(c); await refreshDocuments(qc); },
    onError: (e) => setError(errorText(e)),
  });
  return { ...m, error };
}

/** The refusal the server gives when required documents are missing: what is missing and what to do. */
export interface DocumentsRequired { message: string; missing: string[]; fix: string[] }
export function documentsRequiredFrom(e: unknown): DocumentsRequired | null {
  if (!(e instanceof ApiError) || e.code !== 'DOCUMENTS_REQUIRED') return null;
  const d = (e.details ?? {}) as Record<string, string[]>;
  return { message: e.message, missing: d.missing ?? [], fix: d.fix ?? [] };
}

export interface Identity { fatherName: string | null; grandfatherName: string | null; dateOfBirth: string | null; idType: string | null; idNumber: string | null; verified: boolean }
export interface Legal { tin: string | null; licenseNumber: string | null; licenseExpiresAt: string | null; registrationNumber: string | null }
export const ID_TYPE_LABEL: Record<string, string> = { KEBELE_ID: 'Kebele ID', NATIONAL_ID: 'National (Fayda) ID', PASSPORT: 'Passport', DRIVING_LICENCE: 'Driving licence' };
