/**
 * Detects job text that demands a particular gender, age range, religion, ethnicity or marital status.
 *
 * Why: sector criteria must be JOB-RELATED (what the work needs), never a statement about who a person is. Local job
 * ads often include such demands, and a matching platform that repeats them would automate the discrimination.
 * The rules below are a SAFETY NET, not a classifier: they catch common explicit phrasings in English, can both
 * miss other wordings and (rarely) flag legitimate text, and do not cover Amharic or Afaan Oromoo text. A person can
 * always rephrase; the message says what to describe instead. Moderators can remove ads that slip through.
 * A plain minimum legal working age ("must be 18 or older") is not flagged.
 */
export type DiscriminationKind = 'gender' | 'age' | 'religion' | 'ethnicity' | 'marital';

export interface DiscriminationFinding { kind: DiscriminationKind; phrase: string }

const GENDER = '(?:males?|females?|men|women|man|woman|ladies|lady|girls?|boys?)';
const RELIGION = '(?:orthodox|muslims?|christians?|protestants?|catholics?|pentecostals?|jehovah|jewish|hindu)';
const ETHNIC = '(?:tigray|tigrayan|oromo|amhara|somali|afar|sidama|gurage|wolayta|hadiya|agew)';

const RULES: { kind: DiscriminationKind; re: RegExp }[] = [
  { kind: 'gender', re: new RegExp(`\\b${GENDER}\\s+(?:candidates?\\s+|applicants?\\s+|workers?\\s+)?(?:only|preferred|required|are\\s+(?:preferred|required|encouraged|welcome\\s+only))\\b`, 'i') },
  { kind: 'gender', re: new RegExp(`\\bonly\\s+(?:${GENDER})\\b`, 'i') },
  { kind: 'gender', re: new RegExp(`\\b(?:must|should)\\s+be\\s+(?:a\\s+|an\\s+)?${GENDER}\\b`, 'i') },
  { kind: 'gender', re: /\b(?:sex|gender)\s*[:=-]\s*(?:male|female|m|f)\b/i },
  { kind: 'age', re: /\b(?:under|below|younger\s+than|not\s+(?:older|more)\s+than|maximum\s+age(?:\s+of)?|max\.?\s+age(?:\s+of)?|age\s+limit(?:\s+of)?|aged?\s+(?:up\s+to|below|under))\s*:?\s*(?:\d{2})\b(?:\s*(?:years?|yrs?)(?:\s+old)?)?/i },
  { kind: 'age', re: /\bage\s*(?:between|range|:|of)?\s*\(?\s*\d{2}\s*(?:-|–|to|and)\s*\d{2}\b/i },
  { kind: 'age', re: /\b\d{2}\s*(?:-|–|to)\s*\d{2}\s*(?:years?|yrs?)\s*(?:old|of\s+age)\b/i },
  { kind: 'age', re: /\b(?:young|youthful)\s+(?:and\s+\w+\s+)?(?:candidates?|applicants?|men|women|people)\s+only\b/i },
  { kind: 'religion', re: new RegExp(`\\b${RELIGION}\\b[^.\\n]{0,25}\\b(?:only|required|preferred)\\b`, 'i') },
  { kind: 'religion', re: new RegExp(`\\b(?:must|should)\\s+be\\s+(?:a\\s+|an\\s+)?${RELIGION}\\b`, 'i') },
  { kind: 'ethnicity', re: new RegExp(`\\b(?:from|of)\\s+(?:the\\s+)?${ETHNIC}\\s+(?:origin|ethnic\\w*|tribe|only)\\b`, 'i') },
  { kind: 'ethnicity', re: /\b(?:ethnic(?:ity)?|tribe)\b[^.\n]{0,20}\b(?:only|required|must)\b/i },
  { kind: 'marital', re: /\b(?:single|unmarried|married|not\s+married|no\s+children|without\s+children)\s+(?:candidates?\s+|applicants?\s+|women\s+|men\s+|females?\s+|males?\s+)?(?:only|required|preferred)\b/i },
  { kind: 'marital', re: /\bmarital\s+status\b/i },
  { kind: 'marital', re: /\bnot\s+pregnant\b/i },
];

export function detectDiscrimination(...texts: (string | null | undefined)[]): DiscriminationFinding[] {
  const text = texts.filter(Boolean).join('\n');
  const found: DiscriminationFinding[] = [];
  for (const { kind, re } of RULES) {
    const m = text.match(re);
    if (m && !found.some((f) => f.phrase.toLowerCase() === m[0].toLowerCase())) found.push({ kind, phrase: m[0].trim() });
  }
  return found;
}

const WHY: Record<DiscriminationKind, string> = {
  gender: 'a gender requirement',
  age: 'an age requirement',
  religion: 'a religion requirement',
  ethnicity: 'an ethnicity requirement',
  marital: 'a marital-status or family requirement',
};

/** A sentence for the employer: what was found and what to write instead. */
export function discriminationMessage(findings: DiscriminationFinding[]): string {
  const list = findings.map((f) => `"${f.phrase}" (${WHY[f.kind]})`).join('; ');
  return `This text contains ${list}. Job posts may only describe what the work needs (skills, licences, certificates, shifts, physical tasks), not who the person is. Please rewrite it.`;
}
