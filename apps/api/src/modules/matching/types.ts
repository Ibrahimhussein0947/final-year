import type { CriteriaDetail, Eligibility, JobCriterionFeature, WorkerCriterionValue } from './criteria';

export const ENGINE_VERSION = 'rules-1.0';
/** Used for results where semantic (embedding) similarity contributed. */
export const HYBRID_VERSION = 'hybrid-1.0';

export const COMPONENT_KEYS = ['skills', 'experience', 'location', 'qualification', 'availability', 'preferences', 'criteria'] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];
export type MatchWeights = Record<ComponentKey, number>;

/** Initial weights from the project brief. Admin-configurable, optionally per job category. */
export const DEFAULT_WEIGHTS: MatchWeights = {
  // The first six keep the ratios of the original brief (35/20/15/10/10/10 scaled by 0.88); `criteria` (sector
  // requirements, Phase 15) takes 12%. A job with no sector criteria leaves that component out and the rest are
  // renormalised, so such jobs score exactly as before.
  skills: 0.308,
  experience: 0.176,
  location: 0.132,
  qualification: 0.088,
  availability: 0.088,
  preferences: 0.088,
  criteria: 0.12,
};

export const EDUCATION_RANK: Record<string, number> = {
  NONE: 0, PRIMARY: 1, SECONDARY: 2, VOCATIONAL_CERTIFICATE: 3, DIPLOMA: 4, BACHELOR: 5, MASTER: 6, DOCTORATE: 7,
};

export interface JobFeatures {
  id: string;
  categoryId: string;
  employmentType: string;
  workMode: 'ON_SITE' | 'REMOTE' | 'HYBRID';
  minExperienceYears: number | null;
  requiredEducationLevel: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  startDate: Date | null;
  lat: number | null;
  lng: number | null;
  /** Location ids from region down to the most specific known place. */
  locationPath: string[];
  skills: { skillId: string; name: string; importance: 'REQUIRED' | 'PREFERRED'; minProficiency: number | null }[];
  /** Sentence embedding of the posting, when the AI service has produced one. */
  embedding: number[] | null;
  /** Sector requirements (Phase 15). Missing = none. */
  criteria?: JobCriterionFeature[];
}

export interface WorkerFeatures {
  id: string;
  categoryId: string | null;
  yearsExperience: number;
  experiences: { categoryId: string | null; start: Date; end: Date | null }[];
  educationLevels: string[];
  certificationCount: number;
  skills: { skillId: string; name: string; proficiency: number }[];
  availability: 'IMMEDIATELY' | 'WITHIN_TWO_WEEKS' | 'WITHIN_ONE_MONTH' | 'FLEXIBLE' | 'NOT_AVAILABLE';
  availableFrom: Date | null;
  lat: number | null;
  lng: number | null;
  maxTravelKm: number | null;
  willingToRelocate: boolean;
  locationPath: string[];
  preferredTypes: string[];
  preferredWorkModes: string[];
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  /** Sentence embedding of the profile text (headline, occupation, skills, bio). */
  embedding: number[] | null;
  /** Sector answers by criterion id (Phase 15). Missing = none. */
  criteria?: Record<string, WorkerCriterionValue>;
}

/** skillId -> (related skillId -> credit in [0,1]). Symmetric. */
export type RelationMap = Map<string, Map<string, number>>;

export interface ComponentOutcome {
  /** 0..1, or null when there is not enough information to judge (never silently 0). */
  score: number | null;
  /** Short human-readable fact used in the explanation. */
  note: string;
  /** Not assessed because of missing data, with the reason. */
  missingReason?: string;
}

export interface MatchResult {
  engineVersion: string;
  /** 0..100, one decimal. */
  score: number;
  /** Share of total weight that could be assessed, 0..1. */
  confidence: number;
  strength: 'strong' | 'good' | 'partial' | 'weak';
  components: Record<ComponentKey, { score: number | null; weight: number; note: string }>;
  matchedSkills: string[];
  relatedSkills: { required: string; has: string; credit: number }[];
  missingSkills: string[];
  /** How many of the job's required skills the worker covers (exactly or through a related skill). */
  requiredCoverage: { required: number; covered: number };
  /**
   * Semantic evidence from sentence embeddings. `similarity` is the raw cosine, `score` its calibrated 0..1 value,
   * `lift` how many points of the skills component it added. All null/0 when the AI service was not used.
   */
  semantic: { similarity: number | null; score: number | null; lift: number };
  /** Sector requirements: which are met, not met, or unanswered, and the resulting eligibility. */
  criteria: CriteriaDetail;
  /** 'not_eligible' when a must-have sector requirement is known to be unmet; 'unknown' when one is unanswered. */
  eligibility: Eligibility;
  /** Components skipped for lack of data, e.g. "qualification: the job does not require one". */
  notAssessed: { component: ComponentKey; reason: string }[];
  /** Whole kilometres (rounded), present only when both sides have coordinates. */
  distanceKm: number | null;
  explanation: string;
}
