export const TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', TEMPORARY: 'Temporary', CONTRACT: 'Contract',
  FREELANCE: 'Freelance', INTERNSHIP: 'Internship', SEASONAL: 'Seasonal', DAILY: 'Daily work',
};
export const MODE_LABEL: Record<string, string> = { ON_SITE: 'On-site', REMOTE: 'Remote', HYBRID: 'Hybrid' };
export const EDU_LABEL: Record<string, string> = {
  NONE: 'No formal education', PRIMARY: 'Primary', SECONDARY: 'Secondary', VOCATIONAL_CERTIFICATE: 'Vocational certificate',
  DIPLOMA: 'Diploma', BACHELOR: "Bachelor's degree", MASTER: "Master's degree", DOCTORATE: 'Doctorate',
};

const nf = new Intl.NumberFormat('en-US');

export function formatSalary(min: number | null, max: number | null, currency = 'ETB'): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return min === max ? `${nf.format(min)} ${currency}` : `${nf.format(min)} – ${nf.format(max)} ${currency}`;
  return min !== null ? `From ${nf.format(min)} ${currency}` : `Up to ${nf.format(max!)} ${currency}`;
}

export function formatPlace(path: { name: string }[], remote = false): string {
  if (!path.length) return remote ? 'Remote' : 'Location not specified';
  // Most specific first, then the region: "Adama, Oromia"
  const [region, ...rest] = path.map((p) => p.name);
  return rest.length ? `${rest[rest.length - 1]}, ${region}` : region;
}

export function deadlineText(deadline: string | null): { text: string; urgent: boolean } {
  if (!deadline) return { text: 'Open until filled', urgent: false };
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: 'Closed', urgent: true };
  if (days === 0) return { text: 'Closes today', urgent: true };
  if (days <= 7) return { text: `${days} day${days === 1 ? '' : 's'} left`, urgent: true };
  return { text: `Closes ${new Date(deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, urgent: false };
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString('en-GB');
}
