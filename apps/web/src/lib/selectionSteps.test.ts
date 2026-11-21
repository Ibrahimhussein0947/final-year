import { describe, expect, it } from 'vitest';
import { describeRecorded, type RecordedStep } from './selectionSteps';

const row = (kind: RecordedStep['kind'], data: Record<string, unknown>): RecordedStep => ({ id: '1', kind, data, createdAt: '2026-11-20T00:00:00Z' });

describe('describeRecorded', () => {
  it('summarizes a practical test with its task', () => {
    expect(describeRecorded(row('PRACTICAL_TEST', { score: 82, testDate: '2026-11-19', task: 'Lay a 2 m wall', note: 'private' }))).toBe('82/100 on 2026-11-19: Lay a 2 m wall');
  });
  it('never includes the private note', () => {
    expect(describeRecorded(row('WRITTEN_EXAM', { score: 64, examDate: '2026-11-19', note: 'secret' }))).not.toContain('secret');
  });
  it('summarizes references and guarantors by name', () => {
    expect(describeRecorded(row('REFERENCE_CHECKED', { referee: 'Abebe Kebede', outcome: 'CONCERNS' }))).toBe('Abebe Kebede: concerns');
    expect(describeRecorded(row('GUARANTOR_RECORDED', { guarantor: 'Almaz Tesfaye', relationship: 'Uncle' }))).toBe('Almaz Tesfaye (Uncle)');
  });
});
