export type Confidence = 'high' | 'medium' | 'low';
export interface Suggestion<T> { value: T; confidence: Confidence; evidence: string | null }

export interface JobAnalysis {
  method: string;
  skills: { skillId: string; name: string; importance: 'REQUIRED' | 'PREFERRED'; confidence: Confidence; evidence: string }[];
  minExperienceYears: Suggestion<number | null> | null;
  requiredEducationLevel: Suggestion<string | null> | null;
  employmentType: Suggestion<string>;
  workMode: Suggestion<string>;
  category: Suggestion<{ id: string; name: string }> | null;
  languages: Suggestion<string[]> | null;
  salary: Suggestion<{ min: number | null; max: number | null }> | null;
  notes: string[];
}

export interface CvDraft {
  method: string;
  summary: string | null;
  skills: { skillId: string; name: string; evidence: string; inSkillsSection: boolean; alreadyOnProfile: boolean }[];
  unrecognizedSkills: string[];
  experiences: { title: string; employer: string | null; startDate: string; endDate: string | null; description: string | null; alreadyOnProfile: boolean }[];
  education: { level: string; field: string | null; institution: string | null; year: number | null; alreadyOnProfile: boolean }[];
  certifications: { name: string; year: number | null; alreadyOnProfile: boolean }[];
  languages: string[];
  estimatedYearsExperience: number | null;
  sectionsFound: string[];
  warnings: string[];
}
export interface CvAnalysisResult { pages: number; characters: number; ocr?: { used: boolean; confidence: number | null }; parsed: CvDraft }
