# User guide

EthioTalent AI connects job seekers and employers. This guide covers what each kind of user can do. Screens are in English; Amharic and Afaan Oromoo are partial drafts that have **not** been reviewed by native speakers, so some text may still appear in English.

**Important to know before you start**
- The match score is a **guide, not a decision**. It is calculated from the skills, experience, location, qualification, availability and preferences that are on the profile and the job, and every score comes with the reasons. People make the hiring decisions.
- Skills and qualifications you add are marked **self-reported**. Only an administrator, after checking evidence, can mark something **verified**.
- If information is missing the score says so ("not assessed" / "based on limited information"). Missing information is never counted as zero.
- Semantic (meaning-based) matching is **not active** in this installation unless an administrator has set it up; the screen shows which engine produced a score.

## Job seekers
1. **Register** (`/register`): choose "Job seeker", enter name, phone, password, region and area. You can add an email later.
2. **Build your profile** (`/profile`): headline, occupation, years of experience, skills with a level, education, certificates, work history, where you can work and how far you can travel, availability, expected salary. The completion bar lists what is still missing. You can hide your profile from employers at any time.
3. **Sector details:** under your skills, answer the questions for your sector (for example vehicle licence, professional registration, shifts, tools). Skip what does not apply: unanswered questions are not held against you. Upload proof (PDF or photo) for licences and certificates and an administrator can mark them verified; otherwise they show as self-reported.
4. **Upload a CV** (PDF, up to 5 MB) and press **Read my CV**: the system proposes skills, jobs, education and certificates it found. Nothing is saved until you tick the items you agree with. Scanned (image-only) PDFs cannot be read.
5. **Find jobs** (`/jobs`): search by words, category, region, job type, work arrangement and minimum salary. Save jobs you like (`/saved`).
6. **See why a job fits you:** each job page shows your match with a breakdown and the missing required skills.
7. **Recommended jobs** (`/recommended`) lists the best matches with explanations.
8. **Invitations:** if an employer invites you, it appears at the top of your dashboard with the organization and their message. Nothing about you is shared unless you choose to apply. You can decline.
9. **Apply** with an optional message. Track every application at `/applications`; you can withdraw, and apply again after withdrawing (not after a rejection). Your phone number is shown to an employer only once they shortlist you.
10. **Messages** (`/messages`): chat with an employer once you have applied. Notifications appear in the bell; job alerts (maximum 3 a day) and SMS (only if you turned it on, have a verified phone, and the platform has an SMS provider, which is currently not the case) can be switched off in the dashboard settings.
11. **Analytics** (`/analytics`): your application results and the skills open jobs in your field ask for that you do not list yet.
12. **Report** a job that looks like a scam or is wrong using the Report button on its page.

## Employers
1. **Register** as "Employer" with your organization name and type. Choose the type honestly: government offices, public enterprises and NGOs must be verified before they can publish and follow formal hiring rules (closing date and minimum announcement period, stated pay, a vacancy reference number, an interview and a written reason for each decision). Private companies have no extra rules. The type is fixed once you are verified or have published a job. Add details and verification documents at `/organization`; the **Verified** badge appears only after an administrator approves them.
2. **Post a job** (`/employer/jobs/new`): paste your description and press **Suggest requirements**. The system proposes required and nice-to-have skills, experience, qualification, type, arrangement, language and salary, **each with the sentence it came from**. Tick what is correct and press "Use selected". Then, under "Sector requirements", tick the licences, certificates, shifts or tools the work needs and mark each **must-have** (people who clearly lack it are not recommended) or **preferred**. Job text that asks for a particular gender, age, religion, ethnicity or marital status is refused: describe what the work needs instead. Correct anything wrong: the suggestions are rules and keywords, not a language model, and work for English text. You need at least one required skill, a location (unless remote) and a future deadline to publish.
3. **Publish, close, reopen, mark filled** from `/employer/jobs`. Text copied from another organization is held for administrator review; near-identical reposts need confirmation.
4. **Review applicants** (`/employer/jobs/:id/applications`): sort by match, open a candidate for the full explanation, CV and history, compare two to four applicants side by side. Move people through *under review → shortlisted → accepted / rejected* and schedule interviews. **Hiring board** (`/employer/jobs/:id/board`, "Show as a board"): the same applicants as columns by stage; drag a card to the next stage or use the card's "Move to…" menu (works with a keyboard and on phones). It is only another view: the same moves are allowed as on the list (a rejected or accepted candidate is final and cannot be moved), the same confirmations and written reasons apply, and interviews are still set up on the candidate page, so dropping a card on "Interview scheduled" opens that page. **Interviews** (`/interviews`) is your calendar, with reminders a day and an hour before and a download for your phone calendar (docs/04).
5. **Recommended candidates** (`/employer/jobs/:id/recommended`): workers who match but have not applied. You see no phone numbers or exact addresses here.
5b. **Find workers** (`/employer/workers`, also the "Find workers" link): search workers who chose to be visible by words, sector, skills, region, experience, availability, education, verified evidence and sector answers (a worker who has not answered a question is not shown when you filter on it). Pick one of your open jobs under "Rank by my job" to rank by match, with people who clearly lack a must-have left out. Use **Invite to apply** on a good fit, with an optional short message about the work; the worker decides, and nothing about them is shared until they apply. You can send 20 invitations a day.
6. **Message** applicants once they have applied. Messaging closes (read-only) after a rejection or withdrawal.
7. **Analytics** (`/analytics`): vacancies, applications, recruitment funnel, match quality of applicants, and time to hire.
Use scores to decide **whom to read first**, not whom to reject. A low score may only mean the profile is incomplete.

## Administrators
Open `/admin` (administrator accounts are created by the system operator, see docs/07-deployment.md).
- **Overview:** key numbers and system status (database, AI service, SMS gateway: shown honestly as "not configured" when they are not).
- **Users:** search, suspend (reason required, ends their sessions immediately) and reactivate.
- **Verification:** approve or reject employer documents and worker evidence. Rejections require a note the person can read.
- **Moderation:** handle reports (dismiss, resolve, remove the job, suspend the user) and review jobs held for approval.
- **Hiring rules:** per organization type, set what must be true to publish a vacancy and to accept or reject a candidate; the starting values are reasoned defaults, not legal advice, so confirm them before launch.
- **Sector criteria:** the sector questions used by job forms, profiles and matching; translate and review them (the starting list was written by the developer, not sector experts).
- **Skills and categories, Translations:** edit the taxonomy and interface text without a new release.
- **Matching and AI:** change the matching weights (must add to 100%; global or per category; versioned), and read recommendation performance (observational, not an evaluation).
- **Analytics and reports:** national, privacy-protected numbers (groups under 5 are hidden) and CSV exports. **Activity log:** every administrative action.

## Help and troubleshooting
| Problem | What to do |
|---|---|
| "Invalid or expired token" / signed out | Sign in again; sessions refresh automatically for 30 days of activity. |
| CV "Read my CV" finds nothing | The PDF may be a scan or have an unusual layout. Add details by hand. |
| No recommendations | Add skills and a location to your profile; recommendations need at least one skill that matches a job's required skills. |
| Did not receive a verification code | No SMS or email provider is connected in most installations, so codes are not delivered. Contact the operator. |
| Wrong or unclear Amharic / Afaan Oromoo text | The translations are drafts. Tell an administrator, who can correct them in the Translations page. |
