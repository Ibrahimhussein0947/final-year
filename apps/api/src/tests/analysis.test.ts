import { describe, expect, it } from 'vitest';
import { analyzeJob } from '../modules/analysis/jobAnalyzer';
import { parseCv, parseDateRange, yearsCovered } from '../modules/analysis/cvParser';
import { findSkills, type IndexedSkill } from '../modules/analysis/skillIndex';
import { extractPdfText } from '../modules/analysis/pdf';
import { makePdf } from './helpers/pdf';

// A small taxonomy, so these tests do not need the database.
const skill = (id: string, name: string, aliases: string[], categoryId = 'cat-auto'): IndexedSkill => ({ id, name, categoryId, terms: [name, ...aliases] });
const INDEX: IndexedSkill[] = [
  skill('engine', 'Engine Repair', ['vehicle repair', 'engine overhaul']),
  skill('brakes', 'Brake Systems', ['brake repair']),
  skill('welding', 'Welding', ['arc welding', 'mig welding']),
  skill('cooking', 'Cooking', ['chef', 'kitchen work'], 'cat-food'),
  skill('js', 'JavaScript', ['js', 'typescript'], 'cat-ict'),
  skill('hr', 'Human Resources', ['hr', 'recruitment'], 'cat-biz'),
];
const CATEGORIES = [
  { id: 'cat-auto', slug: 'automotive', nameEn: 'Automotive and Mechanics' },
  { id: 'cat-food', slug: 'hospitality', nameEn: 'Hospitality and Food Service' },
  { id: 'cat-ict', slug: 'ict', nameEn: 'Information Technology' },
];
const NOW = new Date('2026-06-01T00:00:00Z');

describe('skill matching', () => {
  const hit = (text: string) => findSkills(text, INDEX).map((h) => h.name);

  it('finds names and aliases case-insensitively, including plurals', () => {
    expect(hit('Strong ENGINE REPAIR skills')).toEqual(['Engine Repair']);
    expect(hit('can do vehicle repair and brake repairs')).toEqual(['Engine Repair', 'Brake Systems']);
    expect(hit('Brake systems')).toEqual(['Brake Systems']);
  });

  it('does not match inside longer words', () => {
    expect(hit('The shrub was trimmed by the welder')).toEqual([]);
    expect(hit('arcwelding')).toEqual([]);
  });

  it('requires capitals for very short terms', () => {
    expect(hit('HR manager')).toEqual(['Human Resources']);
    expect(hit('JS developer')).toEqual(['JavaScript']);
    expect(hit('this js thing and hr stuff')).toEqual([]);
  });

  it('reports the line a skill was found in and how often', () => {
    const [h] = findSkills('intro\nwe need engine repair\nalso engine repair again', INDEX);
    expect(h.line).toBe(1);
    expect(h.count).toBe(2);
    expect(h.evidence).toBe('we need engine repair');
  });
});

describe('job description analysis', () => {
  const AD = [
    'Minibus Mechanic',
    'We are a garage in Adama looking for a mechanic.',
    '',
    'Requirements:',
    '- At least 3 years of relevant experience',
    '- Must be able to do engine repair and brake repair',
    '- Diploma in automotive technology (TVET)',
    '- Fluent Amharic and Afaan Oromo',
    '',
    'Nice to have:',
    '- Arc welding',
    '',
    'Full-time, Monday to Saturday. Salary 6,000 - 9,000 ETB per month.',
  ].join('\n');

  const r = analyzeJob({ title: 'Minibus Mechanic', description: AD }, INDEX, CATEGORIES);

  it('separates required from nice-to-have skills using cues and headings', () => {
    const by = Object.fromEntries(r.skills.map((s) => [s.name, s.importance]));
    expect(by).toEqual({ 'Engine Repair': 'REQUIRED', 'Brake Systems': 'REQUIRED', Welding: 'PREFERRED' });
    expect(r.skills.find((s) => s.name === 'Welding')!.confidence).toBe('medium'); // from the heading, no cue in the line
    expect(r.skills.find((s) => s.name === 'Engine Repair')!.evidence).toContain('engine repair');
  });

  it('reads experience, qualification, type, languages, salary and category with evidence', () => {
    expect(r.minExperienceYears).toMatchObject({ value: 3, confidence: 'high' });
    expect(r.minExperienceYears!.evidence).toContain('3 years');
    expect(r.requiredEducationLevel).toMatchObject({ value: 'DIPLOMA' }); // TVET is the school, not a second level
    expect(r.employmentType).toMatchObject({ value: 'FULL_TIME', confidence: 'high' });
    expect(r.languages!.value).toEqual(['Amharic', 'Afaan Oromoo']);
    expect(r.salary!.value).toEqual({ min: 6000, max: 9000 });
    expect(r.category!.value.id).toBe('cat-auto');
    expect(r.method).toBe('rules-1.0');
  });

  it('is honest about defaults: no cue means low confidence', () => {
    expect(r.workMode).toEqual({ value: 'ON_SITE', confidence: 'low', evidence: null });
    const bare = analyzeJob({ description: 'We need someone to help in the shop every day.' }, INDEX, CATEGORIES);
    expect(bare.employmentType).toEqual({ value: 'FULL_TIME', confidence: 'low', evidence: null });
    expect(bare.skills).toEqual([]);
    expect(bare.notes[0]).toContain('No skills');
    expect(bare.category).toBeNull();
    expect(bare.minExperienceYears).toBeNull();
    expect(bare.salary).toBeNull();
  });

  it.each([
    ['At least 2 years experience in welding', 2],
    ['Minimum of 5 years of work experience', 5],
    ['2-3 years of experience required', 2],
    ['Experience: 4 years', 4],
    ['5+ years experience', 5],
  ])('reads experience from "%s"', (line, years) => {
    expect(analyzeJob({ description: line }, INDEX, CATEGORIES).minExperienceYears?.value).toBe(years);
  });

  it('recognises "no experience needed" as no minimum rather than missing', () => {
    for (const line of ['No experience required, we train you.', 'Fresh graduates are welcome to apply.', 'Entry level position']) {
      const a = analyzeJob({ description: line }, INDEX, CATEGORIES);
      expect(a.minExperienceYears).toMatchObject({ value: null, confidence: 'high' });
    }
  });

  it.each([
    ['No formal education required', null],
    ['Bachelor degree in accounting', 'BACHELOR'],
    ['MSc or PhD preferred', 'MASTER'],
    ['Completed grade 12', 'SECONDARY'],
    ['TVET certificate in plumbing', 'VOCATIONAL_CERTIFICATE'],
    ['Diploma or Bachelor degree', 'DIPLOMA'],
  ])('reads qualification from "%s"', (line, level) => {
    expect(analyzeJob({ description: line }, INDEX, CATEGORIES).requiredEducationLevel?.value).toBe(level);
  });

  it('warns when several qualification levels are mentioned', () => {
    expect(analyzeJob({ description: 'Diploma or Bachelor degree' }, INDEX, CATEGORIES).notes.join(' ')).toContain('several qualification levels');
  });

  it.each([
    ['3-month internship for students', 'INTERNSHIP'],
    ['Daily labourer needed for loading', 'DAILY'],
    ['Seasonal coffee picking', 'SEASONAL'],
    ['Part-time cashier', 'PART_TIME'],
    ['Six-month contract position', 'CONTRACT'],
    ['Freelance designer, per project', 'FREELANCE'],
  ])('reads employment type from "%s"', (line, type) => {
    expect(analyzeJob({ description: line }, INDEX, CATEGORIES).employmentType.value).toBe(type);
  });

  it('reads work mode, and does not call "remote area" a remote job by mistake', () => {
    expect(analyzeJob({ description: 'This is a hybrid role.' }, INDEX, CATEGORIES).workMode.value).toBe('HYBRID');
    expect(analyzeJob({ description: 'You can work from home.' }, INDEX, CATEGORIES).workMode.value).toBe('REMOTE');
  });

  it('marks skills that appear with a "preferred" cue as nice-to-have', () => {
    const a = analyzeJob({ description: 'Welding is an advantage. Engine repair is required.' }, INDEX, CATEGORIES);
    expect(Object.fromEntries(a.skills.map((s) => [s.name, s.importance]))).toEqual({ Welding: 'PREFERRED', 'Engine Repair': 'REQUIRED' });
  });
});

describe('CV date ranges', () => {
  const r = (s: string) => parseDateRange(s, NOW);
  it('reads common formats', () => {
    expect(r('2018 - 2022')).toMatchObject({ start: new Date('2018-01-01T00:00:00Z'), end: new Date('2022-01-01T00:00:00Z') });
    expect(r('Jan 2019 – Present')).toMatchObject({ start: new Date('2019-01-01T00:00:00Z'), end: null });
    expect(r('03/2018 – 06/2021')).toMatchObject({ start: new Date('2018-03-01T00:00:00Z'), end: new Date('2021-06-01T00:00:00Z') });
    expect(r('September 2015 to date')).toMatchObject({ start: new Date('2015-09-01T00:00:00Z'), end: null });
    expect(r('Worked 2020 - current')).toMatchObject({ end: null });
  });
  it('rejects impossible ranges', () => {
    expect(r('2023 - 2019')).toBeNull(); // ends before it starts
    expect(r('2031 - 2032')).toBeNull(); // starts in the future
    expect(r('1850 - 1860')).toBeNull();
    expect(r('no dates here')).toBeNull();
  });
  it('counts overlapping periods once', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(yearsCovered([{ start: d('2010-01-01'), end: d('2014-01-01') }, { start: d('2012-01-01'), end: d('2016-01-01') }])).toBe(6);
    expect(yearsCovered([{ start: d('2010-01-01'), end: d('2012-01-01') }, { start: d('2020-01-01'), end: d('2021-01-01') }])).toBe(3);
    expect(yearsCovered([{ start: d('2025-06-01'), end: null }], NOW)).toBe(1);
    expect(yearsCovered([])).toBe(0);
  });
});

describe('CV parsing', () => {
  const CV = [
    'ABEBE KEBEDE',
    'Adama, Ethiopia',
    '',
    'Professional Summary',
    'Experienced minibus mechanic with 10 years of experience repairing engines and brakes.',
    '',
    'Work Experience',
    'Senior Mechanic - Adama Auto Garage',
    '2018 - Present',
    '- Diagnosed engine faults and repaired brake systems',
    '- Trained two apprentices',
    'Mechanic at Hawassa Transport',
    'Jan 2012 - Dec 2017',
    '',
    'Education',
    'Diploma in Automotive Technology',
    'Adama TVET College, 2011',
    '',
    'Skills',
    'Engine repair, Brake repair, MIG welding, Teamwork',
    '',
    'Certifications',
    'Certificate in Defensive Driving, 2015',
    '',
    'Languages',
    'Amharic, Afaan Oromo, English',
  ].join('\n');
  const p = parseCv(CV, INDEX, NOW);

  it('finds the sections', () => {
    expect(p.sectionsFound.sort()).toEqual(['certifications', 'education', 'experience', 'languages', 'skills', 'summary']);
    expect(p.warnings).toEqual([]);
    expect(p.summary).toContain('minibus mechanic');
  });

  it('reads work experience with titles, employers and dates, without mixing entries', () => {
    expect(p.experiences).toHaveLength(2);
    expect(p.experiences[0]).toMatchObject({ title: 'Senior Mechanic', employer: 'Adama Auto Garage', startDate: '2018-01-01', endDate: null });
    expect(p.experiences[0].description).toContain('Diagnosed engine faults');
    expect(p.experiences[0].description).not.toContain('Hawassa');
    expect(p.experiences[1]).toMatchObject({ title: 'Mechanic', employer: 'Hawassa Transport', startDate: '2012-01-01', endDate: '2017-12-01' });
  });

  it('reads education, certificates and languages', () => {
    expect(p.education).toEqual([{ level: 'DIPLOMA', field: 'Automotive Technology', institution: 'Adama TVET College', year: 2011 }]);
    expect(p.certifications).toEqual([{ name: 'Certificate in Defensive Driving', year: 2015 }]);
    expect(p.languages).toEqual(['Amharic', 'Afaan Oromoo', 'English']);
  });

  it('matches taxonomy skills, flags those from the skills section, and lists the rest as unrecognised', () => {
    const by = Object.fromEntries(p.skills.map((s) => [s.name, s.inSkillsSection]));
    expect(by).toEqual({ 'Engine Repair': true, 'Brake Systems': true, Welding: true });
    expect(p.unrecognizedSkills).toEqual(['Teamwork']);
  });

  it('estimates experience from dates, using the larger of dates and the stated figure', () => {
    expect(p.estimatedYearsExperience).toBeGreaterThan(13);
    expect(p.estimatedYearsExperience).toBeLessThan(15);
  });

  it('warns instead of guessing when there are no section headings', () => {
    const flat = parseCv('Abebe Kebede\nI repair engines. Worked 2015 - 2020 at Garage X as mechanic.', INDEX, NOW);
    expect(flat.warnings[0]).toContain('No clear section headings');
    expect(flat.sectionsFound).toEqual([]);
  });

  it('copes with empty and odd input', () => {
    expect(parseCv('', INDEX, NOW)).toMatchObject({ skills: [], experiences: [], education: [], estimatedYearsExperience: null });
    expect(() => parseCv('\n\n   \n•\n---\n', INDEX, NOW)).not.toThrow();
  });
});

// ───────── PDF extraction ─────────

describe('PDF text extraction', () => {
  it('reads text line by line from a real PDF', async () => {
    const { text, pages } = await extractPdfText(makePdf(['Abebe Kebede', 'Work Experience', 'Senior Mechanic - Adama Auto Garage', '2018 - Present']));
    expect(pages).toBe(1);
    expect(text.split('\n')).toEqual(['Abebe Kebede', 'Work Experience', 'Senior Mechanic - Adama Auto Garage', '2018 - Present']);
  });

  it('survives special characters', async () => {
    const { text } = await extractPdfText(makePdf(['Skills (technical): welding \\ brakes, engines and more things']));
    expect(text).toContain('Skills (technical): welding');
  });

  it('explains image-only or empty PDFs instead of returning nothing', async () => {
    await expect(extractPdfText(makePdf([]))).rejects.toMatchObject({ status: 422, code: 'NO_TEXT' });
  });

  it('rejects files that are not PDFs or are corrupt', async () => {
    await expect(extractPdfText(Buffer.from('hello world'))).rejects.toMatchObject({ status: 422, code: 'UNREADABLE_PDF' });
    await expect(extractPdfText(Buffer.from('%PDF-1.4\nthis is not really a pdf at all, just junk bytes'))).rejects.toMatchObject({ status: 422, code: 'UNREADABLE_PDF' });
  });

  it('feeds the CV parser end to end', async () => {
    const pdf = makePdf(['Summary', 'Mechanic with engine repair skills.', 'Skills', 'Engine repair, Brake repair', 'Education', 'Diploma in Automotive Technology', 'Adama TVET College, 2011']);
    const { text } = await extractPdfText(pdf);
    const parsed = parseCv(text, INDEX, NOW);
    expect(parsed.skills.map((s) => s.name).sort()).toEqual(['Brake Systems', 'Engine Repair']);
    expect(parsed.education[0]).toMatchObject({ level: 'DIPLOMA', institution: 'Adama TVET College', year: 2011 });
  });
});
