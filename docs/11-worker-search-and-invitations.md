# Worker search and invitations (Phase 16)

Before this phase an employer could only see workers who applied, or the recommendation list for one job. Now an employer can search the workers who chose to be visible, and invite good fits to apply.

## Worker search (`/employer/workers`, API `GET /talent/search`)

The public "Find workers" link takes a signed-in employer here. Filters (all optional, combined with AND):

| Filter | Behaviour |
|---|---|
| Search words | headline, occupation, bio, or a skill's name or alias contains the words |
| Sector | the worker's main category |
| Skills | up to 10; "must have all" (default) or "any" |
| Region / zone | the chosen place or anything inside it |
| Years of experience | at least |
| Available | now, within 2 weeks, within a month |
| Education | at least a level (someone with any entry at or above it) |
| Verified | has at least one skill, qualification or sector answer verified by an administrator |
| **Sector answers** | for the chosen sector's questions (licence, shifts, tools...): keep only workers who answered the way you tick. **An unanswered question does not count as a yes.** |
| **Rank by my job** | one of your open jobs: results are ranked by match to it, people who clearly lack a must-have for it are left out, and each card shows the score, the reasons and whether you already invited them or they applied |

Without a job, results are ordered by profile completeness, then recency. Results are paged (12 per page, at most 24).

### Privacy
Same rules as the recommendations: only workers who chose to be visible and whose accounts are active; name, headline, region and zone, skills, years, availability, verified counts. **Never** phone, email, exact position, CV or any file. Searching does not count as a profile view (opening a profile does). A phone number is revealed only when the employer shortlists a worker who applied. Searches are rate limited (60 a minute per employer).

## Invitations to apply (`POST /jobs/:id/invitations`)

An employer can invite a worker to one of their **open** jobs, with an optional message of up to 300 characters.

- The worker gets a notification and an "Invitations to apply" card on the dashboard with the job, the organization (not a person), whether it is verified, and the message. They can view and apply, or decline.
- **An invitation is not an application and shares nothing about the worker.** Contact details and the CV are shared only if the worker applies, as before. Messaging still opens only after an application.
- Refused with a clear reason when: the job is not open; the worker is hidden, suspended or unknown; they already applied; they were already invited, or declined; the worker is known to lack a must-have for the job; the message asks for a gender, age, religion, ethnicity or marital status (same guard as job posts).
- Limit: 20 invitations a day per employer.
- When the worker applies, the invitation becomes "applied"; the employer sees the status per worker.

## What is verified and what is not

| | State |
|---|---|
| Logic and API | 17 automated tests against the real database: access control, every filter, hidden and suspended workers, no contact details or coordinates in results, paging, ranking by a job and must-have exclusion, invitations (all refusal cases, daily limit, decline, applied, roles). |
| Screens | Checked by hand in the browser: search with a job ranking, invite, and the worker's dashboard card. No automated UI test covers the new pages. |

## Limits, stated plainly
- **Text search is simple matching**, not semantic: "driver" finds the word, not "chauffeur". It does not use the embedding model.
- **Only the best-completed profiles are examined.** At most 400 candidates are pulled from the database before sector answers and job ranking are applied; when more match, the page says so and asks for more filters. People with thin profiles are therefore harder to find when no job is chosen, which favours well-documented workers. Ranking by a job reduces but does not remove this.
- Names are shown to employers in results (as in recommendations). Workers can hide their profile entirely; there is no per-employer blocking yet.
- Invitations reach a worker in the app only. No SMS or email is sent (no provider), so a worker who does not sign in will not see one.
- Built since: inviting several people at once (tick workers in the search, one shared message, up to 20; every person goes through the same checks as a single invitation, one failure never blocks the others, and a plan or daily limit stops the rest with the reason shown per person; `POST /jobs/:id/invitations/bulk`), saved searches with alerts for workers, and workers seeing which organizations viewed them. Messaging before applying is built, started by the worker only (docs/04). Not built: employer-initiated messages to workers who were not invited.
- Search results and ordering are not yet evaluated for fairness between groups (education, region, experience); the Phase 13 method could be applied to it.
