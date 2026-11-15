# Messaging, notifications and real-time (Phase 11)

## What is built

| Feature | How |
|---|---|
| In-app messaging | One conversation per application between the applying worker and the job's employer. REST API plus a Messages page with unread counts, "Sent / Seen" receipts, paging of older messages, and a read-only mode when the application ends. |
| Real-time push | Socket.IO attached to the API server. Pushes `message:new`, `message:read` and `notification:new` to the right person instantly. |
| Notifications | Stored in the database (so nothing is lost if you are offline), shown in a bell menu with an unread count, toasts for live events, and the dashboard list. Types: application received/withdrawn/status, interview scheduled/moved/cancelled/reminder, new message, job recommendation. |
| Job-match alerts | When a job first goes live, the best-matching workers (score 60+, enough profile information) get an alert. Opt-out in settings, at most 3 a day per worker, never repeated when a job is reopened. |
| SMS (optional) | A generic JSON gateway adapter. **Off unless `SMS_GATEWAY_URL` and `SMS_GATEWAY_TOKEN` are set.** |
| Settings | Workers can switch job alerts off; anyone can opt in to SMS (verified phone required). The screen says plainly when no SMS provider is configured. |

## Design decisions (and why)

- **Messaging needs an application, or an invitation the worker chooses to answer.** (Before applying: an employer invites a worker to a job; only the *worker* can then start a chat, with "Ask a question" on the dashboard, so contact never begins without their consent. The employer can reply once the worker has started it, and cannot open it before. The chat shows "before applying", is read-only if the worker declines or the job closes, and carries on in the same thread if the worker applies. Details below apply to application chats.) An employer and a worker can write to each other only once the worker has applied to that employer's job. No cold messages to strangers, no spam inbox, and contact never starts without the worker's consent (applying). Messaging a *recommended worker who has not applied* is deliberately not supported yet; an "invite to apply" flow would need its own anti-abuse rules.
- **Ended applications are read-only.** After a rejection or withdrawal nobody can add messages, but both sides can still read the history.
- **Notifications never contain message text.** "3 new messages from Sara" only. Unread message notifications collapse to one per conversation.
- **SMS text is generic and contains no user-written content.** Job titles, names and messages are written by other users and could carry phishing or spam; texts say only that an interview was scheduled or an application status changed. Limits: opt-in, verified phone, 5 per day. Delivery failures are logged and never block the action.
- **Events are hints, not the data.** Every event is also stored; on (re)connect the client refetches, so a dropped connection loses nothing.
- **Socket security.** A valid access token is required to connect; each user joins only their own room; clients cannot publish events; the server closes a connection when its token expires and the client reconnects with a refreshed one; suspended accounts are refused.
- **Deleting an account.** Its sent messages are deleted with it (right to erasure), and a conversation is deleted together with its application. Both were found missing during testing and fixed with migrations.

## Honest limits

- **No SMS provider is connected**, so no text message has ever been sent by this system. The adapter posts `{to, text, sender}` with a bearer token to a gateway URL and is tested against a mock server only. Ethio Telecom, Safaricom Ethiopia and SMS aggregators each have their own API; a real deployment needs an adapter written against the chosen provider's documentation and credentials, plus sender-ID registration and costs.
- **No push notifications to closed browsers/phones** (no service worker / Web Push). Live updates need the page to be open; otherwise users see items on their next visit (or SMS if configured).
- **Single server.** Socket.IO rooms live in one process. Running several API instances needs the Redis adapter (planned for deployment, Phase 14).
- **Job-match alerts run during publishing** (up to about 30 candidates are scored), which adds some latency to "Publish". A background queue is the production answer.
- **Typing indicators, attachments, message editing/deleting, message reporting and blocking are not implemented.** Reporting arrives with the moderation work in Phase 12.
- Read receipts are per message, set when any other participant opens the thread.
- Notification and message text is English only so far; the i18n files do not yet cover these screens.
- Messages are stored as plain text and shown escaped, so markup typed into a message is displayed literally and never runs. Messages are not end-to-end encrypted; administrators with database access could read them.

## Interview calendar and reminders
- **Calendar** at `/interviews` for workers and employers: a month grid and a day/upcoming list (`GET /interviews/mine`). Workers see the organization, employers see the candidate; never a phone number. **Add to my calendar** downloads a `.ics` file (`GET /interviews/mine.ics`, one-hour events with a one-hour alert) that Google Calendar, Outlook and phone calendars import. It is a download, not a live subscription: it does not update by itself.
- **Reminders:** about a day ahead and about an hour ahead, to the worker and to the employer who posted the job, in the app (and a generic SMS to the worker when SMS is configured). Each reminder is sent once per interview; a last-minute booking skips the day reminder. A timer in the API process checks every 5 minutes (`startReminderLoop`), so a reminder can arrive up to about 5 minutes late and nothing is sent while the server is down; several servers do not double-send (the reminder is claimed in the database first).
- **Changing a time:** "Change" on the candidate page moves an interview, restarts its reminders and tells the candidate.
- **Clashes:** a candidate cannot be booked within an hour of another interview of theirs (the message does not say with whom); the employer only gets a warning for their own other interviews close to the new one.
- Not built: end times (calendars show one hour), time-zone choice (shown in the device's time zone), video-call rooms (a link is typed in), and the worker confirming or declining an interview time.
