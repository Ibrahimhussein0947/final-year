# Organization types: the picker, documents to prepare, search by kind, and the admin list

This complements docs/12-hiring-rules.md, which describes what each type is *allowed to do* (verification, closing dates, written reasons...). This page describes how people **choose, find and administer** the types.

## The kinds of employer

Types are grouped so that people find theirs. The labels, descriptions and "documents to prepare" are written by the developer, are **not legal advice** and have not been checked against Ethiopian regulation. The administrator decides what counts as acceptable proof.

| Group | Types |
|---|---|
| Businesses | Private company · Small or medium business · Cooperative or association |
| Government and public bodies | Public company or state-owned enterprise · Government office or agency |
| Non-profit and international | NGO or international organization (including embassies and UN agencies) |
| Individuals and households | Individual hiring for themselves · Household (family) |
| Agencies | Recruitment agency |
| Schools and training | Training institution (school, college, TVET) |

"Public company" was read as a publicly owned or state-owned enterprise, or a company owned by many shareholders (the label says both). Four older industry-flavoured values (construction company, factory, hotel or restaurant, agricultural organization) are kept for existing accounts but **no longer offered to new ones**: industry is expressed by the sector of each job, and new accounts choose "Private company". Individuals are a first-class kind: a person can register and hire a driver, a tutor or a household worker without pretending to be a company, and the form asks for "your name or household name".

## What the screens now do
- **Registration** (`/register?role=employer`) and the **Organization page**: a grouped picker, a one-line explanation of the chosen type, and, for formal types, the hiring rules that will apply. The Organization page's verification card lists the **documents to prepare for that type** (for a government office: an official letter authorising recruitment and an office ID; for an individual: a valid ID).
- **Job search** (`/jobs`): a "Kind of employer" filter (`?employerGroup=individual|business|public|nonprofit|agency|institution`). Job cards and pages show who is hiring ("Government vacancy", "Individuals and households") for anyone who is not an ordinary business.
- **Administrator, Organizations** (`/admin/organizations`): every organization by kind with counts per group (organizations, verified, waiting for review), filters by kind, type, verification and name, and a per-row type correction (confirmed, audited, and it changes which hiring rules apply).

## API
`GET /organization-types` (public): groups, and for each type its label, description, documents, whether it is legacy, the policy label and the rules in plain words. `GET /jobs?employerGroup=...`. `GET /admin/organizations` (administrator): paged, filtered, with a summary per group.

## What is verified and what is not
| | State |
|---|---|
| API | 7 automated tests (`org-directory-api.test.ts`): the catalog describes every type the database knows (adding a type to the schema without describing it fails the test), grouping, rules in plain words, the employer-kind job filter, and the administrator list (filters, paging, summary, access control). |
| Screens | Checked by hand in the browser: grouped picker with legacy values hidden, help text for individual and government, job filter and card badge, administrator list. No automated UI test covers them. |
| Content | Labels, descriptions and documents are the developer's wording and need review by someone who knows Ethiopian registration practice. |

## Limits
- Verification is a manual review of an uploaded document, not a check against a government register.
- There is no separate sub-type for "publicly listed company": it would be treated like a private company.
- "Individual" and "household" have no extra restrictions yet (for example a limit on live jobs); both are subject to the same scam reporting and moderation as every employer.
- Documents are suggestions shown to the employer, not a checklist the system enforces; the administrator decides.
