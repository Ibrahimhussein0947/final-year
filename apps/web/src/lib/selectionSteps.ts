import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type StepKind = 'WRITTEN_EXAM' | 'PRACTICAL_TEST' | 'SCORE_SHEET' | 'REFERENCE_CHECKED' | 'GUARANTOR_RECORDED';

export interface StepStatus { key: string; label: string; help: string; required: boolean; suggested: boolean; done: boolean; detail: string }
export interface RecordedStep { id: string; kind: StepKind; data: Record<string, unknown>; createdAt: string }
export interface HiringView { open: boolean; panelSize: number; steps: StepStatus[]; recorded: RecordedStep[] }

export const STEP_FORM_LABEL: Record<StepKind, string> = {
  WRITTEN_EXAM: 'Written exam',
  PRACTICAL_TEST: 'Practical skills test',
  SCORE_SHEET: 'Panel score sheet',
  REFERENCE_CHECKED: 'Reference check',
  GUARANTOR_RECORDED: 'Guarantor',
};

export const useHiringSteps = (applicationId: string | undefined) =>
  useQuery({ queryKey: ['hiring-steps', applicationId], queryFn: () => api<HiringView>(`/applications/${applicationId}/hiring`), enabled: !!applicationId });

/** One line describing what was recorded, without the private note. */
export function describeRecorded(r: RecordedStep): string {
  const d = r.data as Record<string, unknown>;
  switch (r.kind) {
    case 'WRITTEN_EXAM': return `${d.score}/100 on ${d.examDate}`;
    case 'PRACTICAL_TEST': return `${d.score}/100 on ${d.testDate}: ${d.task}`;
    case 'SCORE_SHEET': {
      const s = d.scores as Record<string, number>;
      return `${d.panelist}: skills ${s.skills}, experience ${s.experience}, communication ${s.communication}, suitability ${s.suitability}`;
    }
    case 'REFERENCE_CHECKED': return `${d.referee}: ${d.outcome === 'POSITIVE' ? 'positive' : 'concerns'}`;
    case 'GUARANTOR_RECORDED': return `${d.guarantor} (${d.relationship})`;
  }
}
