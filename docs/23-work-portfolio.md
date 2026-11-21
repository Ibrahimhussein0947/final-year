# Photos of finished work (portfolio)

## What it does
A worker adds up to 8 photos of their own finished work (a cabinet, a dress, a repaired engine), each with an optional caption (120 characters) and one of their skills. Employers see them in a gallery on the worker's profile, labelled "Shown by the worker. Nobody has checked that the work is theirs."
API: `GET/POST /workers/me/portfolio` (multipart: `file`, `caption`, `skillId`), `PATCH/DELETE /workers/me/portfolio/:id`. The employer's view of a profile carries `portfolio`. Code: `modules/workers/portfolio.ts`, `modules/files/safeImage.ts`.

## Privacy and safety
- **Every picture is decoded and re-encoded** as a JPEG of at most 1600 pixels on the long side. That throws away hidden metadata (camera, date and **GPS position**), so an employer never learns where a photo was taken, and it refuses files that only look like pictures. A transparent PNG gets a white background.
- Pictures are private files: the owner, administrators and **employers only while the worker's profile is visible** (and the account active) can open them. Hiding the profile hides the pictures from employers at once. Other workers and anonymous visitors cannot.
- Deleting a picture, or the account, deletes the file.

## A server-crash risk found and closed
The native image library (`@napi-rs/canvas`) **crashes the whole Node process** (a segmentation fault, with no error to catch) on some corrupt files, for example a PNG with a valid header and a damaged body. This was already reachable before this feature through the CV and document reader (`analysis/ocr.ts`), which decoded uploaded pictures in-process: one bad upload could have taken the server down for everyone.
- Fix: `files/safeImage.ts` decodes untrusted pictures in a throwaway child process (20 second limit). If the child dies the upload is refused with a normal 415 error. The portfolio re-encodes through it, and the CV/document picture reader now checks the picture with it before decoding in-process.
- Cost: about a quarter of a second for each picture on the CV and document path. If that matters, the child process could be kept warm.
- Not checked: other places that decode pictures in-process, such as the ID/document comparison. Only `analysis/ocr.ts` was found (`grep loadImage`).

## Honest limits
- Self-reported. Nothing checks that the photo is the worker's own work, or that it shows what the caption says. Anyone could upload someone else's photo.
- **No moderation**: an unsuitable picture is only caught if someone reports the worker's profile (the existing user report). Nothing looks at what the picture shows. Consider an administrator view before real use.
- Photos are not part of the match score, trust level or profile completion.
- Pictures are not resized into thumbnails: the gallery loads the full re-encoded image (usually under a few hundred KB).
- Tests: `portfolio.test.ts` (6, API). The new screens were not checked in a logged-in browser.
