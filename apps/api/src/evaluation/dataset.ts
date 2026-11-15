/**
 * EVALUATION BENCHMARK (synthetic, hand-labelled).
 *
 * WHAT THIS IS: 14 invented job postings and 45 invented worker profiles across the platform's categories and
 * several regions, with a relevance grade for every (job, worker) pair that is not 0.
 *
 * WHAT THIS IS NOT: real people, real postings or independent expert judgement. The grades below were written by
 * the project's developer, by reading each profile against each posting using the RUBRIC below, NOT by running the
 * scoring formula. Because one person made them, they carry that person's assumptions. docs/06-testing-and-evaluation.md
 * describes how to replace them with grades from two or more independent annotators (`npm run eval` writes
 * evaluation/annotation-template.csv for that).
 *
 * RUBRIC. Question: "Would a reasonable employer shortlist this person for this job today?"
 *   3 = Yes, clearly: has the core skills, enough experience, and can take the job where it is.
 *   2 = Probably: close fit with one gap (a missing minor skill, slightly less experience, a related rather than
 *       exact trade, or far away but willing to relocate with a strong profile).
 *   1 = Unlikely: related field or would need real training; or a strong profile that is unavailable (one grade lower
 *       than it would otherwise be).
 *   0 = No (not listed below).
 *   Availability: NOT_AVAILABLE lowers the grade by one. Another region without willingness to relocate lowers it by one.
 *   Sector requirements: a person who is KNOWN to lack a legally required condition (a heavy-vehicle licence for a truck
 *   job, a professional registration for a nursing job) is graded 0, whatever else they offer. Someone who has not
 *   answered is judged on the rest of the profile. NOTE: this rule is also implemented by the scorer, so the two
 *   sector-criteria jobs below test that the rule is applied consistently, not that the rule itself is right.
 *   Education: a missing certificate does NOT lower the grade when the person has strong practical skills and the
 *   years of experience (that is how trades hiring commonly works), but it does for regulated or degree jobs
 *   (nurse, teacher, accountant).
 */
import type { JobFeatures, WorkerFeatures } from '../modules/matching/types';

type Avail = WorkerFeatures['availability'];
export type LocKey = 'addis' | 'adama' | 'hawassa' | 'jimma' | 'bahirdar' | 'mekelle' | 'diredawa';
const LOC: Record<LocKey, string[]> = {
  addis: ['addis-ababa', 'addis-city'], adama: ['oromia', 'adama'], hawassa: ['sidama', 'hawassa'], jimma: ['oromia', 'jimma'],
  bahirdar: ['amhara', 'bahir-dar'], mekelle: ['tigray', 'mekelle'], diredawa: ['dire-dawa', 'dire-dawa-city'],
};
export const REGION_OF: Record<LocKey, string> = { addis: 'Addis Ababa', adama: 'Oromia', hawassa: 'Sidama', jimma: 'Oromia', bahirdar: 'Amhara', mekelle: 'Tigray', diredawa: 'Dire Dawa' };

export interface EvalWorker { features: WorkerFeatures; headline: string; bio: string; text: string; region: string; loc: LocKey }
export interface EvalJob { features: JobFeatures; title: string; description: string; text: string; region: string; category: string; grades: Record<string, number> }

const W = (
  id: string, loc: LocKey, headline: string, text: string, cat: string, years: number, edu: string[], certs: number,
  skills: [string, number][], avail: Avail = 'IMMEDIATELY', relocate = false,
): EvalWorker => ({
  headline, bio: text, text: `${headline}. ${text}`, loc, region: REGION_OF[loc],
  features: {
    id, categoryId: cat, yearsExperience: years, experiences: [], educationLevels: edu, certificationCount: certs,
    skills: skills.map(([skillId, proficiency]) => ({ skillId, name: skillId, proficiency })),
    availability: avail, availableFrom: null, lat: null, lng: null, maxTravelKm: null, willingToRelocate: relocate,
    locationPath: LOC[loc], preferredTypes: [], preferredWorkModes: [], expectedSalaryMin: null, expectedSalaryMax: null, embedding: null,
  },
});

export const workers: EvalWorker[] = [
  W('W01', 'addis', 'Experienced vehicle mechanic', 'Overhauls petrol and diesel engines, reads fault codes with a scanner, replaces brake pads and discs. Garage in Addis Ababa.', 'automotive', 6, ['VOCATIONAL_CERTIFICATE'], 1, [['engine-repair', 4], ['automotive-diagnostics', 3], ['brake-systems', 3]]),
  W('W02', 'adama', 'Self-taught garage mechanic', 'Fixes minibus and Isuzu engines, gearboxes and tyres. Learned on the job, no certificate. Ready to move to Addis.', 'automotive', 4, [], 0, [['engine-repair', 4], ['tire-service', 3]], 'IMMEDIATELY', true),
  W('W03', 'addis', 'Auto electrician', 'Vehicle electrical systems, wiring harness repair, battery and alternator faults, fault finding.', 'automotive', 5, ['DIPLOMA'], 1, [['auto-electrical', 4], ['automotive-diagnostics', 4]]),
  W('W04', 'adama', 'Welder and fabricator', 'Arc and MIG welding of steel doors, gates, trailers and truck bodies. Seven years in a metal workshop in Adama.', 'automotive', 7, ['VOCATIONAL_CERTIFICATE'], 1, [['welding', 5], ['panel-beating', 4]]),
  W('W05', 'addis', 'Welder', 'Makes gates and window frames with arc welding.', 'automotive', 2, ['PRIMARY'], 0, [['welding', 3]]),
  W('W06', 'addis', 'Panel beater', 'Repairs dents and body damage on cars, sprays and finishes panels, some welding.', 'automotive', 3, [], 0, [['panel-beating', 4], ['welding', 2]]),
  W('W07', 'hawassa', 'Mason with eight years on building sites', 'Lays blocks and bricks, plasters walls, ties reinforcement bars. Has led small crews.', 'construction', 8, [], 0, [['masonry', 5], ['plastering', 4], ['steel-fixing', 3]]),
  W('W08', 'hawassa', 'Plasterer and painter', 'Cement rendering inside and outside, interior painting.', 'construction', 3, ['PRIMARY'], 0, [['plastering', 4], ['painting-decorating', 3]]),
  W('W09', 'hawassa', 'Carpenter', 'Doors, windows, roof trusses and furniture from timber.', 'construction', 5, ['VOCATIONAL_CERTIFICATE'], 1, [['carpentry', 4]]),
  W('W10', 'addis', 'House and building electrician', 'Wiring of houses and small commercial buildings, distribution boards, repairs.', 'construction', 6, ['DIPLOMA'], 1, [['electrical-wiring', 5], ['plumbing', 2]]),
  W('W11', 'jimma', 'Electrician', 'Installs lighting and sockets, repairs faults in homes and shops in Jimma.', 'construction', 4, ['VOCATIONAL_CERTIFICATE'], 1, [['electrical-wiring', 4]]),
  W('W12', 'addis', 'Plumber', 'Water supply, drainage and sanitary installation in apartments.', 'construction', 4, ['VOCATIONAL_CERTIFICATE'], 1, [['plumbing', 4], ['electrical-wiring', 2]]),
  W('W13', 'addis', 'Site foreman and civil technician', 'Supervises building crews, reads drawings, schedules materials. Degree in construction technology.', 'construction', 10, ['BACHELOR'], 2, [['site-supervision', 5], ['masonry', 3], ['project-management', 3], ['autocad', 3]]),
  W('W14', 'bahirdar', 'Traditional Ethiopian cook', 'Prepares injera, doro wot, shiro and fasting dishes for restaurants in Bahir Dar.', 'hospitality', 5, [], 0, [['cooking', 4], ['traditional-cooking', 5]]),
  W('W15', 'addis', 'Hotel chef', 'Runs a hotel kitchen: Ethiopian and continental dishes, bakery items, menu costing. Willing to relocate.', 'hospitality', 8, ['DIPLOMA'], 2, [['cooking', 5], ['baking', 4], ['traditional-cooking', 3]], 'WITHIN_TWO_WEEKS', true),
  W('W16', 'bahirdar', 'Household cook', 'Cooks daily family meals and for events, including traditional dishes.', 'domestic', 3, [], 0, [['home-cooking', 4], ['traditional-cooking', 4]]),
  W('W17', 'addis', 'Barista', 'Makes espresso drinks and runs the traditional coffee ceremony, serves tables, friendly with guests.', 'hospitality', 3, [], 0, [['barista', 5], ['waiting-service', 4], ['customer-service', 3]]),
  W('W18', 'addis', 'Waitress', 'Serves tables in a busy restaurant, handles orders and bills.', 'hospitality', 1, ['SECONDARY'], 0, [['waiting-service', 3], ['customer-service', 3]]),
  W('W19', 'addis', 'Receptionist', 'Welcomes guests at a hotel front desk, answers phones, bookings, Microsoft Office.', 'hospitality', 4, ['DIPLOMA'], 1, [['front-desk', 4], ['customer-service', 4], ['ms-office', 4]]),
  W('W20', 'addis', 'Full-stack web developer', 'Builds web applications with JavaScript, Node and PostgreSQL. Computer science degree.', 'ict', 3, ['BACHELOR'], 2, [['web-development', 4], ['javascript', 4], ['database-admin', 3], ['python', 3]]),
  W('W21', 'addis', 'Self-taught web developer', 'Builds websites and small web apps in JavaScript. No degree, has a portfolio of client sites.', 'ict', 1, ['SECONDARY'], 1, [['web-development', 3], ['javascript', 4]]),
  W('W22', 'addis', 'Data analyst', 'Python, SQL and statistics for reports and forecasting. Not a web developer.', 'ict', 4, ['BACHELOR'], 1, [['python', 4], ['data-analysis', 4], ['database-admin', 4]]),
  W('W23', 'jimma', 'IT support technician', 'Fixes computers and printers, sets up small office networks, helps staff with Office.', 'ict', 3, ['DIPLOMA'], 1, [['it-support', 4], ['networking', 3], ['ms-office', 4]]),
  W('W24', 'addis', 'Network engineer', 'Designs and runs enterprise networks, firewalls and security. Willing to relocate.', 'ict', 5, ['BACHELOR'], 3, [['networking', 5], ['cybersecurity', 3], ['it-support', 3]], 'WITHIN_ONE_MONTH', true),
  W('W25', 'addis', 'Graphic designer', 'Logos, posters and social media graphics with Photoshop and Illustrator.', 'ict', 3, ['DIPLOMA'], 0, [['graphic-design', 4]]),
  W('W26', 'addis', 'Accountant', 'Keeps books, prepares financial statements and tax returns with Peachtree and Excel.', 'business', 5, ['BACHELOR'], 2, [['accounting', 5], ['ms-office', 4]]),
  W('W27', 'addis', 'Junior bookkeeper', 'Records daily transactions and reconciles accounts for a small trading company.', 'business', 2, ['DIPLOMA'], 0, [['accounting', 3], ['ms-office', 4]]),
  W('W28', 'addis', 'Office administrator', 'Secretary and clerk: filing, letters, schedules, Word and Excel.', 'business', 6, ['DIPLOMA'], 0, [['office-admin', 5], ['ms-office', 5]]),
  W('W29', 'mekelle', 'Nurse', 'Ward nursing, wound care, medication rounds and patient monitoring in Mekelle.', 'healthcare', 4, ['DIPLOMA'], 2, [['nursing', 4], ['first-aid', 4]]),
  W('W30', 'addis', 'Senior nurse', 'Nurse with a bachelor degree, also trained in midwifery. Willing to relocate.', 'healthcare', 6, ['BACHELOR'], 3, [['nursing', 5], ['first-aid', 4], ['midwifery', 3]], 'WITHIN_ONE_MONTH', true),
  W('W31', 'mekelle', 'Health extension worker', 'Community health education, vaccination support and first aid in villages.', 'healthcare', 3, ['VOCATIONAL_CERTIFICATE'], 1, [['community-health', 4], ['first-aid', 4]]),
  W('W32', 'jimma', 'Primary school teacher', 'Teaches grades 1 to 4 in Jimma, holds a teaching diploma, also gives private lessons.', 'education', 6, ['DIPLOMA'], 1, [['teaching-primary', 5], ['tutoring', 3]]),
  W('W33', 'jimma', 'Private tutor', 'English and mathematics lessons for secondary students. Bachelor of arts.', 'education', 2, ['BACHELOR'], 0, [['tutoring', 4], ['english-teaching', 4]]),
  W('W34', 'diredawa', 'Long-distance truck driver', 'Drives heavy trucks on the Addis to Djibouti corridor, holds a heavy vehicle licence.', 'transport', 9, ['SECONDARY'], 1, [['driving-heavy', 5]]),
  W('W35', 'diredawa', 'Taxi driver', 'Drives a car taxi in the city, knows the roads well.', 'transport', 5, [], 0, [['driving-light', 4]]),
  W('W36', 'addis', 'Truck driver', 'Heavy vehicle driver with a clean record, local and regional deliveries.', 'transport', 6, ['SECONDARY'], 1, [['driving-heavy', 4]]),
  W('W37', 'jimma', 'Coffee and crop farmer', 'Grows and harvests coffee and maize, manages small irrigation, dries and processes coffee.', 'agriculture', 10, [], 0, [['crop-production', 5], ['harvesting', 4], ['irrigation', 3], ['coffee-processing', 4]]),
  W('W38', 'jimma', 'Farm labourer', 'Helps with harvesting and carrying produce on farms in the Jimma area.', 'agriculture', 1, ['PRIMARY'], 0, [['harvesting', 3], ['manual-loading', 3]]),
  W('W39', 'hawassa', 'Shop assistant', 'Sells goods, handles the cash register and customers in a Hawassa shop.', 'sales', 3, ['SECONDARY'], 0, [['retail-sales', 4], ['cashiering', 4], ['customer-service', 4]]),
  W('W40', 'addis', 'Cashier', 'Cash handling at a supermarket and at a bank branch counter. Willing to relocate.', 'sales', 2, ['DIPLOMA'], 0, [['cashiering', 4], ['banking', 3]], 'IMMEDIATELY', true),
  W('W41', 'addis', 'Daily labourer', 'Carries loads, digs, cleans compounds. Any physical work.', 'general-labor', 3, [], 0, [['manual-loading', 4], ['digging-earthwork', 3], ['cleaning-general', 3]]),
  W('W42', 'addis', 'Night security guard', 'Guards compounds at night, controls the gate.', 'security', 4, ['SECONDARY'], 0, [['guard-duty', 4], ['access-control', 3]]),
  W('W43', 'addis', 'Master mechanic (currently employed)', 'Fifteen years repairing engines and fault finding on all vehicle makes, brake systems, trains apprentices. Not looking right now.', 'automotive', 15, ['VOCATIONAL_CERTIFICATE'], 2, [['engine-repair', 5], ['automotive-diagnostics', 5], ['brake-systems', 4]], 'NOT_AVAILABLE'),
  W('W44', 'addis', 'Mechanical engineering graduate', 'Recent graduate interested in the automotive sector. No work history yet and no skills listed.', 'automotive', 0, ['BACHELOR'], 0, []),
  W('W45', 'addis', 'Computer science graduate', 'Recent graduate, studied programming and databases, looking for a first job. No skills listed yet.', 'ict', 0, ['BACHELOR'], 0, []),
];

type Req = [string, 'REQUIRED' | 'PREFERRED'];
const J = (
  id: string, loc: LocKey, cat: string, title: string, text: string, skills: Req[], minYears: number | null, edu: string | null,
  grades: Record<string, number>, mode: 'ON_SITE' | 'HYBRID' = 'ON_SITE',
): EvalJob => ({
  title, description: text, text: `${title}. ${text}`, region: REGION_OF[loc], category: cat, grades,
  features: {
    id, categoryId: cat, employmentType: 'FULL_TIME', workMode: mode, minExperienceYears: minYears, requiredEducationLevel: edu,
    salaryMin: null, salaryMax: null, startDate: null, lat: null, lng: null, locationPath: LOC[loc],
    skills: skills.map(([skillId, importance]) => ({ skillId, name: skillId, importance, minProficiency: null })), embedding: null,
  },
});

export const jobs: EvalJob[] = [
  J('J01', 'addis', 'automotive', 'Auto mechanic', 'Garage in Addis Ababa needs a mechanic to repair engines and find faults on cars and minibuses. Brake work is a plus. Three years of experience and a vocational certificate.', [['engine-repair', 'REQUIRED'], ['automotive-diagnostics', 'REQUIRED'], ['brake-systems', 'PREFERRED']], 3, 'VOCATIONAL_CERTIFICATE', { W01: 3, W43: 2, W02: 2, W03: 1, W06: 1, W44: 1 }),
  J('J02', 'adama', 'automotive', 'Welder', 'Metal workshop in Adama needs a welder for gates, doors and trailers. Panel work is a plus. Two years of experience.', [['welding', 'REQUIRED'], ['panel-beating', 'PREFERRED']], 2, null, { W04: 3, W05: 2, W06: 1 }),
  J('J03', 'hawassa', 'construction', 'Mason', 'Building contractor in Hawassa needs a mason to lay blocks and bricks. Plastering and reinforcement work are a plus. Two years of experience.', [['masonry', 'REQUIRED'], ['plastering', 'PREFERRED'], ['steel-fixing', 'PREFERRED']], 2, null, { W07: 3, W08: 2, W09: 1, W13: 1, W41: 1 }),
  J('J04', 'addis', 'construction', 'Electrician', 'Construction company in Addis Ababa needs an electrician for building wiring and distribution boards. Three years of experience, vocational certificate.', [['electrical-wiring', 'REQUIRED']], 3, 'VOCATIONAL_CERTIFICATE', { W10: 3, W03: 2, W11: 2, W12: 1 }),
  J('J05', 'bahirdar', 'hospitality', 'Hotel cook', 'Hotel in Bahir Dar needs a cook for Ethiopian dishes such as injera, wot and shiro. Baking is a plus. Two years of experience.', [['cooking', 'REQUIRED'], ['traditional-cooking', 'REQUIRED'], ['baking', 'PREFERRED']], 2, null, { W14: 3, W15: 3, W16: 2 }),
  J('J06', 'addis', 'hospitality', 'Waiter and barista', 'Cafe in Addis Ababa needs staff to serve tables and make coffee, friendly with customers. One year of experience.', [['waiting-service', 'REQUIRED'], ['barista', 'REQUIRED'], ['customer-service', 'PREFERRED']], 1, null, { W17: 3, W18: 2, W19: 1, W40: 1 }),
  J('J07', 'addis', 'ict', 'Web developer', 'Software company in Addis Ababa needs a web developer for JavaScript applications with a database. Degree in computer science, two years of experience. Hybrid work.', [['web-development', 'REQUIRED'], ['javascript', 'REQUIRED'], ['database-admin', 'PREFERRED']], 2, 'BACHELOR', { W20: 3, W21: 2, W22: 1, W45: 1 }, 'HYBRID'),
  J('J08', 'jimma', 'ict', 'IT support officer', 'University office in Jimma needs an IT support officer to repair computers and look after the office network and Microsoft Office. Diploma, one year of experience.', [['it-support', 'REQUIRED'], ['networking', 'PREFERRED'], ['ms-office', 'PREFERRED']], 1, 'DIPLOMA', { W23: 3, W24: 2, W45: 1 }),
  J('J09', 'addis', 'business', 'Accountant', 'Trading company in Addis Ababa needs an accountant to keep books and prepare statements with Excel. Bachelor degree in accounting and three years of experience.', [['accounting', 'REQUIRED'], ['ms-office', 'REQUIRED']], 3, 'BACHELOR', { W26: 3, W27: 2, W28: 1, W40: 1, W22: 1 }),
  J('J10', 'mekelle', 'healthcare', 'Nurse', 'Clinic in Mekelle needs a nurse for ward care and first aid. Nursing diploma and two years of experience.', [['nursing', 'REQUIRED'], ['first-aid', 'PREFERRED']], 2, 'DIPLOMA', { W29: 3, W30: 3 }),
  J('J11', 'diredawa', 'transport', 'Truck driver', 'Logistics company in Dire Dawa needs a heavy truck driver with a valid licence. Three years of experience.', [['driving-heavy', 'REQUIRED']], 3, null, { W34: 3, W36: 2 }),
  J('J12', 'jimma', 'education', 'Primary school teacher', 'Private school in Jimma needs a primary teacher for grades 1 to 4. Teaching diploma, two years of experience.', [['teaching-primary', 'REQUIRED']], 2, 'DIPLOMA', { W32: 3, W33: 1 }),
  J('J13', 'jimma', 'agriculture', 'Crop farm worker', 'Coffee and maize farm near Jimma needs a worker for planting, harvesting and irrigation. One year of experience.', [['crop-production', 'REQUIRED'], ['harvesting', 'PREFERRED'], ['irrigation', 'PREFERRED']], 1, null, { W37: 3, W38: 2 }),
  J('J14', 'hawassa', 'sales', 'Shop assistant', 'Shop in Hawassa needs a sales assistant to sell goods, use the cash register and serve customers. One year of experience.', [['retail-sales', 'REQUIRED'], ['cashiering', 'REQUIRED'], ['customer-service', 'PREFERRED']], 1, null, { W39: 3, W40: 2, W18: 1 }),
];

// ───────── groups used for sliced and fairness reporting ─────────
export type EduBand = 'no formal education recorded' | 'primary or secondary' | 'vocational certificate' | 'diploma or higher';
const RANK: Record<string, number> = { NONE: 0, PRIMARY: 1, SECONDARY: 2, VOCATIONAL_CERTIFICATE: 3, DIPLOMA: 4, BACHELOR: 5, MASTER: 6, DOCTORATE: 7 };
export const eduBand = (w: WorkerFeatures): EduBand => {
  const rank = Math.max(-1, ...w.educationLevels.map((l) => RANK[l] ?? 0));
  if (rank <= 0) return 'no formal education recorded';
  if (rank <= 2) return 'primary or secondary';
  return rank === 3 ? 'vocational certificate' : 'diploma or higher';
};
export type ExpBand = '0-2 years' | '3-5 years' | '6+ years';
export const expBand = (w: WorkerFeatures): ExpBand => (w.yearsExperience <= 2 ? '0-2 years' : w.yearsExperience <= 5 ? '3-5 years' : '6+ years');

// ───────── sector criteria (Phase 15) on two jobs and the people who answered ─────────
const mustHave = (id: string, key: string, label: string, type: 'BOOLEAN' | 'MULTI_CHOICE', requirement: unknown) =>
  ({ id, key, label, type, importance: 'MUST_HAVE' as const, requirement });
const onJob = (jobId: string, criteria: NonNullable<JobFeatures['criteria']>) => { jobs.find((j) => j.features.id === jobId)!.features.criteria = criteria; };
const onWorker = (workerId: string, answers: NonNullable<WorkerFeatures['criteria']>) => { workers.find((w) => w.features.id === workerId)!.features.criteria = answers; };
const said = (value: unknown) => ({ value, verified: false });

// Truck driver (J11): must hold a heavy-truck licence. Heavy drivers say so; the taxi driver says light vehicles only.
onJob('J11', [mustHave('c-vehicle-types', 'vehicle_types', 'Vehicle types I am licensed to drive', 'MULTI_CHOICE', { allOf: ['truck'] })]);
onWorker('W34', { 'c-vehicle-types': said(['truck', 'trailer']) });
onWorker('W36', { 'c-vehicle-types': said(['truck']) });
onWorker('W35', { 'c-vehicle-types': said(['light']) });

// Nurse (J10): must hold the professional registration. The two nurses have it; the health extension worker does not.
onJob('J10', [mustHave('c-registration', 'registration', 'Professional registration or licence from the regulator', 'BOOLEAN', { equals: true })]);
onWorker('W29', { 'c-registration': said(true) });
onWorker('W30', { 'c-registration': said(true) });
onWorker('W31', { 'c-registration': said(false) });
