import path from 'node:path';
import PDFDocument from 'pdfkit';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';

/**
 * CV builder: turns a worker's own profile into a one- or two-page PDF. Only the worker can generate it (the route is under
 * /workers/me), so it may contain their phone and email; nothing is stored, the PDF is built on request.
 * Items an administrator verified are marked "Verified"; self-reported ones are not, so the CV never overstates the evidence.
 */

export type CvLang = 'en' | 'am' | 'om';

export type CvData = {
  lang: CvLang;
  name: string;
  headline: string | null;
  contact: string[];
  summary: string | null;
  objective: string | null;
  experiences: { title: string; employer: string | null; period: string; description: string | null; extra: string; achievements: string | null; reasonLeft: string | null; verified: boolean }[];
  education: { title: string; detail: string; verified: boolean }[];
  skills: { name: string; years: number | null; verified: boolean }[];
  certifications: { name: string; detail: string; verified: boolean }[];
  languages: string[];
  awards: { title: string; detail: string }[];
  references: { name: string; relationship: string | null }[];
};

// Amharic and Afaan Oromoo headings are drafts that need native-speaker review, like the rest of the UI strings.
const LABELS: Record<CvLang, Record<string, string>> = {
  en: { objective: 'Objective', awards: 'Awards and achievements', references: 'References', referencesNote: 'Contact details available on request.', achievements: 'Achievements', reasonLeft: 'Reason for leaving', nationality: 'Nationality', BASIC: 'basic', GOOD: 'good', FLUENT: 'fluent', summary: 'Summary', experience: 'Work experience', education: 'Education', skills: 'Skills', certifications: 'Certifications', languages: 'Languages', present: 'Present', verified: 'Verified', years: 'yrs' },
  am: { objective: 'ዓላማ', awards: 'ሽልማቶችና ስኬቶች', references: 'ማጣቀሻዎች', referencesNote: 'የመገናኛ መረጃ በጠየቁ ጊዜ ይሰጣል።', achievements: 'ስኬቶች', reasonLeft: 'የለቀቁበት ምክንያት', nationality: 'ዜግነት', BASIC: 'መሠረታዊ', GOOD: 'ጥሩ', FLUENT: 'አቀላጣፊ', summary: 'ማጠቃለያ', experience: 'የሥራ ልምድ', education: 'ትምህርት', skills: 'ክህሎቶች', certifications: 'ሰርተፊኬቶች', languages: 'ቋንቋዎች', present: 'አሁን', verified: 'የተረጋገጠ', years: 'ዓመት' },
  om: { objective: 'Kaayyoo', awards: 'Badhaasaa fi milkaa’inoota', references: 'Ragaalee namootaa', referencesNote: 'Odeeffannoon quunnamtii yoo gaafatame ni kennama.', achievements: 'Milkaa’inoota', reasonLeft: 'Sababa hojii gadhiisuu', nationality: 'Lammummaa', BASIC: 'bu’uuraa', GOOD: 'gaarii', FLUENT: 'mudaa hin qabne', summary: 'Cuunfaa', experience: 'Muuxannoo hojii', education: 'Barnoota', skills: 'Dandeettiiwwan', certifications: 'Ragaalee', languages: 'Afaanota', present: 'Amma', verified: 'Mirkanaa’e', years: 'waggaa' },
};

const LEVELS: Record<string, string> = {
  NONE: 'No formal education', PRIMARY: 'Primary school', SECONDARY: 'Secondary school', VOCATIONAL_CERTIFICATE: 'Vocational certificate',
  DIPLOMA: 'Diploma', BACHELOR: "Bachelor's degree", MASTER: "Master's degree", DOCTORATE: 'Doctorate',
};
const LEVELS_AM: Record<string, string> = {
  NONE: 'መደበኛ ትምህርት የለም', PRIMARY: 'አንደኛ ደረጃ', SECONDARY: 'ሁለተኛ ደረጃ', VOCATIONAL_CERTIFICATE: 'የሙያ ሰርተፊኬት',
  DIPLOMA: 'ዲፕሎማ', BACHELOR: 'የመጀመሪያ ዲግሪ', MASTER: 'ሁለተኛ ዲግሪ', DOCTORATE: 'ዶክትሬት',
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', TEMPORARY: 'Temporary', CONTRACT: 'Contract', FREELANCE: 'Freelance',
  INTERNSHIP: 'Internship', SEASONAL: 'Seasonal', DAILY: 'Daily work', PERMANENT: 'Permanent', CASUAL: 'Casual',
  APPRENTICESHIP: 'Apprenticeship', VOLUNTEER: 'Volunteer', GIG: 'Gig', ON_CALL: 'On-call',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const pick = (lang: CvLang, en: string, am?: string | null, om?: string | null) => (lang === 'am' ? am || en : lang === 'om' ? om || en : en);
const join = (parts: (string | number | null | undefined)[], sep = ' · ') => parts.filter((p) => p !== null && p !== undefined && p !== '').join(sep);

export async function loadCvData(workerId: string, lang: CvLang): Promise<CvData> {
  const p = await prisma.workerProfile.findUnique({
    where: { id: workerId },
    include: {
      user: { select: { fullName: true, phone: true, email: true } },
      category: true,
      skills: { include: { skill: { select: { nameEn: true, nameAm: true, nameOm: true } } }, orderBy: [{ proficiency: 'desc' }, { skill: { nameEn: 'asc' } }] },
      education: { orderBy: { year: 'desc' } },
      certifications: { orderBy: { year: 'desc' } },
      experiences: { orderBy: { startDate: 'desc' }, include: { category: true } },
      activities: { where: { kind: { in: ['AWARD', 'REFERENCE'] } }, orderBy: { endDate: 'desc' } },
    },
  });
  if (!p) throw notFound('Profile not found');
  const L = LABELS[lang];

  // Walk up the location tree: kebele > woreda > zone > region, most specific first, at most three places.
  const place: string[] = [];
  let locId = p.locationId;
  for (let i = 0; locId && i < 4; i++) {
    const loc = await prisma.location.findUnique({ where: { id: locId } });
    if (!loc) break;
    if (loc.level !== 'KEBELE') place.push(pick(lang, loc.nameEn, loc.nameAm, loc.nameOm));
    locId = loc.parentId;
  }

  return {
    lang,
    name: p.user.fullName,
    headline: p.headline || p.occupation || (p.category ? pick(lang, p.category.nameEn, p.category.nameAm, p.category.nameOm) : null),
    contact: [p.user.phone, p.user.email, join([p.addressLine, place.slice(0, 3).join(', ')], ', '), p.website, p.nationality ? `${L.nationality}: ${p.nationality}` : null].filter((x): x is string => !!x),
    objective: p.objective,
    summary: p.bio,
    experiences: p.experiences.map((e) => ({
      title: e.title,
      employer: e.employer,
      period: `${monthYear(e.startDate)} - ${e.endDate ? monthYear(e.endDate) : L.present}`,
      description: e.description,
      extra: join([e.location, e.employmentType ? EMPLOYMENT_LABEL[e.employmentType] ?? e.employmentType : null]),
      achievements: e.achievements,
      reasonLeft: e.endDate ? e.reasonLeft : null, // a reason only makes sense for a job that ended
      verified: e.source === 'VERIFIED',
    })),
    education: p.education.map((e) => ({
      title: join([(lang === 'am' ? LEVELS_AM : LEVELS)[e.level] ?? e.level, e.field], ' - '),
      detail: join([e.institution, e.department, e.year]),
      verified: e.source === 'VERIFIED',
    })),
    skills: p.skills.map((s) => ({ name: pick(lang, s.skill.nameEn, s.skill.nameAm, s.skill.nameOm), years: s.years, verified: s.source === 'VERIFIED' })),
    certifications: p.certifications.map((c) => ({ name: c.name, detail: join([c.issuer, c.year]), verified: c.source === 'VERIFIED' })),
    languages: p.languages.map((name) => {
      const level = (p.languageLevels as Record<string, string> | null)?.[name];
      return level && L[level] ? `${name} (${L[level]})` : name;
    }),
    awards: p.activities.filter((a) => a.kind === 'AWARD').map((a) => ({ title: a.title, detail: join([a.organization, a.endDate ? a.endDate.getUTCFullYear() : null]) })),
    references: p.activities.filter((a) => a.kind === 'REFERENCE').map((a) => ({ name: a.title, relationship: a.organization })),
  };
}

// ───────────── PDF rendering ─────────────

// PDF's built-in fonts cannot draw Ethiopic script, so Noto Sans Ethiopic is embedded: its Ethiopic file for Ethiopic
// characters and its Latin file for everything else.
function fontPath(file: string) {
  return path.join(path.dirname(require.resolve('@fontsource/noto-sans-ethiopic/package.json')), 'files', file);
}
const ETHIOPIC = /[ሀ-᎟ⶀ-⷟꬀-꬯]/;

type Run = { text: string; ethiopic: boolean };
/** Splits text into runs so Ethiopic characters and everything else each get the matching font file. */
export function splitRuns(text: string): Run[] {
  const runs: Run[] = [];
  for (const ch of text) {
    const ethiopic = ETHIOPIC.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.ethiopic === ethiopic) last.text += ch;
    else runs.push({ text: ch, ethiopic });
  }
  return runs;
}

const INK = '#1f2933';
const MUTED = '#616e7c';
const ACCENT = '#0b6e4f';

export function renderCv(data: CvData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 48, left: 52, right: 52 },
      info: { Title: `CV - ${data.name}`, Author: data.name, Creator: 'EthioTalent AI' },
    });
    // One font family for both scripts, so Latin and Ethiopic text on the same line share a baseline.
    doc.registerFont('Ethiopic', fontPath('noto-sans-ethiopic-ethiopic-400-normal.woff'));
    doc.registerFont('EthiopicBold', fontPath('noto-sans-ethiopic-ethiopic-700-normal.woff'));
    doc.registerFont('Latin', fontPath('noto-sans-ethiopic-latin-400-normal.woff'));
    doc.registerFont('LatinBold', fontPath('noto-sans-ethiopic-latin-700-normal.woff'));
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = LABELS[data.lang];
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    /**
     * Writes wrapped text, switching font file per script inside a line. pdfkit's own "continued" text mixes fonts badly
     * (words after the first drop to a new line), so words are measured and placed at explicit positions here.
     */
    function write(text: string, opts: { size: number; bold?: boolean; color?: string; gap?: number }) {
      if (!text) return;
      const left = doc.page.margins.left;
      const bottom = doc.page.height - doc.page.margins.bottom;
      const fontFor = (ethiopic: boolean) => (ethiopic ? (opts.bold ? 'EthiopicBold' : 'Ethiopic') : opts.bold ? 'LatinBold' : 'Latin');
      const style = (ethiopic: boolean) => doc.font(fontFor(ethiopic)).fontSize(opts.size).fillColor(opts.color ?? INK);
      const runWidth = (r: Run) => style(r.ethiopic).widthOfString(r.text);
      const piecesWidth = (runs: Run[]) => runs.reduce((w, r) => w + runWidth(r), 0);
      const lineH = style(false).currentLineHeight(true) + 2;
      const spaceW = runWidth({ text: ' ', ethiopic: false });

      let y = doc.y;
      let x = left;
      for (const paragraph of text.split('\n')) {
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
          // A word wider than the line (a long link, say) is cut into line-sized pieces.
          let pieces: Run[][] = [splitRuns(word)];
          if (piecesWidth(pieces[0]) > width) {
            pieces = [];
            let current: Run[] = [];
            for (const ch of word) {
              const next = [...current, ...splitRuns(ch)];
              if (current.length && piecesWidth(next) > width) {
                pieces.push(current);
                current = splitRuns(ch);
              } else current = next;
            }
            if (current.length) pieces.push(current);
          }
          for (const runs of pieces) {
            const w = piecesWidth(runs);
            if (x > left && x + w > left + width) {
              y += lineH;
              x = left;
            }
            if (y + lineH > bottom) {
              doc.addPage();
              y = doc.page.margins.top;
            }
            for (const r of runs) {
              style(r.ethiopic).text(r.text, x, y, { lineBreak: false });
              x += runWidth(r);
            }
            x += spaceW;
          }
        }
        y += lineH;
        x = left;
      }
      doc.x = left;
      doc.y = y;
      if (opts.gap) doc.moveDown(opts.gap);
    }
    function section(title: string) {
      if (doc.y > doc.page.height - 110) doc.addPage(); // never leave a heading alone at the bottom of a page
      doc.moveDown(0.7);
      write(title.toUpperCase(), { size: 10.5, bold: true, color: ACCENT });
      const y = doc.y + 1;
      doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + width, y).lineWidth(0.7).strokeColor(ACCENT).stroke();
      doc.moveDown(0.45);
    }
    const tag = (verified: boolean) => (verified ? `  [${L.verified}]` : '');

    write(data.name, { size: 22, bold: true, gap: 0.1 });
    if (data.headline) write(data.headline, { size: 12, color: MUTED, gap: 0.1 });
    if (data.contact.length) write(data.contact.join('   |   '), { size: 9.5, color: MUTED });

    if (data.objective) {
      section(L.objective);
      write(data.objective, { size: 10 });
    }
    if (data.summary) {
      section(L.summary);
      write(data.summary, { size: 10 });
    }
    if (data.experiences.length) {
      section(L.experience);
      for (const e of data.experiences) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        write(join([e.title, e.employer], ' - ') + tag(e.verified), { size: 10.5, bold: true });
        const more = !!(e.description || e.achievements || e.reasonLeft);
        write(join([e.period, e.extra]), { size: 9, color: MUTED, gap: more ? 0.1 : 0.5 });
        if (e.description) write(e.description, { size: 10, gap: e.achievements || e.reasonLeft ? 0.1 : 0.6 });
        if (e.achievements) write(`${L.achievements}: ${e.achievements}`, { size: 10, gap: e.reasonLeft ? 0.1 : 0.6 });
        if (e.reasonLeft) write(`${L.reasonLeft}: ${e.reasonLeft}`, { size: 9, color: MUTED, gap: 0.6 });
      }
    }
    if (data.education.length) {
      section(L.education);
      for (const e of data.education) {
        write(e.title + tag(e.verified), { size: 10.5, bold: true });
        write(e.detail, { size: 9.5, color: MUTED, gap: 0.5 });
      }
    }
    if (data.skills.length) {
      section(L.skills);
      write(data.skills.map((s) => join([s.name, s.years ? `${s.years} ${L.years}` : null], ', ') + (s.verified ? ' *' : '')).join('   •   '), { size: 10 });
      if (data.skills.some((s) => s.verified)) write(`* ${L.verified}`, { size: 8.5, color: MUTED });
    }
    if (data.certifications.length) {
      section(L.certifications);
      for (const c of data.certifications) {
        write(c.name + tag(c.verified), { size: 10.5, bold: true });
        if (c.detail) write(c.detail, { size: 9.5, color: MUTED, gap: 0.4 });
      }
    }
    if (data.languages.length) {
      section(L.languages);
      write(data.languages.join('   •   '), { size: 10 });
    }
    if (data.awards.length) {
      section(L.awards);
      for (const a of data.awards) {
        write(a.title, { size: 10.5, bold: true });
        if (a.detail) write(a.detail, { size: 9.5, color: MUTED, gap: 0.4 });
      }
    }
    if (data.references.length) {
      section(L.references);
      for (const r of data.references) write(join([r.name, r.relationship], ' - '), { size: 10 });
      write(L.referencesNote, { size: 8.5, color: MUTED });
    }
    doc.end();
  });
}

export async function buildCv(workerId: string, lang: CvLang): Promise<Buffer> {
  return renderCv(await loadCvData(workerId, lang));
}
