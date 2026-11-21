# Interview calendar and reminders

## What it does
- **Calendar page** (`/interviews`, "Interviews" in the header) for workers and employers: a Monday-first month grid with the number of interviews per day, the chosen day's interviews (time, who, job, in person / phone / video, place or link) and a "Coming up" list. A worker sees the organization; an employer sees the candidate by name. No phone numbers.
- **Reminders** in the app (and a generic SMS to the worker if an SMS gateway is configured): about a day before and about an hour before, to the worker and to the employer who posted the job. Sent at most once per window; an interview booked less than a day ahead skips the day reminder, less than an hour ahead gets none (the booking notice already told the worker). Cancelled interviews and rejected or withdrawn applications get none. Runs every 5 minutes inside the API process (`startReminderLoop`).
- **Reschedule** from the candidate page: changes the time, type or place, starts the reminders over and tells the candidate ("Interview moved").
- **Clashes:** a candidate cannot be booked within an hour of another interview of theirs (the message does not say who with); an employer double-booking their own diary only gets a warning.
- **Calendar file:** `.ics` download (`GET /api/v1/interviews/mine.ics`) for Google Calendar, Outlook and phone calendars, one-hour events with a one-hour alert.
- API: `GET /interviews/mine?from&to`, `PATCH /applications/:id/interviews/:interviewId`.

## Video interviews
- Set `VIDEO_BASE_URL` (https only; a self-hosted Jitsi Meet is recommended) and the interview form offers "Make a private video room for me" for video calls. The platform only builds a link on that address with a random, unguessable room name (`https://<host>/et-<24 hex>`); it never carries audio or video itself, and it is not a video service. Without `VIDEO_BASE_URL` the option is hidden and employers paste their own Meet, Zoom or Teams link, as before.
- Both the worker and the employer get a **"Join video call"** button on `/interviews`. The server hands out the link (`GET /interviews/:id/join`) only to the two people in that interview, from 15 minutes before the start until 2 hours after; outside that the page says when it opens.
- A made room keeps the same link when the time is moved, and is dropped if the interview becomes a phone or in-person one.

## Honest limits
- **Anyone who has a room link can join it** (there is no waiting room or login in this feature). The link is unguessable and shown only to the two parties, but it is also in the `.ics` file and in the interview text, so treat it as private. Whether the room has a lobby, passwords or recording depends on the meeting service you point it at. The public `meet.jit.si` requires a moderator to sign in, which is why a self-hosted or other service is advised.
- No call was made in testing: the tests check the link, the access rules and the time window, not a real video session or its quality.
- Reminders run in the single API process: if the server is down at the time they are skipped for that window, and several API processes would race (each reminder is claimed in the database first, so none is sent twice).
- Interviews have no end time or time zone in the data: calendars show one hour, and times display in the viewer's device time zone. Ethiopian-calendar dates are not used.
- The `.ics` file is a download, not a live subscription; a changed interview needs a new download.
- **Candidate answer:** on `/interviews` a worker can press "I can come" or "I can't come" (with an optional reason of up to 300 characters) for any upcoming scheduled interview, and can change their answer until the time passes. The employer sees "Candidate confirmed", "Candidate can't attend" (with the reason) or "Waiting for the candidate" on their calendar and gets an in-app notification (`interview.responded`). Moving the time clears the answer and asks again. API: `POST /interviews/:id/respond {response: CONFIRMED|DECLINED, note?}` (workers only; 404 for anyone else's interview, 409 once the time has passed or the application is closed). A decline does **not** cancel the interview or change the application: the employer decides whether to move or cancel it, and reminders still go out until they do. No SMS is sent for an answer (no provider).
- Not built: employer working hours, email reminders (no provider), and reminders for several colleagues in one organization (only the job's poster is reminded).
