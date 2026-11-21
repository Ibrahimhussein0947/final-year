import { prisma } from '../../lib/prisma';

/**
 * A worker's "trust level": how much of their profile an administrator has checked against real documents.
 * It is computed from the approved reviews, never typed by the worker, and it is never part of the match score:
 * a person without papers is not ranked lower, they just show fewer checkmarks (see docs/20-proof-and-trust.md).
 *
 * Level 0 Not verified: the ID has not been approved.
 * Level 1 ID verified: the ID document was approved.
 * Levels 2 to 4 add one level for each proven area (education, work experience, certificates or skills).
 */
export const TRUST_LABEL = ['Not verified', 'ID verified', 'Verified', 'Trusted', 'Highly trusted'] as const;

export interface Trust {
  level: 0 | 1 | 2 | 3 | 4;
  label: (typeof TRUST_LABEL)[number];
  /** What has been approved. */
  proven: { identity: boolean; education: boolean; experience: boolean; credentials: boolean };
}

const compute = (p: Trust['proven']): Trust => {
  const level = (p.identity ? 1 + [p.education, p.experience, p.credentials].filter(Boolean).length : 0) as Trust['level'];
  return { level, label: TRUST_LABEL[level], proven: p };
};

/** Trust for many workers at once (search results), in five queries whatever the number. */
export async function trustFor(workerIds: string[]): Promise<Map<string, Trust>> {
  const ids = [...new Set(workerIds)];
  const out = new Map<string, Trust>();
  if (!ids.length) return out;
  const [idReq, edu, exp, cert, skill] = await Promise.all([
    prisma.verificationRequest.findMany({ where: { kind: 'IDENTITY', targetType: 'NATIONAL_ID', targetId: { in: ids }, status: 'APPROVED' }, select: { targetId: true } }),
    prisma.education.findMany({ where: { workerId: { in: ids }, source: 'VERIFIED' }, select: { workerId: true }, distinct: ['workerId'] }),
    prisma.workExperience.findMany({ where: { workerId: { in: ids }, source: 'VERIFIED' }, select: { workerId: true }, distinct: ['workerId'] }),
    prisma.certification.findMany({ where: { workerId: { in: ids }, source: 'VERIFIED' }, select: { workerId: true }, distinct: ['workerId'] }),
    prisma.workerSkill.findMany({ where: { workerId: { in: ids }, source: 'VERIFIED' }, select: { workerId: true }, distinct: ['workerId'] }),
  ]);
  const idSet = new Set(idReq.map((r) => r.targetId));
  const eduSet = new Set(edu.map((r) => r.workerId));
  const expSet = new Set(exp.map((r) => r.workerId));
  const credSet = new Set([...cert.map((r) => r.workerId), ...skill.map((r) => r.workerId)]);
  for (const id of ids) out.set(id, compute({ identity: idSet.has(id), education: eduSet.has(id), experience: expSet.has(id), credentials: credSet.has(id) }));
  return out;
}

export async function trustOf(workerId: string): Promise<Trust> {
  return (await trustFor([workerId])).get(workerId)!;
}

export interface NextStep { key: string; text: string; done: boolean; link: string }

/** The worker's own view: the level plus a plain list of what would raise it and help them get found. */
export async function myTrust(workerId: string) {
  const [trust, w] = await Promise.all([
    trustOf(workerId),
    prisma.workerProfile.findUniqueOrThrow({
      where: { id: workerId },
      select: {
        photoFileId: true, cvFileId: true,
        education: { select: { source: true } }, experiences: { select: { source: true } }, certifications: { select: { source: true } },
      },
    }),
  ]);
  const steps: NextStep[] = [
    { key: 'photo', text: 'Add a clear profile photo', done: !!w.photoFileId, link: '/profile' },
    { key: 'identity', text: 'Upload your ID document so an administrator can verify who you are', done: trust.proven.identity, link: '/documents' },
    { key: 'education', text: w.education.length ? 'Upload the certificate for your education' : 'Add your education, then upload its certificate', done: trust.proven.education, link: '/documents' },
    { key: 'experience', text: w.experiences.length ? 'Upload an experience letter for a job you did' : 'Add the jobs you have done, then upload a letter from an employer', done: trust.proven.experience, link: '/documents' },
    { key: 'credentials', text: w.certifications.length ? 'Upload the certificate or licence you hold' : 'Add a trade, training or competence certificate you hold', done: trust.proven.credentials, link: '/documents' },
    { key: 'cv', text: 'Upload your CV so we can show you the jobs that fit it', done: !!w.cvFileId, link: '/profile' },
  ];
  return { ...trust, next: steps.filter((s) => !s.done), steps };
}
