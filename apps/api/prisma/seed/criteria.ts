/**
 * Starting set of sector criteria. These are REASONED DEFAULTS written by the developer, not reviewed by sector
 * experts or regulators: administrators can edit, hide and add criteria in the admin console, and sector experts
 * should review this list before launch. Amharic and Afaan Oromoo labels are intentionally left empty (the interface
 * falls back to English) rather than invented; add them in the console with a native speaker.
 *
 * Rules for what belongs here: a criterion must be JOB-RELATED (something that decides whether a person can do the
 * work). Gender, age, ethnicity, religion and marital status are never criteria (see modules/criteria/discrimination.ts).
 */
export interface SeedOption { value: string; labelEn: string }
export interface SeedCriterion {
  category: string | null; // category slug, null = every sector
  key: string;
  type: 'BOOLEAN' | 'NUMBER' | 'CHOICE' | 'MULTI_CHOICE';
  labelEn: string;
  helpEn?: string;
  options?: SeedOption[];
  unit?: string;
  min?: number;
  max?: number;
  /** false = cannot be a hard requirement (only a preference). */
  mustHaveAllowed?: boolean;
  /** true = a document can verify it (licence, registration, certificate). */
  evidence?: boolean;
}

const opts = (...pairs: [string, string][]): SeedOption[] => pairs.map(([value, labelEn]) => ({ value, labelEn }));

// Short builders for the long list below.
type Extra = { help?: string; evidence?: boolean; must?: boolean };
const yn = (category: string | null, key: string, labelEn: string, x: Extra = {}): SeedCriterion =>
  ({ category, key, type: 'BOOLEAN', labelEn, helpEn: x.help, evidence: x.evidence, mustHaveAllowed: x.must });
const multi = (category: string | null, key: string, labelEn: string, o: [string, string][], x: Extra = {}): SeedCriterion =>
  ({ category, key, type: 'MULTI_CHOICE', labelEn, options: opts(...o), helpEn: x.help, evidence: x.evidence, mustHaveAllowed: x.must });
const choice = (category: string | null, key: string, labelEn: string, o: [string, string][], x: Extra = {}): SeedCriterion =>
  ({ category, key, type: 'CHOICE', labelEn, options: opts(...o), helpEn: x.help, evidence: x.evidence, mustHaveAllowed: x.must });
const num = (category: string | null, key: string, labelEn: string, unit: string, min: number, max: number, x: Extra = {}): SeedCriterion =>
  ({ category, key, type: 'NUMBER', labelEn, unit, min, max, helpEn: x.help, evidence: x.evidence, mustHaveAllowed: x.must });

const LANGS: [string, string][] = [['en', 'English'], ['am', 'Amharic'], ['om', 'Afaan Oromoo'], ['ti', 'Tigrinya'], ['so', 'Somali'], ['aa', 'Afar'], ['sid', 'Sidaamu Afoo'], ['wal', 'Wolaytta'], ['ar', 'Arabic'], ['fr', 'French']];

export const criteria: SeedCriterion[] = [
  // ── every sector
  { category: null, key: 'shifts', type: 'MULTI_CHOICE', labelEn: 'Shifts I can work', options: opts(['day', 'Day'], ['evening', 'Evening'], ['night', 'Night'], ['weekend', 'Weekends']) },
  { category: null, key: 'references', type: 'BOOLEAN', labelEn: 'Can provide a reference from a previous employer' },

  // ── transport
  { category: 'transport', key: 'vehicle_types', type: 'MULTI_CHOICE', labelEn: 'Vehicle types I am licensed to drive', evidence: true,
    options: opts(['motorcycle', 'Motorcycle'], ['light', 'Light vehicle / taxi'], ['minibus', 'Minibus or bus'], ['truck', 'Heavy truck'], ['trailer', 'Truck with trailer'], ['machinery', 'Machinery / loader']) },
  { category: 'transport', key: 'licence_years', type: 'NUMBER', labelEn: 'Years holding a driving licence', unit: 'years', min: 0, max: 60, evidence: true },
  { category: 'transport', key: 'clean_record', type: 'BOOLEAN', labelEn: 'No serious traffic offences in the last 3 years', evidence: true },
  { category: 'transport', key: 'long_distance', type: 'BOOLEAN', labelEn: 'Willing to travel and sleep away from home', mustHaveAllowed: true },

  // ── automotive
  { category: 'automotive', key: 'trade_certificate', type: 'BOOLEAN', labelEn: 'Trade or competence certificate (for example TVET)', evidence: true },
  { category: 'automotive', key: 'own_tools', type: 'BOOLEAN', labelEn: 'Has own tools' },
  { category: 'automotive', key: 'vehicle_systems', type: 'MULTI_CHOICE', labelEn: 'Vehicle types I can work on', options: opts(['petrol', 'Petrol cars'], ['diesel', 'Diesel engines'], ['heavy', 'Trucks and buses'], ['motorcycle', 'Motorcycles'], ['electric', 'Hybrid or electric']) },

  // ── healthcare
  { category: 'healthcare', key: 'registration', type: 'BOOLEAN', labelEn: 'Professional registration or licence from the regulator', helpEn: 'Required by law for many clinical roles.', evidence: true },
  { category: 'healthcare', key: 'specialty', type: 'MULTI_CHOICE', labelEn: 'Area of care',
    options: opts(['general', 'General ward'], ['maternity', 'Maternity'], ['emergency', 'Emergency'], ['paediatrics', 'Children'], ['surgery', 'Surgery / theatre'], ['laboratory', 'Laboratory'], ['pharmacy', 'Pharmacy'], ['community', 'Community health']) },
  { category: 'healthcare', key: 'immunised', type: 'BOOLEAN', labelEn: 'Vaccinations up to date (as required for clinical work)', evidence: true },

  // ── ICT
  { category: 'ict', key: 'tech_stack', type: 'MULTI_CHOICE', labelEn: 'Technologies',
    options: opts(['javascript', 'JavaScript / TypeScript'], ['python', 'Python'], ['java', 'Java / Kotlin'], ['php', 'PHP'], ['dotnet', '.NET / C#'], ['mobile', 'Mobile apps'], ['databases', 'Databases / SQL'], ['networking', 'Networks'], ['cloud', 'Cloud / DevOps']) },
  { category: 'ict', key: 'portfolio', type: 'BOOLEAN', labelEn: 'Can show previous work (portfolio, GitHub or similar)' },
  { category: 'ict', key: 'english_level', type: 'CHOICE', labelEn: 'English level for work', options: opts(['basic', 'Basic'], ['good', 'Good'], ['fluent', 'Fluent']) },
  { category: 'ict', key: 'remote_ok', type: 'BOOLEAN', labelEn: 'Can work remotely with a reliable connection' },

  // ── construction
  { category: 'construction', key: 'trade_certificate', type: 'BOOLEAN', labelEn: 'Trade or competence certificate (for example TVET)', evidence: true },
  { category: 'construction', key: 'site_safety', type: 'BOOLEAN', labelEn: 'Site safety training', evidence: true },
  { category: 'construction', key: 'own_tools', type: 'BOOLEAN', labelEn: 'Has own tools' },
  { category: 'construction', key: 'crew_size', type: 'NUMBER', labelEn: 'Largest crew I have led', unit: 'people', min: 0, max: 500, mustHaveAllowed: false },
  { category: 'construction', key: 'work_at_height', type: 'BOOLEAN', labelEn: 'Comfortable working at height' },

  // ── hospitality
  { category: 'hospitality', key: 'food_hygiene', type: 'BOOLEAN', labelEn: 'Food hygiene or health certificate', evidence: true },
  { category: 'hospitality', key: 'live_in', type: 'BOOLEAN', labelEn: 'Willing to live at the workplace' },
  { category: 'hospitality', key: 'cuisine', type: 'MULTI_CHOICE', labelEn: 'Food and drink I can prepare', options: opts(['traditional', 'Traditional Ethiopian'], ['continental', 'Continental'], ['bakery', 'Bakery'], ['coffee', 'Coffee and coffee ceremony']) },

  // ── security
  { category: 'security', key: 'guard_training', type: 'BOOLEAN', labelEn: 'Security guard training certificate', evidence: true },
  { category: 'security', key: 'good_conduct', type: 'BOOLEAN', labelEn: 'Can provide a police clearance / good-conduct letter', evidence: true },
  { category: 'security', key: 'full_shift_standing', type: 'BOOLEAN', labelEn: 'Able to stand and patrol for a full shift' },

  // ── agriculture
  { category: 'agriculture', key: 'season', type: 'MULTI_CHOICE', labelEn: 'Seasons I can work', options: opts(['planting', 'Planting'], ['growing', 'Crop care'], ['harvest', 'Harvest'], ['year_round', 'Year-round']) },
  { category: 'agriculture', key: 'own_tools', type: 'BOOLEAN', labelEn: 'Has own farm tools' },
  { category: 'agriculture', key: 'farm_housing', type: 'BOOLEAN', labelEn: 'Willing to live in on-farm housing' },

  // ── education
  { category: 'education', key: 'teaching_licence', type: 'BOOLEAN', labelEn: 'Teaching licence or teaching qualification', evidence: true },
  { category: 'education', key: 'grade_levels', type: 'MULTI_CHOICE', labelEn: 'Levels I can teach', options: opts(['kg', 'Kindergarten'], ['g1_4', 'Grades 1 to 4'], ['g5_8', 'Grades 5 to 8'], ['g9_12', 'Grades 9 to 12'], ['adult', 'Adult / vocational']) },

  // ── business
  { category: 'business', key: 'accounting_software', type: 'MULTI_CHOICE', labelEn: 'Software I use', options: opts(['peachtree', 'Peachtree / Sage'], ['quickbooks', 'QuickBooks'], ['excel', 'Excel'], ['word', 'Word and email']) },
  { category: 'business', key: 'professional_certificate', type: 'BOOLEAN', labelEn: 'Professional certificate (for example accounting, HR, procurement)', evidence: true },

  // ── sales
  { category: 'sales', key: 'field_driving', type: 'BOOLEAN', labelEn: 'Can drive or ride for field visits', evidence: true },
  { category: 'sales', key: 'languages_customers', type: 'MULTI_CHOICE', labelEn: 'Languages I can serve customers in', options: opts(['am', 'Amharic'], ['om', 'Afaan Oromoo'], ['en', 'English'], ['ti', 'Tigrinya'], ['so', 'Somali'], ['ar', 'Arabic']) },

  // ── manufacturing
  { category: 'manufacturing', key: 'machine_certificate', type: 'BOOLEAN', labelEn: 'Machine operation certificate', evidence: true },
  { category: 'manufacturing', key: 'safety_training', type: 'BOOLEAN', labelEn: 'Workplace safety training', evidence: true },

  // ── domestic
  { category: 'domestic', key: 'live_in', type: 'BOOLEAN', labelEn: 'Willing to live in the household' },
  { category: 'domestic', key: 'child_experience', type: 'BOOLEAN', labelEn: 'Experience caring for young children' },

  // ── general labour
  { category: 'general-labor', key: 'heavy_lifting', type: 'BOOLEAN', labelEn: 'Able to lift and carry heavy loads (20 kg or more)', helpEn: 'A work requirement about the task, not a judgement about a person.' },
  // ═════════ more criteria (added in a second pass; sector experts should review all of them) ═════════

  // ── every sector
  yn(null, 'own_transport', 'Has own transport to reach the workplace'),
  yn(null, 'valid_id', 'Can provide a valid ID for employment paperwork', { evidence: true }),
  yn(null, 'overtime', 'Can work overtime when needed'),
  yn(null, 'day_trips', 'Can travel for work during the day'),

  // ── transport and logistics
  multi('transport', 'cargo_types', 'Cargo I have carried', [['general', 'General goods'], ['perishable', 'Fresh or perishable food'], ['fuel', 'Fuel or chemicals'], ['livestock', 'Livestock'], ['construction', 'Construction materials'], ['containers', 'Containers'], ['passengers', 'Passengers']]),
  yn('transport', 'hazmat_training', 'Training for carrying fuel or dangerous goods', { evidence: true }),
  yn('transport', 'defensive_driving', 'Defensive or safe-driving training', { evidence: true }),
  yn('transport', 'passenger_permit', 'Permit to carry passengers for hire', { evidence: true }),
  yn('transport', 'vehicle_checks', 'Can do daily vehicle checks and basic repairs'),
  yn('transport', 'gps_apps', 'Comfortable with GPS and delivery apps'),
  yn('transport', 'own_motorbike', 'Owns a motorbike (for deliveries)'),
  yn('transport', 'forklift_certificate', 'Forklift or loader operator certificate', { evidence: true }),
  yn('transport', 'stock_software', 'Has used stock-management software'),
  yn('transport', 'cold_chain', 'Experience with cold-chain or temperature-controlled goods'),

  // ── automotive and mechanics
  multi('automotive', 'specialisms', 'Repair areas', [['engine', 'Engine'], ['gearbox', 'Gearbox and clutch'], ['brakes', 'Brakes and suspension'], ['electrical', 'Electrical and electronics'], ['aircon', 'Air-conditioning'], ['body', 'Body and paint'], ['tyres', 'Tyres and alignment'], ['diagnostics', 'Computer diagnostics']]),
  multi('automotive', 'vehicle_brands', 'Vehicle makes I have worked on', [['toyota', 'Toyota'], ['isuzu', 'Isuzu'], ['hyundai', 'Hyundai / Kia'], ['suzuki', 'Suzuki'], ['chinese', 'Chinese makes'], ['european', 'European makes'], ['heavy', 'Scania / Volvo / Iveco / Mercedes trucks'], ['motorcycle', 'Motorcycles and three-wheelers']]),
  yn('automotive', 'diagnostic_scanner', 'Experienced with diagnostic scanners'),
  choice('automotive', 'workshop_role', 'Level of role I have held', [['helper', 'Helper or apprentice'], ['mechanic', 'Mechanic'], ['senior', 'Senior mechanic'], ['supervisor', 'Workshop supervisor']]),
  yn('automotive', 'welding_ability', 'Can do basic welding repairs'),
  yn('automotive', 'estimate_costs', 'Can inspect a vehicle and estimate repair costs'),

  // ── healthcare
  choice('healthcare', 'professional_role', 'Professional role', [['nurse_dip', 'Nurse (diploma)'], ['nurse_deg', 'Nurse (degree)'], ['midwife', 'Midwife'], ['health_officer', 'Health officer'], ['pharmacy', 'Pharmacy professional'], ['lab', 'Laboratory professional'], ['doctor', 'Doctor'], ['health_ext', 'Health extension worker'], ['assistant', 'Clinical assistant']]),
  num('healthcare', 'clinical_years', 'Years of clinical experience', 'years', 0, 60),
  yn('healthcare', 'infection_control', 'Infection prevention and control training', { evidence: true }),
  yn('healthcare', 'life_support', 'Basic life support or resuscitation training', { evidence: true }),
  multi('healthcare', 'facility_types', 'Places I have worked', [['hospital', 'Hospital'], ['health_centre', 'Health centre'], ['clinic', 'Private clinic'], ['home_care', 'Home care'], ['outreach', 'Community outreach'], ['emergency_unit', 'Emergency unit'], ['ngo_clinic', 'NGO or mobile clinic']]),
  yn('healthcare', 'rural_posting', 'Willing to work in rural or remote areas'),
  yn('healthcare', 'records_systems', 'Has used patient-records or health-information systems'),
  yn('healthcare', 'cold_chain_vaccines', 'Experience with vaccine storage and cold chain'),

  // ── ICT
  choice('ict', 'role_level', 'Level of role', [['junior', 'Junior'], ['mid', 'Mid-level'], ['senior', 'Senior'], ['lead', 'Team lead']]),
  multi('ict', 'frameworks', 'Tools and frameworks', [['react', 'React'], ['node', 'Node.js'], ['django', 'Django / Flask'], ['laravel', 'Laravel / PHP'], ['flutter', 'Flutter'], ['android', 'Android (native)'], ['wordpress', 'WordPress'], ['dotnet', '.NET']]),
  multi('ict', 'data_tools', 'Data tools', [['excel', 'Excel'], ['sql', 'SQL'], ['powerbi', 'Power BI / Tableau'], ['python', 'Python'], ['odk', 'KoBo / ODK']]),
  yn('ict', 'vendor_certificate', 'Vendor or professional IT certificate (network, cloud, security)', { evidence: true }),
  yn('ict', 'on_call', 'Available for on-call or out-of-hours support'),
  yn('ict', 'hardware_repair', 'Can repair computers, printers and phones'),
  yn('ict', 'client_facing', 'Comfortable working directly with clients'),
  yn('ict', 'agile_teams', 'Has worked in an agile or sprint-based team'),
  yn('ict', 'security_practices', 'Knows secure-coding or information-security practices'),

  // ── construction
  multi('construction', 'trades', 'Trades I can do', [['masonry', 'Masonry'], ['carpentry', 'Carpentry'], ['plumbing', 'Plumbing'], ['electrical', 'Electrical'], ['tiling', 'Tiling'], ['painting', 'Painting'], ['steel', 'Steel fixing'], ['scaffolding', 'Scaffolding'], ['roofing', 'Roofing'], ['plastering', 'Plastering']]),
  yn('construction', 'read_drawings', 'Can read building drawings'),
  multi('construction', 'equipment', 'Equipment I can operate', [['excavator', 'Excavator'], ['loader', 'Loader'], ['mixer', 'Concrete mixer'], ['crane', 'Crane'], ['dozer', 'Bulldozer'], ['grader', 'Grader'], ['roller', 'Road roller']]),
  yn('construction', 'equipment_licence', 'Licence or certificate for operating heavy equipment', { evidence: true }),
  yn('construction', 'remote_sites', 'Willing to work at remote or changing sites'),
  yn('construction', 'electrical_licence', 'Electrical installer or contractor licence', { evidence: true }),
  yn('construction', 'measure_setout', 'Can measure and set out work on site'),

  // ── hospitality
  multi('hospitality', 'service_style', 'Service settings I have worked in', [['restaurant', 'Restaurant'], ['cafe', 'Cafe or coffee house'], ['bar', 'Bar'], ['hotel', 'Hotel'], ['banquet', 'Banquets and events'], ['catering', 'Catering'], ['fast_food', 'Fast food']]),
  multi('hospitality', 'guest_languages', 'Languages I can serve guests in', LANGS.slice(0, 5).concat([['ar', 'Arabic'], ['fr', 'French'], ['it', 'Italian'], ['zh', 'Chinese']])),
  choice('hospitality', 'kitchen_role', 'Kitchen role I have held', [['helper', 'Kitchen helper'], ['commis', 'Assistant cook'], ['cook', 'Cook'], ['section', 'Section chef'], ['head', 'Head chef']]),
  yn('hospitality', 'barista_certificate', 'Barista training certificate', { evidence: true }),
  yn('hospitality', 'allergen_knowledge', 'Knows food allergens and safe handling'),
  yn('hospitality', 'pos_experience', 'Has used point-of-sale and ordering systems'),
  yn('hospitality', 'cost_control', 'Experience with menu costing or stock control'),

  // ── security
  multi('security', 'guard_type', 'Types of security work I have done', [['static', 'Static guard'], ['patrol', 'Patrol'], ['event', 'Events'], ['personal', 'Personal protection'], ['retail', 'Retail and loss prevention'], ['control_room', 'CCTV control room'], ['escort', 'Cash or goods escort']]),
  yn('security', 'first_aid_certificate', 'First-aid certificate', { evidence: true }),
  yn('security', 'fire_safety', 'Fire-safety training', { evidence: true }),
  yn('security', 'firearm_licence', 'Licensed to carry a firearm (only where the employer requires it)', { evidence: true, help: 'Only relevant where the law and the employer require armed staff.' }),
  yn('security', 'radio_procedures', 'Experienced with radio communication and reporting'),
  yn('security', 'incident_reports', 'Can write clear incident reports'),
  yn('security', 'alarm_systems', 'Has worked with alarm, CCTV or access-control systems'),
  yn('security', 'dog_handling', 'Dog-handling experience'),
  yn('security', 'conflict_training', 'Conflict de-escalation training', { evidence: true }),

  // ── agriculture
  multi('agriculture', 'crops', 'Crops I have worked with', [['coffee', 'Coffee'], ['teff', 'Teff'], ['cereals', 'Maize, wheat, barley'], ['vegetables', 'Vegetables'], ['fruit', 'Fruit'], ['flowers', 'Cut flowers'], ['sugarcane', 'Sugar cane'], ['spices', 'Spices'], ['enset', 'Enset'], ['pulses', 'Pulses and oilseeds']]),
  multi('agriculture', 'livestock_types', 'Animals I have cared for', [['cattle', 'Cattle'], ['dairy', 'Dairy cows'], ['small_stock', 'Sheep and goats'], ['poultry', 'Poultry'], ['bees', 'Bees'], ['fish', 'Fish'], ['camels', 'Camels']]),
  multi('agriculture', 'farm_machines', 'Machines I can operate', [['tractor', 'Tractor'], ['pump', 'Irrigation pump'], ['harvester', 'Harvester'], ['sprayer', 'Sprayer'], ['thresher', 'Thresher']]),
  yn('agriculture', 'pesticide_training', 'Training in safe pesticide use', { evidence: true }),
  yn('agriculture', 'greenhouse', 'Greenhouse or nursery experience'),
  yn('agriculture', 'animal_health', 'Can give basic animal-health care and vaccination support'),
  yn('agriculture', 'cooperative', 'Has worked in a cooperative or outgrower scheme'),
  yn('agriculture', 'quality_grading', 'Can grade and sort produce to quality standards'),

  // ── education
  multi('education', 'subjects', 'Subjects I can teach', [['math', 'Mathematics'], ['physics', 'Physics'], ['chemistry', 'Chemistry'], ['biology', 'Biology'], ['english', 'English'], ['amharic', 'Amharic'], ['afaan_oromoo', 'Afaan Oromoo'], ['social', 'Social studies'], ['civics', 'Civics'], ['ict', 'ICT'], ['arts_pe', 'Arts and physical education'], ['early', 'Early childhood learning']]),
  multi('education', 'curriculum', 'Curricula I have taught', [['national', 'Ethiopian national curriculum'], ['cambridge', 'Cambridge / IGCSE'], ['ib', 'International Baccalaureate'], ['montessori', 'Montessori'], ['tvet', 'TVET / vocational'], ['adult', 'Adult literacy']]),
  multi('education', 'teaching_languages', 'Languages I can teach in', LANGS.slice(0, 7)),
  num('education', 'teaching_years', 'Years of teaching experience', 'years', 0, 60),
  num('education', 'largest_class', 'Largest class I have taught', 'students', 1, 300, { must: false }),
  yn('education', 'special_needs', 'Experience with learners who have special learning needs'),
  yn('education', 'online_teaching', 'Can teach online'),
  multi('education', 'school_type', 'School types I have worked in', [['government', 'Government school'], ['private', 'Private school'], ['international', 'International school'], ['community', 'Community or NGO school'], ['university', 'College or university']]),
  yn('education', 'child_safeguarding', 'Child-safeguarding training', { evidence: true }),
  yn('education', 'exam_preparation', 'Experience preparing students for national exams'),
  yn('education', 'lesson_planning', 'Prepares lesson plans and continuous assessment'),

  // ── business, finance and administration
  choice('business', 'accounting_level', 'Accounting qualification level', [['none', 'No formal qualification'], ['level_iv', 'TVET level IV'], ['diploma', 'Diploma'], ['degree', 'Degree'], ['professional', 'Professional (e.g. ACCA, CPA)']]),
  yn('business', 'tax_filing', 'Experience with VAT and income-tax filing'),
  yn('business', 'audit_experience', 'Audit experience'),
  multi('business', 'hr_functions', 'HR areas I have worked in', [['recruitment', 'Recruitment'], ['payroll', 'Payroll'], ['training', 'Training'], ['relations', 'Employee relations'], ['labour_law', 'Labour-law compliance'], ['records', 'Personnel records']]),
  yn('business', 'tender_procedures', 'Experience with tender and procurement procedures'),
  yn('business', 'banking_systems', 'Has used core-banking or ERP systems'),
  num('business', 'typing_speed', 'Typing speed', 'words per minute', 0, 150),
  multi('business', 'admin_tasks', 'Office tasks I do well', [['filing', 'Filing and records'], ['scheduling', 'Diary and scheduling'], ['minutes', 'Meeting minutes'], ['reception', 'Reception and visitors'], ['reports', 'Reports and spreadsheets'], ['correspondence', 'Letters and email']]),
  yn('business', 'project_certificate', 'Project-management certificate (e.g. PMP, PRINCE2)', { evidence: true }),
  yn('business', 'inventory_records', 'Keeps stock and inventory records'),

  // ── sales and customer service
  multi('sales', 'sales_type', 'Kinds of selling I have done', [['counter', 'Retail counter'], ['field', 'Field sales'], ['b2b', 'Selling to businesses'], ['telesales', 'Telesales or call centre'], ['merchandising', 'Merchandising'], ['distribution', 'Route distribution']]),
  yn('sales', 'sales_targets', 'Has worked to monthly sales targets'),
  yn('sales', 'mobile_ordering', 'Comfortable taking orders on a phone or tablet'),
  yn('sales', 'cash_handling', 'Experience with cash handling and daily cash-up'),
  multi('sales', 'product_areas', 'Product areas I know', [['electronics', 'Electronics and phones'], ['clothing', 'Clothing'], ['groceries', 'Groceries'], ['building', 'Building materials'], ['cosmetics', 'Cosmetics'], ['furniture', 'Furniture'], ['farm_inputs', 'Farm inputs'], ['medical', 'Medical supplies']]),
  multi('sales', 'service_channels', 'Ways I have served customers', [['counter', 'In person'], ['phone', 'Phone'], ['chat', 'Chat and social media'], ['email', 'Email']]),
  yn('sales', 'complaint_handling', 'Experience handling customer complaints'),

  // ── manufacturing and industry
  multi('manufacturing', 'production_type', 'Production areas I have worked in', [['food', 'Food and beverage'], ['textile', 'Textile and garments'], ['leather', 'Leather'], ['plastics', 'Plastics'], ['metal', 'Metal fabrication'], ['wood', 'Wood and furniture'], ['cement', 'Cement and building materials'], ['packaging', 'Packaging']]),
  multi('manufacturing', 'machine_types', 'Machines I can operate', [['sewing', 'Industrial sewing'], ['cutting', 'Cutting'], ['lathe_cnc', 'Lathe or CNC'], ['packing_line', 'Packing line'], ['boiler', 'Boiler'], ['press', 'Press'], ['mixing', 'Mixing and blending']]),
  yn('manufacturing', 'quality_systems', 'Familiar with quality systems (ISO, HACCP)', { evidence: true }),
  yn('manufacturing', 'routine_maintenance', 'Can do routine machine maintenance'),
  yn('manufacturing', 'rotating_shifts', 'Can work rotating shifts'),
  yn('manufacturing', 'line_leader', 'Has led a production line or team'),
  yn('manufacturing', 'technical_drawings', 'Can read technical drawings and work instructions'),

  // ── domestic and household
  multi('domestic', 'household_tasks', 'Household tasks I do', [['cleaning', 'Cleaning'], ['laundry', 'Laundry and ironing'], ['cooking', 'Cooking'], ['childcare', 'Childcare'], ['elder_care', 'Elder care'], ['garden', 'Gardening'], ['driving', 'Driving']]),
  multi('domestic', 'cooking_styles', 'Cooking I can do', [['traditional', 'Traditional Ethiopian'], ['continental', 'Continental'], ['fasting', 'Fasting dishes'], ['baking', 'Baking']]),
  yn('domestic', 'elder_care_experience', 'Experience caring for elderly or sick people'),
  yn('domestic', 'first_aid_home', 'Basic first-aid knowledge', { evidence: true }),
  yn('domestic', 'household_driving', 'Can drive a family car'),

  // ── general and daily labour
  multi('general-labor', 'physical_tasks', 'Work I have done', [['loading', 'Loading and unloading'], ['digging', 'Digging'], ['carrying', 'Carrying'], ['cleaning', 'Cleaning'], ['packing', 'Packing'], ['road_works', 'Road works'], ['farm_work', 'Farm work']]),
  yn('general-labor', 'protective_equipment', 'Comfortable working with protective equipment'),
  yn('general-labor', 'outdoor_work', 'Comfortable working outdoors in all weather'),
  yn('general-labor', 'team_labour', 'Comfortable working in a crew'),

  // ═════════ media, writing and creative work (a writer is hired on different things than a guard) ═════════
  multi('media-creative', 'writing_types', 'Kinds of writing I have done', [['news', 'News and reporting'], ['features', 'Feature articles'], ['marketing', 'Marketing and advertising copy'], ['technical', 'Technical writing and manuals'], ['creative', 'Stories, scripts and creative writing'], ['speeches', 'Speeches and press releases'], ['academic', 'Academic and report writing'], ['social', 'Social-media posts'], ['web', 'Website content']]),
  multi('media-creative', 'writing_languages', 'Languages I write professionally in', LANGS),
  num('media-creative', 'published_pieces', 'Published pieces or articles', 'pieces', 0, 100000),
  yn('media-creative', 'portfolio_samples', 'Can provide published or sample work', { evidence: true }),
  yn('media-creative', 'press_accreditation', 'Press or media accreditation (where required)', { evidence: true }),
  yn('media-creative', 'editing_experience', 'Has edited other people\'s work'),
  yn('media-creative', 'fact_checking', 'Experience fact-checking and sourcing'),
  yn('media-creative', 'interviews', 'Has conducted interviews'),
  yn('media-creative', 'seo_basics', 'Knows search-engine optimisation (SEO) basics'),
  yn('media-creative', 'deadline_work', 'Comfortable with daily deadlines'),
  multi('media-creative', 'writing_tools', 'Tools I use', [['word', 'Word / Google Docs'], ['wordpress', 'WordPress or other CMS'], ['indesign', 'InDesign or layout tools'], ['canva', 'Canva'], ['cms_news', 'Newsroom systems'], ['transcription', 'Transcription tools']]),
  yn('media-creative', 'story_travel', 'Can travel to cover stories'),
  multi('media-creative', 'translation_pairs', 'Translation language pairs', [['en_am', 'English to Amharic'], ['am_en', 'Amharic to English'], ['en_om', 'English to Afaan Oromoo'], ['om_en', 'Afaan Oromoo to English'], ['am_om', 'Amharic to Afaan Oromoo'], ['om_am', 'Afaan Oromoo to Amharic'], ['en_ti', 'English and Tigrinya'], ['en_ar', 'English and Arabic']]),
  yn('media-creative', 'certified_translator', 'Certified or sworn translator', { evidence: true }),
  yn('media-creative', 'interpreting_live', 'Live interpreting (consecutive or simultaneous)'),
  yn('media-creative', 'subtitling', 'Subtitling or transcription experience'),
  multi('media-creative', 'social_platforms', 'Platforms I manage', [['facebook', 'Facebook'], ['telegram', 'Telegram'], ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['youtube', 'YouTube'], ['x', 'X (Twitter)']]),
  yn('media-creative', 'content_calendar', 'Plans and schedules a content calendar'),
  yn('media-creative', 'analytics_reports', 'Reads and reports on audience analytics'),
  yn('media-creative', 'own_camera', 'Has own camera and editing equipment'),
  multi('media-creative', 'video_software', 'Editing software I use', [['premiere', 'Premiere Pro'], ['davinci', 'DaVinci Resolve'], ['finalcut', 'Final Cut'], ['capcut', 'CapCut'], ['photoshop', 'Photoshop / Lightroom'], ['audition', 'Audio editing tools']]),
  yn('media-creative', 'on_air_voice', 'On-air presenting or voice-over experience'),
  yn('media-creative', 'script_writing', 'Writes scripts and show rundowns'),

  // ═════════ legal and compliance ═════════
  yn('legal', 'practice_licence', 'Licensed to practise law (advocate licence)', { evidence: true }),
  multi('legal', 'practice_areas', 'Areas of law', [['criminal', 'Criminal'], ['civil', 'Civil'], ['commercial', 'Commercial and corporate'], ['labour', 'Labour and employment'], ['family', 'Family'], ['land', 'Land and property'], ['immigration', 'Immigration'], ['rights', 'Human rights'], ['tax', 'Tax']]),
  num('legal', 'years_practice', 'Years of legal practice', 'years', 0, 60),
  yn('legal', 'court_appearances', 'Has appeared in court or tribunals'),
  yn('legal', 'legal_drafting', 'Drafts contracts and legal opinions'),
  yn('legal', 'notary_licence', 'Notary or authentication licence', { evidence: true }),
  yn('legal', 'legal_sources', 'Experienced with legal sources (proclamations, case reports)'),
  yn('legal', 'due_diligence', 'Has carried out legal due diligence'),
  multi('legal', 'compliance_areas', 'Compliance areas', [['company', 'Company law'], ['tax', 'Tax and customs'], ['labour', 'Labour law'], ['data', 'Data protection'], ['anti_money', 'Anti-money-laundering'], ['procurement', 'Procurement rules']]),
  multi('legal', 'working_languages_legal', 'Languages I draft in', LANGS.slice(0, 4)),

  // ═════════ engineering and technical professions ═════════
  yn('engineering', 'professional_registration', 'Professional engineering registration or licence', { evidence: true }),
  multi('engineering', 'discipline', 'Engineering discipline', [['civil', 'Civil'], ['electrical', 'Electrical'], ['mechanical', 'Mechanical'], ['chemical', 'Chemical'], ['water', 'Water and sanitation'], ['electromech', 'Electromechanical'], ['industrial', 'Industrial'], ['geotech', 'Geotechnical'], ['survey', 'Surveying']]),
  multi('engineering', 'design_software', 'Software I use', [['autocad', 'AutoCAD'], ['revit', 'Revit'], ['etabs', 'ETABS / SAP'], ['project', 'MS Project / Primavera'], ['gis', 'GIS'], ['matlab', 'MATLAB'], ['solidworks', 'SolidWorks']]),
  yn('engineering', 'site_supervision_experience', 'Has supervised work on site'),
  num('engineering', 'largest_project', 'Largest project handled', 'million ETB', 0, 100000, { must: false }),
  yn('engineering', 'hse_certificate', 'Health and safety certificate', { evidence: true }),
  yn('engineering', 'boq_experience', 'Prepares bills of quantities and cost estimates'),
  yn('engineering', 'solar_certificate', 'Solar installation certificate', { evidence: true }),
  yn('engineering', 'contractor_licence', 'Contractor or installer licence', { evidence: true }),
  yn('engineering', 'tender_documents', 'Prepares technical tender documents'),
  yn('engineering', 'commissioning', 'Has commissioned and tested installations'),
  yn('engineering', 'field_travel', 'Willing to travel to project sites for weeks'),
  yn('engineering', 'tower_climbing', 'Trained to work at height on towers or poles', { evidence: true }),
  yn('engineering', 'plc_programming', 'Has programmed PLCs or control systems'),

  // ═════════ beauty and personal care ═════════
  yn('beauty-care', 'cosmetology_certificate', 'Cosmetology or beauty training certificate', { evidence: true }),
  multi('beauty-care', 'services', 'Services I offer', [['cut_style', 'Haircuts and styling'], ['braiding', 'Braiding'], ['colour', 'Colouring'], ['relaxer', 'Relaxers and treatments'], ['barber', 'Barbering and beards'], ['makeup', 'Makeup'], ['nails', 'Nails'], ['facial', 'Facials'], ['massage', 'Massage'], ['bridal', 'Bridal services']]),
  yn('beauty-care', 'own_kit', 'Has own tools and products'),
  yn('beauty-care', 'hygiene_certificate', 'Hygiene or health certificate', { evidence: true }),
  yn('beauty-care', 'home_visits', 'Willing to work at clients\' homes'),
  multi('beauty-care', 'hair_types', 'Hair types I work with', [['textured', 'Textured / afro'], ['straight', 'Straight'], ['braids_locs', 'Braids and locs'], ['extensions', 'Wigs and extensions']]),
  yn('beauty-care', 'client_records', 'Keeps client records and bookings'),
  yn('beauty-care', 'sterilisation', 'Follows tool sterilisation and hygiene routines'),
  yn('beauty-care', 'chemical_safety', 'Trained in safe use of hair and skin chemicals', { evidence: true }),

  // ═════════ social services and NGOs ═════════
  multi('social-services', 'field_of_study', 'Field of study', [['social_work', 'Social work'], ['sociology', 'Sociology'], ['psychology', 'Psychology'], ['public_health', 'Public health'], ['development', 'Development studies'], ['education', 'Education'], ['law', 'Law'], ['gender', 'Gender studies']]),
  yn('social-services', 'ngo_experience', 'Has worked for an NGO or international organisation'),
  multi('social-services', 'client_groups', 'Groups I have worked with', [['children', 'Children and youth'], ['disability', 'People with disabilities'], ['displaced', 'Refugees and displaced people'], ['rural', 'Rural communities'], ['hiv', 'People living with HIV'], ['elderly', 'Older people'], ['violence', 'Survivors of violence']]),
  yn('social-services', 'safeguarding_training', 'Safeguarding and protection training', { evidence: true }),
  yn('social-services', 'remote_fieldwork', 'Willing to work in remote field locations'),
  multi('social-services', 'data_tools', 'Data and survey tools', [['kobo', 'KoBo / ODK'], ['excel', 'Excel'], ['spss', 'SPSS / Stata'], ['dhis2', 'DHIS2'], ['powerbi', 'Power BI']]),
  yn('social-services', 'donor_reporting', 'Has written donor reports or proposals'),
  yn('social-services', 'field_motorbike', 'Can ride a motorbike for field visits'),
  multi('social-services', 'community_languages', 'Languages I work in with communities', LANGS.slice(0, 8)),
  yn('social-services', 'case_files', 'Keeps confidential case files and records'),
  yn('social-services', 'training_facilitation', 'Has facilitated community training or workshops'),
  yn('social-services', 'psychosocial_training', 'Psychosocial support or counselling training', { evidence: true }),
  yn('social-services', 'emergency_response', 'Has worked in an emergency or humanitarian response'),

  // ═════════ tourism and travel ═════════
  yn('tourism', 'guide_licence', 'Tour guide licence from the tourism authority', { evidence: true }),
  multi('tourism', 'guide_languages', 'Languages I guide in', [['en', 'English'], ['am', 'Amharic'], ['fr', 'French'], ['it', 'Italian'], ['de', 'German'], ['es', 'Spanish'], ['zh', 'Chinese'], ['ar', 'Arabic'], ['ja', 'Japanese']]),
  multi('tourism', 'tour_types', 'Tours I have led', [['cultural', 'Historical and cultural'], ['trekking', 'Trekking and hiking'], ['wildlife', 'Wildlife and birding'], ['city', 'City tours'], ['coffee', 'Coffee and food'], ['festival', 'Festival and pilgrimage tours'], ['photo', 'Photography tours']]),
  yn('tourism', 'first_aid_tourism', 'First-aid certificate', { evidence: true }),
  yn('tourism', 'drive_4x4', 'Can drive 4x4 vehicles'),
  yn('tourism', 'booking_systems', 'Has used airline or hotel booking systems'),
  multi('tourism', 'event_types', 'Events I have organised', [['weddings', 'Weddings'], ['conferences', 'Conferences'], ['concerts', 'Concerts'], ['corporate', 'Corporate events'], ['festivals', 'Festivals']]),
  multi('tourism', 'lodge_operations', 'Lodge operations I have managed', [['reception', 'Reception and bookings'], ['housekeeping', 'Housekeeping'], ['purchasing', 'Purchasing'], ['accounts', 'Accounts'], ['staff', 'Staff rotas']]),
  yn('tourism', 'multi_day_treks', 'Able to lead multi-day treks'),
  yn('tourism', 'visa_documents', 'Can advise on visa and travel documents'),
  yn('tourism', 'guest_safety', 'Trained in guest safety and emergency procedures', { evidence: true }),
  yn('tourism', 'budget_costing', 'Can price tours and keep trip budgets'),

  // ═════════ second batch of sectors (starting defaults, same review caveat as above) ═════════
  // banking and finance
  yn('banking-finance', 'banking_licence', 'Licence or certificate from the financial regulator (where the role needs one)', { evidence: true }),
  yn('banking-finance', 'cash_handling', 'Has handled cash and balanced a till'),
  multi('banking-finance', 'banking_systems', 'Systems I have used', [['core', 'Core banking system'], ['mobile', 'Mobile money / agent banking'], ['excel', 'Excel'], ['insurance', 'Insurance policy system']]),
  yn('banking-finance', 'kyc_aml', 'Trained in customer identification and anti-money-laundering checks', { evidence: true }),
  yn('banking-finance', 'field_collection', 'Willing to visit clients and collect repayments in the field'),
  // real estate
  yn('real-estate', 'broker_licence', 'Brokerage or property-agent licence', { evidence: true }),
  yn('real-estate', 'property_documents', 'Can check title deeds and lease documents'),
  yn('real-estate', 'own_transport_estate', 'Has own transport for property visits'),
  multi('real-estate', 'property_types', 'Property I have worked with', [['residential', 'Homes and apartments'], ['commercial', 'Shops and offices'], ['land', 'Land plots'], ['industrial', 'Warehouses and factories']]),
  yn('real-estate', 'tenant_handling', 'Has managed tenants, rent collection and repairs'),
  // telecom
  yn('telecom', 'height_work_telecom', 'Safe to work at height on towers (with training)', { evidence: true }),
  multi('telecom', 'network_skills', 'Network work I can do', [['lan', 'LAN and Wi-Fi'], ['fibre', 'Fibre splicing'], ['microwave', 'Microwave links'], ['base_station', 'Base-station equipment'], ['voip', 'VoIP and phone systems']]),
  yn('telecom', 'vendor_certificate', 'Network certificate (for example Cisco or equivalent)', { evidence: true }),
  yn('telecom', 'on_call', 'Willing to be on call for faults'),
  multi('telecom', 'call_languages', 'Languages I can serve callers in', LANGS.slice(0, 8)),
  // mining and energy
  yn('mining-energy', 'mine_safety_training', 'Mine or site safety induction', { evidence: true }),
  multi('mining-energy', 'mining_equipment', 'Equipment I can operate', [['excavator', 'Excavator'], ['loader', 'Loader'], ['drill', 'Drill rig'], ['crusher', 'Crusher plant'], ['generator', 'Generator']]),
  yn('mining-energy', 'remote_site_rotation', 'Willing to work on remote sites in rotation'),
  yn('mining-energy', 'electrical_competence_energy', 'Electrical competence certificate for utility work', { evidence: true }),
  yn('mining-energy', 'hazard_reporting', 'Experienced in reporting hazards and near misses'),
  // aviation
  yn('aviation', 'airport_clearance', 'Can obtain airport security clearance', { help: 'Issued by the authority; this only says you are willing to apply for it.' }),
  yn('aviation', 'aviation_certificate', 'Aviation training or licence for the role', { evidence: true }),
  multi('aviation', 'aviation_languages', 'Languages I work in', LANGS.slice(0, 5).concat([['fr', 'French'], ['ar', 'Arabic']])),
  yn('aviation', 'shift_rosters', 'Comfortable with rotating shifts including nights and holidays'),
  yn('aviation', 'dangerous_goods', 'Dangerous-goods handling training', { evidence: true }),
  // import and export
  yn('import-export', 'customs_licence', 'Customs clearing agent licence', { evidence: true }),
  multi('import-export', 'trade_systems', 'Trade systems and documents I have used', [['asycuda', 'Customs declaration system'], ['lc', 'Letters of credit'], ['bill_lading', 'Bills of lading'], ['invoice', 'Commercial invoices']]),
  yn('import-export', 'port_visits', 'Willing to work at ports, dry ports and borders'),
  yn('import-export', 'commodity_experience', 'Has cleared coffee, textiles, machinery or food products'),
  yn('import-export', 'permit_applications', 'Has applied for import or export permits'),
  // food processing
  yn('food-processing', 'food_handler_certificate', 'Food handler or hygiene certificate', { evidence: true }),
  multi('food-processing', 'production_lines', 'Production I have worked on', [['bakery', 'Bakery and injera'], ['dairy', 'Dairy'], ['milling', 'Milling'], ['beverage', 'Beverages'], ['meat', 'Meat processing'], ['oil', 'Edible oil']]),
  yn('food-processing', 'machine_operation_food', 'Can operate and clean production machines'),
  yn('food-processing', 'quality_records', 'Keeps batch and quality records'),
  yn('food-processing', 'standing_shift_work', 'Fit for long periods standing and shift work'),
  // textile and leather
  multi('textile-leather', 'machines_textile', 'Machines I can operate', [['lockstitch', 'Lockstitch'], ['overlock', 'Overlock'], ['cutting', 'Cutting machine'], ['embroidery', 'Embroidery'], ['loom', 'Loom']]),
  yn('textile-leather', 'production_target', 'Has worked to daily production targets'),
  yn('textile-leather', 'own_machine', 'Has own sewing machine'),
  yn('textile-leather', 'pattern_skill', 'Can read and cut patterns'),
  yn('textile-leather', 'export_quality', 'Has worked to export quality standards'),
  // arts and entertainment
  multi('arts-entertainment', 'performance_types', 'Performance or creative work I do', [['music', 'Music'], ['dance', 'Dance'], ['theatre', 'Theatre'], ['film', 'Film and video'], ['design', 'Visual design'], ['comedy', 'Comedy and hosting']]),
  yn('arts-entertainment', 'portfolio_reel', 'Has a portfolio, recording or showreel'),
  yn('arts-entertainment', 'own_instruments_gear', 'Has own instruments or equipment'),
  yn('arts-entertainment', 'performance_hours', 'Available evenings, weekends and holidays'),
  yn('arts-entertainment', 'public_performance', 'Has performed in public or at events'),
  // sports and fitness
  yn('sports-fitness', 'coaching_certificate', 'Coaching or instructor certificate', { evidence: true }),
  multi('sports-fitness', 'sports_offered', 'Sports and training I can teach', [['football', 'Football'], ['athletics', 'Athletics'], ['fitness', 'Gym and fitness'], ['swimming', 'Swimming'], ['martial', 'Martial arts'], ['volleyball', 'Volleyball and basketball']]),
  yn('sports-fitness', 'first_aid_sports', 'First-aid certificate', { evidence: true }),
  yn('sports-fitness', 'works_with_children_sports', 'Has coached children or youth teams'),
  yn('sports-fitness', 'competition_experience', 'Has taken part in or run competitions'),
  // veterinary
  yn('veterinary', 'vet_registration', 'Veterinary registration or animal-health qualification', { evidence: true }),
  multi('veterinary', 'animal_species', 'Animals I have treated', [['cattle', 'Cattle'], ['small_ruminants', 'Sheep and goats'], ['poultry', 'Poultry'], ['camels', 'Camels'], ['equine', 'Horses, donkeys, mules'], ['pets', 'Dogs and cats']]),
  yn('veterinary', 'field_visits_vet', 'Willing to travel to farms and pastoral areas'),
  yn('veterinary', 'cold_chain', 'Knows vaccine cold-chain handling'),
  yn('veterinary', 'motorbike_vet', 'Can ride a motorbike for field visits'),
  // environment and natural resources
  yn('environment-natural', 'field_work_environment', 'Willing to do long field work outdoors'),
  multi('environment-natural', 'environment_skills', 'Skills I have', [['gis', 'GIS and mapping'], ['eia', 'Impact assessment'], ['nursery', 'Tree nursery'], ['monitoring', 'Biodiversity monitoring'], ['community', 'Community conservation']]),
  yn('environment-natural', 'environment_degree', 'Relevant degree or diploma', { evidence: true }),
  yn('environment-natural', 'report_writing_env', 'Has written environmental or monitoring reports'),
  yn('environment-natural', 'gps_use', 'Can use GPS and field data apps'),
  // water and waste
  yn('water-waste', 'water_operator_certificate', 'Water or wastewater operator training', { evidence: true }),
  multi('water-waste', 'water_work', 'Work I can do', [['pumps', 'Pumps and pipes'], ['drilling', 'Drilling and wells'], ['treatment', 'Treatment plant'], ['sanitation', 'Latrines and sanitation'], ['collection', 'Waste collection']]),
  yn('water-waste', 'protective_equipment', 'Experienced in using protective equipment safely'),
  yn('water-waste', 'community_hygiene', 'Has led community hygiene sessions'),
  yn('water-waste', 'remote_water_sites', 'Willing to work in rural water schemes'),
  // research and science
  yn('research-science', 'lab_degree', 'Relevant science degree or diploma', { evidence: true }),
  multi('research-science', 'lab_methods', 'Methods I have used', [['chemistry', 'Chemical analysis'], ['microbiology', 'Microbiology'], ['sampling', 'Field sampling'], ['survey', 'Survey data collection'], ['stats', 'Statistics software']]),
  yn('research-science', 'lab_safety', 'Laboratory safety training', { evidence: true }),
  yn('research-science', 'published_work', 'Has co-authored a report or paper'),
  yn('research-science', 'tablet_data_collection', 'Has collected data with tablets or phones'),
  // handicrafts
  multi('crafts-artisan', 'craft_types', 'Crafts I make', [['weaving', 'Weaving'], ['pottery', 'Pottery'], ['metal', 'Metalwork'], ['wood', 'Woodwork'], ['leather', 'Leather'], ['beads', 'Beadwork and jewellery']]),
  yn('crafts-artisan', 'own_workshop', 'Has own workshop or workspace'),
  yn('crafts-artisan', 'custom_orders', 'Takes custom orders and works to a sample'),
  yn('crafts-artisan', 'trained_apprentices', 'Has trained apprentices'),
  yn('crafts-artisan', 'sells_markets', 'Has sold at markets, shops or to tourists'),
  // repair services
  multi('repair-services', 'devices_repaired', 'Devices I repair', [['phones', 'Mobile phones'], ['tv', 'TV and audio'], ['fridge', 'Refrigerators and cookers'], ['computers', 'Computers and printers'], ['motorbikes', 'Motorbikes and bicycles'], ['generators', 'Generators and pumps']]),
  yn('repair-services', 'own_tools_repair', 'Has own tools and test equipment'),
  yn('repair-services', 'repair_warranty', 'Gives a warranty on repairs'),
  yn('repair-services', 'customer_site_repairs', 'Willing to repair at the customer\'s home or shop'),
  yn('repair-services', 'repair_certificate', 'Technical training certificate', { evidence: true }),
  // childcare and elder care
  yn('childcare-eldercare', 'childcare_training', 'Childcare, nursing-assistant or caregiver training', { evidence: true }),
  multi('childcare-eldercare', 'care_groups', 'People I have cared for', [['infants', 'Infants'], ['toddlers', 'Toddlers and school children'], ['elderly_care', 'Older people'], ['disability_care', 'People with disabilities'], ['bedridden', 'Bedridden clients']]),
  yn('childcare-eldercare', 'first_aid_care', 'First-aid certificate', { evidence: true }),
  yn('childcare-eldercare', 'live_in_care', 'Willing to live in'),
  yn('childcare-eldercare', 'reference_care', 'Can give a reference from a family or centre'),
  // public administration
  yn('public-administration', 'civil_service_exam', 'Has passed a civil-service or competitive recruitment exam', { evidence: true }),
  multi('public-administration', 'admin_work', 'Administrative work I have done', [['records', 'Records and archives'], ['licensing', 'Permits and licensing'], ['land', 'Land and property'], ['budget', 'Budgets and finance'], ['hr_admin', 'Personnel administration']]),
  yn('public-administration', 'government_experience', 'Has worked in a government office'),
  yn('public-administration', 'digital_records', 'Can use computerised records systems'),
  yn('public-administration', 'public_service_languages', 'Can serve the public in the local working language'),
  // procurement and supply chain
  yn('procurement-supply', 'procurement_training', 'Procurement or supply-chain certificate', { evidence: true }),
  multi('procurement-supply', 'procurement_tasks', 'Tasks I have done', [['tenders', 'Tenders and bids'], ['rfq', 'Quotations'], ['contracts', 'Supplier contracts'], ['stores', 'Stores and inventory'], ['import_orders', 'Import orders']]),
  yn('procurement-supply', 'donor_procurement_rules', 'Knows donor or public procurement rules'),
  yn('procurement-supply', 'inventory_software', 'Has used stock or ERP software'),
  yn('procurement-supply', 'warehouse_stocktake', 'Has led a stock count'),
  // marketing and PR
  multi('marketing-pr', 'marketing_channels', 'Channels I have run', [['facebook', 'Facebook and Instagram'], ['telegram', 'Telegram'], ['tiktok', 'TikTok and YouTube'], ['radio_tv', 'Radio and TV'], ['outdoor', 'Billboards and print'], ['email_sms', 'Email and SMS']]),
  yn('marketing-pr', 'campaign_results', 'Can show results from a past campaign'),
  yn('marketing-pr', 'design_tools', 'Uses design or editing tools'),
  yn('marketing-pr', 'media_contacts', 'Has worked with media outlets'),
  yn('marketing-pr', 'brand_writing', 'Writes in more than one language for marketing'),
  // language and interpretation
  multi('language-interpretation', 'working_languages', 'Languages I work in', LANGS),
  choice('language-interpretation', 'interpreting_mode', 'Interpreting I can do', [['consecutive', 'Consecutive'], ['simultaneous', 'Simultaneous'], ['written', 'Written translation only'], ['sign', 'Sign language']]),
  yn('language-interpretation', 'language_certificate', 'Language or interpreter certificate', { evidence: true }),
  yn('language-interpretation', 'confidentiality_commitment', 'Understands and keeps client confidentiality'),
  yn('language-interpretation', 'subject_areas', 'Has interpreted in legal, medical or humanitarian settings'),
  // delivery and courier
  multi('delivery-courier', 'delivery_vehicles', 'Vehicles I can use for delivery', [['bicycle', 'Bicycle'], ['motorbike_delivery', 'Motorbike'], ['bajaj', 'Three-wheeler'], ['car', 'Car or van'], ['foot', 'On foot']], { evidence: true }),
  yn('delivery-courier', 'own_vehicle_delivery', 'Has own vehicle'),
  yn('delivery-courier', 'delivery_app_use', 'Can use a phone app for orders and navigation'),
  yn('delivery-courier', 'city_knowledge', 'Knows the streets of the city well'),
  yn('delivery-courier', 'cash_on_delivery', 'Has handled cash on delivery'),
  // human resources
  yn('human-resources', 'hr_certificate', 'HR or labour-law certificate or degree', { evidence: true }),
  multi('human-resources', 'hr_tasks', 'HR work I have done', [['recruiting', 'Recruiting'], ['payroll', 'Payroll'], ['contracts_hr', 'Employment contracts'], ['disciplinary', 'Disciplinary and grievance'], ['training_hr', 'Training'], ['records_hr', 'Personnel records']]),
  yn('human-resources', 'labour_law_knowledge', 'Knows the national labour proclamation'),
  yn('human-resources', 'hr_software', 'Has used HR or payroll software'),
  yn('human-resources', 'interview_panels', 'Has served on interview panels'),
  // data and analytics
  multi('data-analytics', 'analytics_tools', 'Tools I use', [['excel', 'Excel'], ['sql', 'SQL'], ['python', 'Python'], ['r', 'R'], ['powerbi', 'Power BI / Tableau'], ['qgis', 'GIS software']]),
  yn('data-analytics', 'analytics_portfolio', 'Can show a dashboard, report or project'),
  yn('data-analytics', 'data_privacy_practice', 'Follows data privacy practice (anonymising and limiting access)'),
  yn('data-analytics', 'analytics_degree', 'Relevant degree or certificate', { evidence: true }),
  yn('data-analytics', 'present_findings', 'Has presented findings to non-technical audiences'),
  // printing and publishing
  multi('printing-publishing', 'print_processes', 'Print processes I have worked with', [['offset', 'Offset'], ['digital', 'Digital'], ['screen', 'Screen printing'], ['large_format', 'Large format and banners'], ['binding', 'Binding and finishing']]),
  yn('printing-publishing', 'layout_software', 'Has used page layout or design software'),
  yn('printing-publishing', 'machine_operation_print', 'Has operated a printing press or finishing machine'),
  yn('printing-publishing', 'proofreading_skill', 'Can proofread in Amharic or English'),
  yn('printing-publishing', 'print_training', 'Printing or publishing certificate or training', { evidence: true }),
  // funeral and memorial services
  yn('funeral-services', 'funeral_experience', 'Has helped organise funerals or memorial services'),
  yn('funeral-services', 'sensitive_work', 'Comfortable working with grieving families'),
  multi('funeral-services', 'funeral_tasks', 'Tasks I can do', [['arrangements', 'Arrangements'], ['transport', 'Transport'], ['grave_work', 'Grave and cemetery work'], ['tents_catering', 'Tents and catering'], ['family_support', 'Support for families']]),
  yn('funeral-services', 'driving_licence_funeral', 'Holds a driving licence for the hearse or service vehicle', { evidence: true }),
  yn('funeral-services', 'weekend_callout', 'Can be called out at short notice, including weekends', { must: true }),
  // event management
  multi('event-management', 'event_kinds', 'Events I have worked on', [['wedding', 'Weddings'], ['conference', 'Conferences'], ['concert', 'Concerts'], ['community', 'Community events'], ['corporate', 'Corporate events']]),
  yn('event-management', 'own_equipment_event', 'Has own sound, lighting or decoration equipment'),
  yn('event-management', 'event_late_hours', 'Can work late evenings and weekends', { must: true }),
  num('event-management', 'events_per_year', 'Events worked on in a year', 'events', 0, 500),
  yn('event-management', 'event_portfolio', 'Can show photos or references from past events'),
  // interior and landscape design
  multi('interior-landscape', 'design_areas', 'Areas I work in', [['homes', 'Homes'], ['offices', 'Offices'], ['hotels', 'Hotels and restaurants'], ['gardens', 'Gardens and compounds'], ['public_spaces', 'Public spaces']]),
  yn('interior-landscape', 'design_software', 'Has used drawing or 3D design software'),
  yn('interior-landscape', 'design_portfolio', 'Can show a portfolio of completed work'),
  yn('interior-landscape', 'site_visits_design', 'Willing to visit sites and take measurements'),
  yn('interior-landscape', 'design_qualification', 'Design, architecture or horticulture qualification', { evidence: true }),
  // quality assurance and inspection
  multi('quality-assurance', 'qa_areas', 'Quality work I have done', [['inspection', 'Product inspection'], ['testing', 'Testing and measurement'], ['audits', 'Quality audits'], ['software', 'Software testing'], ['documentation', 'Quality records']]),
  yn('quality-assurance', 'qa_standards', 'Knows a quality standard (for example ISO 9001)'),
  yn('quality-assurance', 'measuring_instruments', 'Can use measuring and testing instruments'),
  yn('quality-assurance', 'qa_certificate', 'Quality or testing certificate', { evidence: true }),
  yn('quality-assurance', 'report_writing_qa', 'Can write clear inspection reports'),
  // compliance and auditing
  yn('compliance-audit', 'audit_qualification', 'Accounting, audit or compliance qualification', { evidence: true }),
  multi('compliance-audit', 'audit_types', 'Types of audit or review I have done', [['financial', 'Financial'], ['internal', 'Internal'], ['operational', 'Operational'], ['it', 'IT systems'], ['donor', 'Donor or project']]),
  yn('compliance-audit', 'audit_software', 'Has used audit or accounting software'),
  yn('compliance-audit', 'confidentiality_audit', 'Has worked with confidential records'),
  yn('compliance-audit', 'audit_report_writing', 'Has written audit findings or reports'),
  // robotics and automation
  yn('robotics-automation', 'robotics_training', 'Robotics, mechatronics or automation training', { evidence: true }),
  multi('robotics-automation', 'automation_tools', 'Tools and platforms I use', [['plc', 'PLC systems'], ['arduino', 'Arduino or microcontrollers'], ['ros', 'ROS or robot software'], ['cad', 'CAD'], ['sensors', 'Sensors and motors']]),
  yn('robotics-automation', 'electrical_safety_robotics', 'Trained in electrical safety'),
  yn('robotics-automation', 'built_project_robotics', 'Has built a working robot or automation project'),
  yn('robotics-automation', 'schematic_reading', 'Can read electrical and mechanical drawings'),
  // blockchain and digital assets
  multi('blockchain-digital', 'chain_platforms', 'Platforms I have worked with', [['ethereum', 'Ethereum and compatible chains'], ['solana', 'Solana'], ['bitcoin', 'Bitcoin'], ['enterprise', 'Enterprise ledgers'], ['none', 'Learning, no production work yet']]),
  yn('blockchain-digital', 'contract_language', 'Can write smart contracts (for example Solidity)'),
  yn('blockchain-digital', 'security_practice_chain', 'Follows secure key and wallet handling practice'),
  yn('blockchain-digital', 'chain_portfolio', 'Can show public code or a deployed project'),
  yn('blockchain-digital', 'regulation_awareness', 'Understands the legal limits on digital assets where the work is done'),
  // gaming and interactive media
  multi('gaming-interactive', 'game_engines', 'Engines and tools I use', [['unity', 'Unity'], ['unreal', 'Unreal'], ['godot', 'Godot'], ['web', 'Web games'], ['mobile', 'Mobile games']]),
  yn('gaming-interactive', 'shipped_game', 'Has released a game or interactive app'),
  yn('gaming-interactive', 'game_portfolio', 'Can show a playable demo or portfolio'),
  yn('gaming-interactive', 'bug_reporting', 'Can write clear bug reports'),
  multi('gaming-interactive', 'game_roles', 'Roles I can fill', [['programmer', 'Programming'], ['artist', 'Art and animation'], ['designer', 'Game or level design'], ['tester', 'Testing'], ['audio', 'Sound and music']]),
  // archaeology, heritage and culture
  yn('heritage-culture', 'heritage_qualification', 'Degree or training in archaeology, history, museum or heritage studies', { evidence: true }),
  yn('heritage-culture', 'fieldwork_experience', 'Has taken part in field excavation or heritage surveys'),
  yn('heritage-culture', 'handling_collections', 'Trained to handle artefacts, manuscripts or archives'),
  yn('heritage-culture', 'site_travel_heritage', 'Willing to work at remote sites'),
  yn('heritage-culture', 'local_languages_heritage', 'Speaks the local language of the heritage area'),
  // personal and executive assistance
  yn('personal-assistance', 'secretarial_training', 'Secretarial or office administration certificate', { evidence: true }),
  multi('personal-assistance', 'pa_tools', 'Tools I use', [['office_suite', 'Word and Excel'], ['email_calendar', 'Email and calendar'], ['video_meetings', 'Video meetings'], ['filing', 'Paper filing'], ['travel_booking', 'Travel booking']]),
  yn('personal-assistance', 'typing_speed_pa', 'Types fast and accurately'),
  yn('personal-assistance', 'confidential_pa', 'Has handled confidential information'),
  yn('personal-assistance', 'flexible_hours_pa', 'Can adjust working hours to the manager’s schedule', { must: true }),
  // occupational health and safety
  yn('occupational-safety', 'safety_certificate', 'Occupational safety or health certificate', { evidence: true }),
  multi('occupational-safety', 'safety_sectors', 'Workplaces I have covered', [['construction', 'Construction'], ['factory', 'Factory'], ['farm', 'Farm and agro-processing'], ['health', 'Health facility'], ['office', 'Offices and hotels']]),
  yn('occupational-safety', 'first_aid_trained', 'First-aid trained', { evidence: true }),
  yn('occupational-safety', 'risk_assessments_done', 'Has carried out written risk assessments'),
  yn('occupational-safety', 'training_staff_safety', 'Has trained staff on safe working'),
  // cybersecurity
  yn('cybersecurity-services', 'security_certification', 'Security certification (for example CEH, Security+, CISSP)', { evidence: true }),
  multi('cybersecurity-services', 'security_areas', 'Areas I work in', [['network', 'Network security'], ['application', 'Application security'], ['monitoring', 'Monitoring and response'], ['pentest', 'Penetration testing'], ['policy', 'Policy and awareness']]),
  yn('cybersecurity-services', 'lab_experience', 'Has practised in a lab or on authorised test systems'),
  yn('cybersecurity-services', 'authorised_testing_only', 'Works only with written permission from the system owner'),
  yn('cybersecurity-services', 'incident_experience', 'Has handled a real security incident'),
  // space and satellite services
  yn('space-satellite', 'rf_training', 'Training in radio, satellite or telecom systems', { evidence: true }),
  multi('space-satellite', 'space_work', 'Work I have done', [['dish_install', 'Dish installation'], ['ground_station', 'Ground station operation'], ['imagery', 'Satellite imagery analysis'], ['tracking', 'Tracking and telemetry'], ['research', 'Research support']]),
  yn('space-satellite', 'work_at_height_space', 'Can work at height on masts and rooftops'),
  yn('space-satellite', 'instrument_use_space', 'Can use signal meters and spectrum tools'),
  yn('space-satellite', 'science_degree_space', 'Degree in physics, engineering or earth science', { evidence: true }),
  // e-commerce operations
  multi('ecommerce', 'ecommerce_platforms', 'Platforms I have used', [['own_site', 'Own website or shop'], ['social', 'Social media shops'], ['marketplace', 'Marketplaces'], ['telegram', 'Telegram shops'], ['none', 'None yet']]),
  yn('ecommerce', 'inventory_tracking', 'Can keep stock records accurately'),
  yn('ecommerce', 'customer_chat', 'Has handled customer messages and complaints online'),
  yn('ecommerce', 'packing_dispatch', 'Has packed and dispatched orders'),
  yn('ecommerce', 'payment_reconciliation', 'Can reconcile mobile-money and cash-on-delivery payments'),
  // digital content creation
  multi('digital-content', 'content_channels', 'Channels I publish on', [['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['telegram_channel', 'Telegram channels'], ['podcast', 'Podcasts']]),
  yn('digital-content', 'content_portfolio', 'Can show published content and its reach'),
  yn('digital-content', 'editing_software', 'Has used video or audio editing software'),
  yn('digital-content', 'own_recording_gear', 'Has own camera, microphone or phone setup'),
  yn('digital-content', 'copyright_awareness', 'Knows the rules for using music, images and other people’s work'),
];
