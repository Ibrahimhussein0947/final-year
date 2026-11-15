# Sector criteria (Phase 15)

Different sectors hire on different things. A truck driver is hired on a licence class, a nurse on a professional registration, a web developer on a portfolio. Before this phase every job was judged on the same fields (skills, experience, qualification, location, availability, preferences). Sector criteria add the sector-specific questions, for employers and for workers.

## How it works

**Definitions (administrators).** A *criterion* belongs to one sector or to every sector. It has a type (yes/no, number, one option, several options), labels in English/Amharic/Afaan Oromoo, an optional unit and range, whether it may be a hard requirement, and whether a document can verify it. 234 starting criteria are seeded for 20 sectors plus 6 that apply to every sector (`apps/api/prisma/seed/criteria.ts`). Each sector asks about what decides hiring there. Examples: **writers** (kinds of writing, languages written in, published pieces, portfolio samples, press accreditation, SEO, translation language pairs), **security** (type of guard work, guard-training certificate, first aid, fire safety, incident reports, firearm licence only where the employer requires it), **teachers** (subjects, curricula, levels, teaching licence, child-safeguarding training, special-needs and exam-preparation experience), **transport** (vehicle types, licence years, hazardous-goods training, cargo carried), **healthcare** (professional role and registration, life-support training, facility types), **engineering** (registration, discipline, design software, largest project), **legal** (advocate licence, areas of law, court appearances), **social services** (client groups, safeguarding training, donor reporting, data tools), **tourism** (guide licence, guide languages, tour types), **beauty** (services, hygiene certificate, own kit), plus ICT, construction, hospitality, agriculture, business, sales, manufacturing, domestic and general labour.

**New sectors.** Six sectors were added with their own skills (43 skills; together with security, 44 new skill relations): media, writing and creative work; legal and compliance; engineering and technical professions; beauty and personal care; social services and NGOs; tourism and travel. Security gained five skills (patrol, event security, personal protection, incident reporting, fire safety). The new sectors' skill lists are short (5 to 10 each) and need review. Administrators edit, translate and hide them at `/admin/criteria`; nothing is deleted, key, type and sector never change once created.

**Requirements (employers).** In the job form, below the skills, an employer ticks the criteria the work needs and marks each **must-have** or **preferred**. Numbers are minimums, "one option" criteria mean "any of these", "several options" mean "all of these". Some criteria can only be preferences (for example "largest crew led").

**Answers (workers).** On the profile page, "Sector details" lists the questions for the worker's sector plus the shared ones. A question can be left unanswered. Answers are **self-reported** until a worker uploads evidence for a criterion that allows it and an administrator approves it (the same review queue as other verifications); changing a verified answer removes the mark.

**Matching.** A job's criteria become a new, seventh score component, **Sector requirements** (default weight 12%), plus an eligibility check:

| Situation | Effect |
|---|---|
| Criterion met | full credit (must-have counts double a preference) |
| Number below the minimum, or only some of the required options | partial credit, shown as not met |
| Not met | no credit |
| **Not answered** | left out of the score and listed as "not answered" (never counted as zero) |
| A **must-have is known to be unmet** | **not eligible**: score limited to 39, label "Not eligible", not recommended, the explanation says which condition and what the score would have been |
| A must-have is not answered | **eligibility unknown**: stays visible, cannot be rated "strong" |
| Job has no sector criteria | the component does not apply; the score and confidence are exactly as before |

A not-eligible person may still apply; the employer sees the flag. Employers also see the candidate's sector answers with their verified or self-reported marks.

**Default weights changed.** The six original weights were scaled by 0.88 (same ratios) and `criteria` takes 12%. Weights saved before this phase keep their ratios and receive the same 12% share automatically. Administrators edit all seven at `/admin/matching`.

## Job text must be job-related

Criteria describe what the work needs. Job posts that demand a gender, an age range or limit, a religion, an ethnicity, or a marital or family status are **refused** when saved (title, description, benefits, schedule) with a message saying what to write instead, and the job-analysis helper warns while the employer is still typing. A minimum legal working age ("must be 18 or older") and task wording ("lift 20 kg", "female patients") are allowed.

Limits of the guard: it matches explicit English phrasings, so it can miss other wording, will rarely flag legitimate text, and does **not** read Amharic or Afaan Oromoo. It is a safety net, not a classifier; moderators can still remove ads that get through.

## What is verified and what is not

| | State |
|---|---|
| Logic and API | 48 automated tests: 15 unit, 24 through the real API and database (including a writer, a security guard and a teacher, each with their own must-have), and 9 data-quality tests on the seeded list. Covered: must-have, unanswered, partial credit, eligibility, verification, administrator management, the text guard. |
| Screens | Checked by hand in the browser: worker questions (save, persist), employer requirement picker, job page, match panel ("Not eligible" with reason), recommended candidates (only the licensed driver listed), admin criteria page. No automated UI test covers these new components. |
| Starting criteria | **Written by the developer, not by sector experts or regulators.** 354 criteria (5 per sector for the 24 sectors added last) is a lot to get right: some will be missing, wrong for Ethiopia, or worded unlike local practice (licence names and registration bodies are generic on purpose). Sector experts and the relevant authorities must review them before launch; the data-quality tests check consistency and that nothing is about who a person is, not that the content is correct. |
| Translations | Amharic and Afaan Oromoo labels are **empty**; the interface falls back to English. They need native-speaker translation (in the admin page). The new screens' own text (buttons, hints) is English only. |
| Ranking evaluation | Two benchmark jobs (truck driver, nurse) carry must-have criteria. The labels follow the same rule the scorer applies, so this shows the rule is applied consistently, **not** that the rule is right. No real-world evidence yet that sector criteria improve hiring outcomes. |
| Fairness | Criteria are checked for being job-related by policy, not automatically: an administrator could still add an inappropriate criterion. The platform does not collect gender, age or ethnicity, so no group comparison is possible. |

## Limits and next steps
- A criterion cannot be "any of / all of" mixed in one question; a requirement is a single minimum, set of options or yes.
- No sector filter in public job search yet (criteria are not searchable); easy to add.
- Employers cannot yet ask workers free-text screening questions.
- Worker-side wants per sector (shift, housing, pay floor) use the existing preferences; the new criteria describe what workers *have*, not what they *want*.
- Review the starting list with sector experts, translate it, and consider letting training institutions suggest criteria.

## Second batch of sectors (24 added)
Banking and microfinance; real estate; telecommunications; mining, energy and utilities; aviation; import, export and customs; food processing; textile, garment and leather; arts, music and entertainment; sports and fitness; veterinary and animal health; environment and natural resources; water, sanitation and waste; research, science and laboratory; handicrafts; repair services (phones, electronics, bikes); childcare and elder care; public administration; procurement and supply chain; marketing and PR; language and interpretation; delivery and courier; human resources; data, AI and analytics. Total 44 sectors, 258 skills, 127 skill relations, 354 sector criteria.
Honest limits: each new sector has only 4 to 6 skills and 5 criteria, all written by the developer; none is reviewed by a sector expert or regulator, there are no Amharic or Afaan Oromoo labels, and the skill relations between the new sectors are few (26). Existing skills that fit two sectors stay in their first sector (for example solar installation stays in Engineering). Run `npm run db:seed -w @ethiotalent/api` on an existing database to load them; the web category list mirrors the seed and a test checks they match.
