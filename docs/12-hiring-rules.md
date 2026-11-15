# Hiring rules by organization type (Phase 17)

How an organization may announce a vacancy and decide on candidates depends on what kind of organization it is: a government office follows formal recruitment rules, a private company decides freely. The platform now knows the type and enforces the rules that belong to it.

## Organization types
Private company · Public or state-owned enterprise · Government office or agency · NGO or international organization · Small or medium business · Construction company · Factory · Hotel or restaurant · Agricultural organization · Household · Individual employer · Recruitment agency · Training institution · Cooperative or association.

"Public company" was read as a **public or state-owned enterprise**. If you meant a publicly *listed* (shareholder) company, that is a different thing and would normally be treated like a private company; tell me and the labels can change.

## The rules (one row per type, edited by administrators at `/admin/hiring`)

| Rule | Effect |
|---|---|
| Must be verified to publish | The organization needs an approved verification (administrator reviewed documents) before a vacancy can go live |
| Closing date required | A vacancy cannot be published without a closing date |
| Minimum announcement days | The closing date must be at least this many days after publishing, and **nobody can be accepted before the closing date** (shortlisting and interviews can happen meanwhile). Pulling the closing date forward on a live vacancy is refused |
| Salary or pay scale required | A salary range must be stated (also kept on later edits) |
| Vacancy reference number required | Like a formal announcement; unique within the organization; shown on the job page |
| Written reason to decide | Accepting **and rejecting** a candidate needs a reason of at least 10 characters; it is stored with the decision in the application history |
| Interview before hiring | An interview must be recorded (and not cancelled) before a candidate can be accepted |
| Label | Text shown as a badge on the job page, for example "Government vacancy" |

### Starting values (reasoned defaults, **not legal advice**)

| Type | Announcement | Verified | Closing date | Pay | Reference | Written reason | Interview |
|---|---|---|---|---|---|---|---|
| Government office or agency | 10 days | yes | yes | yes | yes | yes | yes |
| Public or state-owned enterprise | 7 days | yes | yes | yes | yes | yes | yes |
| NGO or international organization | 7 days | yes | yes | no | no | yes | yes |
| Recruitment agency | none | yes | yes | no | no | no | no |
| Training institution | none | yes | yes | no | no | no | no |
| All others (private, SME, household, and so on) | none | no | no | no | no | no | no |

**These numbers were written by the developer. They were not checked against Ethiopian public-service, civil-service or labour regulations.** A legal adviser and the relevant authorities must confirm them, then administrators adjust them in the console; changes apply at once and are recorded in the activity log. Existing edits are never overwritten when the seed is run again.

## Where the rules are enforced
- **Publishing and editing a live vacancy** (`POST /jobs/:id/publish`, `PATCH /jobs/:id`): the response lists each unmet rule next to the field it concerns, in plain words.
- **Accepting or rejecting a candidate** (`PATCH /applications/:id/status`): refused with a clear code (`ANNOUNCEMENT_OPEN`, `INTERVIEW_REQUIRED`) or a "written reason" message.
- **Screens:** the job form and the organization page show the rules for the organization's type; the applicants page and candidate page explain what is needed, and the Accept and Reject buttons ask for the reason when it is required.

## The organization type cannot be switched to escape the rules
An employer can change the type freely only until they have been verified (or applied for verification) or have published a job. After that only an administrator can change it (`PATCH /admin/organizations/:id/type`), and the change is audited. Registering as a government office does not by itself prove anything: those types must be verified before they can publish.

## What is verified and what is not
| | State |
|---|---|
| Rules and API | 17 automated tests against the real database: every rule for government, public enterprise and NGO, private companies unaffected, editing live vacancies, written reasons, announcement period, interview requirement, reference numbers, administrator edits applying at once, access control and the type lock. |
| Screens | Checked by hand: a government employer sees its rules on the job form; the administrator rules page lists all 14 types. No automated UI test covers them. |
| Legal correctness | **Not checked.** See the warning above. |

## Limits and not built
- Rules apply to the **type**, not to individual organizations: a particular ministry cannot have its own exceptions.
- There is no multi-person approval (for example an HR officer proposes and an authorised approver signs off); one signed-in user decides. This is a common requirement in the public sector and would be the next step.
- No written examination, scoring sheet or selection-panel record, no quota or priority-group rules, and no appeals process.
- A government employer is trusted to select the correct type until verified; verification is a manual administrator review of documents, not a check against a government register.
- The minimum announcement period is measured from when the vacancy is published, in Ethiopia time (UTC+3), on the Gregorian calendar; the Ethiopian calendar is not used.
