/**
 * What a worker can do after "not selected". Built from the match stored when they applied plus what their profile
 * lacks today. These are suggestions about the profile, never reasons the employer gave, and nothing here says a person
 * is unfit: a different job may fit them better.
 */
export interface Tip { key: string; text: string; link: string }

interface Snapshot {
  missingSkills?: string[];
  criteria?: { unmet?: { label: string; mustHave: boolean }[] };
  components?: Record<string, { score: number | null; note?: string } | undefined>;
  distanceKm?: number | null;
}
export interface ProfileState {
  hasCv: boolean;
  hasPhoto: boolean;
  identityVerified: boolean;
  hasCertificates: boolean;
  skillCount: number;
}

const MAX_TIPS = 5;
const LOW = 0.5;

export function rejectionTips(snap: Snapshot | null, p: ProfileState): Tip[] {
  const tips: Tip[] = [];
  const low = (k: string) => {
    const c = snap?.components?.[k];
    return c && c.score !== null && c.score < LOW ? c : null;
  };
  const missing = snap?.missingSkills ?? [];
  if (missing.length) tips.push({ key: 'skills', text: `Learn or add: ${missing.slice(0, 4).join(', ')}. If you already have these skills, add them to your profile; if not, see the training suggestions.`, link: '/profile' });
  for (const u of (snap?.criteria?.unmet ?? []).filter((c) => c.mustHave).slice(0, 2)) {
    tips.push({ key: `criterion:${u.label}`, text: `This job needed: ${u.label}. If you have it, answer it under "Sector details" and upload the proof so it can be verified.`, link: '/profile' });
  }
  if (low('experience')) tips.push({ key: 'experience', text: 'The job asked for more experience. Add earlier jobs, apprenticeships, volunteering or internships, even informal ones, and upload a letter from an employer.', link: '/documents' });
  if (low('qualification')) tips.push({ key: 'qualification', text: 'The job asked for a higher level of education. If you have the certificate, add it to your education and upload it so it can be verified.', link: '/documents' });
  if (low('location')) tips.push({ key: 'location', text: 'The job was far from your location. Check your place in your profile, or say you are willing to relocate or travel.', link: '/profile' });
  if (low('availability')) tips.push({ key: 'availability', text: 'Your availability did not fit the start date. Update when you can start.', link: '/profile' });

  // Things that make any profile easier to trust, whatever this job asked for.
  if (!p.identityVerified) tips.push({ key: 'identity', text: 'Get your ID verified. Employers see a badge next to verified people.', link: '/documents' });
  if (!p.hasCv) tips.push({ key: 'cv', text: 'Upload your CV so we can show you the jobs that fit it.', link: '/profile' });
  if (!p.hasPhoto) tips.push({ key: 'photo', text: 'Add a clear profile photo.', link: '/profile' });
  if (p.skillCount < 3) tips.push({ key: 'moreSkills', text: 'List more of the skills you really have. Profiles with 3 or more skills are matched to more jobs.', link: '/profile' });
  if (!p.hasCertificates) tips.push({ key: 'certificates', text: 'Add any training or trade certificate you hold and upload it.', link: '/documents' });
  return tips.slice(0, MAX_TIPS);
}
