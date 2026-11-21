/**
 * Rule-based scam check for job postings. Explainable by design: every point of the score comes from a named signal that
 * an administrator can read. It is a screening aid, not a verdict: a job at or above HOLD_THRESHOLD is held for human review
 * (never deleted automatically), and a clean score does not prove a job is genuine.
 *
 * Phrases are English plus common Amharic wording. Text that denies the behaviour ("no registration fee", "we never ask
 * for money") is removed before scanning so honest employers are not flagged for saying so.
 */

export type ScamSignal = { code: string; label: string; weight: number; evidence: string };
export type ScamResult = { score: number; flagged: boolean; signals: ScamSignal[] };

export const HOLD_THRESHOLD = 40;

type Rule = { code: string; label: string; weight: number; re: RegExp };

const RULES: Rule[] = [
  {
    code: 'UPFRONT_FEE',
    label: 'Asks the applicant to pay money (fee, deposit or "processing") before work',
    weight: 50,
    re: /\b(registration|application|processing|training|admin(?:istration)?|medical|visa|agency|security)\s+(fee|fees|payment|deposit|charge)s?\b|\b(pay|send|transfer|deposit)\s+(a\s+|the\s+|some\s+)?(fee|money|deposit|birr|etb)\b|\bpay\s+(first|before|upfront|in advance)\b|\badvance payment\b|የመመዝገቢያ ክፍያ|ክፍያ (ይክፈሉ|መክፈል)|ገንዘብ (ይላኩ|ላኩ)/i,
  },
  {
    code: 'SENSITIVE_DATA',
    label: 'Asks for a passport, bank details, password or one-time code in the posting',
    weight: 40,
    re: /\b(send|share|give|provide)\s+(us\s+)?(your\s+)?(passport|bank (account|details)|atm|pin|password|otp|verification code|telebirr (pin|account))\b|\bcopy of (your )?(passport|id card)\b.{0,30}\b(whatsapp|telegram|email)\b/i,
  },
  {
    code: 'ABROAD_OFFER',
    label: 'Promises work abroad, a visa or a free ticket',
    weight: 20,
    re: /\b(work abroad|overseas (job|work|employment)|visa sponsorship|free (visa|ticket|flight)|ticket (is )?provided|dubai|saudi|kuwait|qatar|lebanon|oman|bahrain)\b|ወደ ውጭ (አገር )?|ዱባይ|ሳዑዲ|ኩዌት|ኳታር|ሊባኖስ/i,
  },
  {
    code: 'MESSAGING_APP',
    label: 'Moves the conversation to WhatsApp, Telegram or a free email address',
    weight: 20,
    re: /\b(whats\s?app|telegram|viber|imo)\b|t\.me\/|wa\.me\/|[\w.+-]+@(gmail|yahoo|hotmail|outlook|ymail)\.[a-z]{2,}/i,
  },
  {
    code: 'CONTACT_IN_TEXT',
    label: 'Puts a phone number in the description, which bypasses the platform',
    weight: 15,
    re: /(?:\+?251|\b0)[\s-]?9(?:[\s-]?\d){8}\b/,
  },
  {
    code: 'GUARANTEED_INCOME',
    label: 'Guarantees high or easy income',
    weight: 25,
    re: /\b(guaranteed (income|salary|job|earnings?)|easy money|earn (up to )?[\d,]+\s*(etb|birr|usd|\$)\s*(per|a|\/)\s*(day|week)|get rich|100% (guaranteed|job)|no (experience|skills?) (needed|required).{0,40}(high|big) (salary|pay))\b/i,
  },
  {
    code: 'SHORT_LINK',
    label: 'Contains a shortened or redirecting link',
    weight: 15,
    re: /\b(bit\.ly|tinyurl\.com|cutt\.ly|rebrand\.ly|goo\.gl|shorturl\.at|is\.gd)\//i,
  },
  {
    code: 'PRESSURE',
    label: 'Uses pressure tactics ("limited slots", "today only")',
    weight: 10,
    re: /\b(limited (slots|seats|positions)|hurry|today only|last chance|act now|only \d+ (slots|seats|positions) left)\b/i,
  },
];

/** Removes honest statements such as "no registration fee" so they are not mistaken for the fee itself. */
function stripDenials(text: string): string {
  return text
    .replace(/\b(no|without|never|not|free of|zero)\s+(any\s+)?(\w+\s+){0,2}(fee|fees|payment|payments|charge|charges|deposit|money)\b/gi, ' ')
    .replace(/\b(we|company|employer)\s+(do|does|will)\s*(not|never|n't)\s+(ask|charge|request)[^.!?\n]{0,60}/gi, ' ')
    .replace(/ክፍያ (የለውም|አያስፈልግም)/g, ' ');
}

export type ScamInput = { title: string; description: string; benefits?: string | null; schedule?: string | null };

export function scanJobText(input: ScamInput): ScamResult {
  const original = [input.title, input.description, input.benefits ?? '', input.schedule ?? ''].join('\n');
  const text = stripDenials(original);
  const signals: ScamSignal[] = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) signals.push({ code: rule.code, label: rule.label, weight: rule.weight, evidence: m[0].trim().slice(0, 60) });
  }
  // Shouting: a long run of capitals or repeated exclamation marks is a weak signal on its own.
  if (/!{3,}/.test(original) || /\b[A-Z]{4,}(?:\s+[A-Z]{4,}){4,}\b/.test(original)) {
    signals.push({ code: 'SHOUTING', label: 'Written mostly in capitals or with many exclamation marks', weight: 5, evidence: '' });
  }
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  return { score, flagged: score >= HOLD_THRESHOLD, signals };
}
