# Job offers: offer, accepted, started

## What it does
After an employer accepts an application (the existing step, with its hiring rules), they can write the **terms** in the app: first day, pay per month (optional) and a short note. The worker sees it under *My applications*, accepts or declines, and on or after the first day either side confirms that work **started**.

| Status | Meaning |
|---|---|
| OFFERED | waiting for the worker's answer, until the "answer by" date (default 7 days, never later than the start date) |
| ACCEPTED | the worker said yes |
| DECLINED | the worker said no (the employer may send a new offer; it reuses the same record) |
| WITHDRAWN | the employer took it back, before or after it was accepted, until work has started |
| EXPIRED | nobody answered by the date (set when read or by the sweep) |
| STARTED | either side confirmed the person began work (possible from the first day) |

API: `POST /applications/:id/offer`, `GET /offers/sent`, `POST /offers/:id/withdraw` (employer); `GET /offers/mine`, `POST /offers/:id/respond {accept}` (worker); `POST /offers/:id/started` (either). Code: `modules/offers/`.

## Reminders (`runOfferChecks`, every 30 minutes while the server runs)
- an unanswered offer is marked EXPIRED after its date and the employer is told;
- the worker is reminded once, the day an unanswered offer is due or the day before;
- both sides are reminded once, the day before the first day (or on the day itself if the offer came later).
Each reminder is claimed with a flag first, so a second runner or a repeat never sends it twice. Dates are calendar days in Ethiopian local time (UTC+3). SMS text is generic ("you have a job offer", "a reminder about your job offer") and carries no pay, name or note.

## Decisions worth knowing
- **An offer only exists for an ACCEPTED application.** Accepting the offer does not bypass the hiring rules (a written reason, a closed announcement, a recorded interview): those stay in the application workflow.
- The employer's note is shown **only to the worker**. Pay is optional ("as advertised" when empty).
- "Started" can be confirmed by either side and is not disputed; there is no "no-show" mark on purpose, because a label like that could unfairly follow a worker.

## Honest limits
- It is a record and a reminder, **not a contract**. Nothing here is legally binding or checked, and the platform does not hold or move money.
- One offer per application. A declined, withdrawn or expired one can be re-sent (the old terms are replaced; there is no history of earlier versions).
- Accepting an offer does not close the job or reduce its vacancies, and there is no automatic reply to the worker's other applications.
- Reminders are in-app plus the generic SMS only if an SMS gateway is connected (none is yet).
- Tests: `offers.test.ts` (8, API) and one text test (web). The new screens were not checked in a logged-in browser.
