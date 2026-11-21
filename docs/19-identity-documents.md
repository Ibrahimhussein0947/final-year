# Identity and certificate documents

## What it does
A worker types their details and uploads the paper; the server reads the file and **compares what it can read with what was typed**, then an administrator decides.

1. **Details** (profile page, "Identity and certificates"): father's name, grandfather's name (optional), date of birth. The worker's own name is the one on the account. These are stored in a separate private table (`WorkerIdentity`) and are never returned to employers, never in search results and never in the public profile. API: `GET/PUT /workers/me/identity`.
2. **Birth certificate**: PDF, JPG or PNG up to 5 MB. Compared: the worker's name, the father's name, the date of birth (and the grandfather's name when given).
3. **Education certificate**: uploaded for one education entry (from the entry's "Get verified" button or from the same section). Compared: the worker's name (required), then the school, the year and the level typed on that entry.
4. The answer comes straight back: for each detail ✓ found, ≈ almost (one digit off) or ✗ not found, an overall result, and the review status. A new upload for the same item replaces the one still waiting. API: `POST /workers/me/documents` (multipart: `docType`, `educationId` for education, `file`), `GET /workers/me/documents`, `DELETE /workers/me/documents/:id` (only while waiting).

| Result | Meaning |
|---|---|
| Details match (CONSISTENT) | Every detail we looked for was found. |
| Mostly matches (PARTIAL) | The required details matched but a supporting one (school, year, level) was not found, or a required date differs by a single digit. |
| Details don't match (MISMATCH) | A required detail was not found in text that was read well. |
| Could not be read (UNREADABLE) | Too little text, a poor picture, a file that could not be opened, or a name in Amharic script that the server cannot read from pictures. No verdict is given. |

**Nothing is verified by the machine.** Every upload creates an ordinary verification request (kind `IDENTITY`, or `QUALIFICATION` for education). Only an administrator approving it sets "Identity verified" or marks the education entry verified. Changing the father's name, grandfather's name or date of birth after approval removes the identity mark.

## How the comparison works (`modules/documents/match.ts`)
- **Text:** a PDF's own text when it has some, otherwise OCR (Tesseract) of the picture or the scanned pages. Only the comparison result is stored, with one short line (up to 80 characters) per detail showing what the document says next to what was typed ("Document says: ..."); the rest of the text read from the file is not stored.
- **Names:** every word of the name must appear, ignoring case, accents and punctuation. Small reading mistakes are tolerated (one letter for names of 4 to 6 letters, two for longer ones, none for 3 or fewer).
- **Father's name:** in Ethiopia a person's own name usually contains the father's, so the child's own line would satisfy a plain search. A word that is also in the person's own name must appear **twice** on the document (once as the child, once on the father's line).
- **Dates:** formats `12/03/1995`, `1995-03-12`, `12.03.1995`, `12 March 1995`, `March 12, 1995`, with the day first or the month first. **Ethiopian-calendar dates** (numeric or with month names such as Megabit) are converted to Gregorian before comparing, so `3 Megabit 1987` matches 12 March 1995. A graduation year matches in either calendar (2021, or 2013 or 2014).
- **Misread digits:** OCR confuses digits (a real test read 1995 as 1993 at 93% confidence). A date that differs by exactly one digit is reported as "almost" and sent to a person, never called a mismatch.
- **Fairness to a poor photo:** a missing detail is only a "mismatch" when the picture was read at 60% confidence or better. Below 45% the result is "could not be read".

## Warning signs for administrators (not shown to the worker)
On the Verification page an administrator sees the comparison table, the details the worker typed, and these hints: the **same file uploaded by another account**; the file's hidden information names **image-editing software** (Photoshop, GIMP, Canva and similar); a PDF **made in a word processor** rather than scanned; a very small picture; the same file reused for another document by the same person. They are hints only: a genuine scan can trip any of them, and a careful forger can avoid all of them. They are hidden from workers so they do not become a checklist for getting past the check.

## Honest limits
- **It cannot tell a genuine document from a good forgery.** A fake certificate with the right name, father and date passes the comparison. The real defences are the administrator's own look at the file and, for important cases, contacting the issuing school or office. Nothing here queries a government or school register.
- **Amharic:** OCR is English by default. Amharic certificates read poorly or not at all, and a name typed in Ethiopic script cannot be compared, so those come back "could not be read" and go to an administrator. To read Amharic, put `amh.traineddata` next to `eng.traineddata` in `apps/api/ocr-data/` and set `OCR_LANGS=eng+amh`. The Latin-spelling of a name on an Amharic certificate is not transliterated, so a document in Ge'ez script with a Latin-typed name will not match.
- **Handwriting and stamps** are not read reliably. Photos that are blurry, dark or at an angle give weak results.
- **One-letter spelling variants** (Mohammed and Muhammad) are tolerated only up to the limits above.
- Reading a picture takes a few seconds (up to about a minute), runs one at a time per server, and uploads are limited to 15 per hour per person.
- The date of birth, father's name and the files are personal data: files are kept as private evidence (owner and administrators only, never readable by employers), and the retention and deletion policy still needs deciding before real use.
- Tested with generated PDFs and one generated photo (`documents-api.test.ts`, `document-match.test.ts`: 33 tests). It has **not** been tested on real Ethiopian certificates, which vary widely in layout, language and print quality; try a set of real ones (with permission) before relying on the results.

---

# CV against profile: accept, decline, and the jobs that fit

## What it does
When a worker **uploads a CV** or **applies for a job**, the system compares the CV with the details on the profile (`modules/verification/`).

- **Declined:** a clear contradiction. The CV upload is refused (nothing is kept or attached), or the application is not sent. The person is told exactly why and what to do (correct the profile if it is wrong, or upload the right CV) and can try again at once. Response: HTTP 422, code `PROFILE_MISMATCH`, with `details.reasons`, `warnings` and `fix`.
- **Accepted:** nothing contradicts. The CV is attached, the person sees what matched, and the system immediately finds **the open jobs that fit what they offer and want** (the same ranking as "Recommended for you": skills, experience, location, preferences) and shows them under the CV, with a notification (`cv.accepted`). The employer who later receives an application sees that the CV was checked (`cvCheck` on the notification).
- **Unchecked:** the CV could not be read well enough (too little text, a blurry photo, a name in Amharic script that the server cannot read from pictures). It is kept, never declined, and marked "not checked". No job list is generated from it.
- A worker with **no CV** applies as before: there is nothing to compare.

## When it declines (deliberately narrow)
A CV rarely lists everything a person has done, so a missing skill or a small difference is **not** a reason to decline. Only these are:
1. **Name:** the first two words of the account name are not on the CV (it may be someone else's CV).
2. **Education:** the profile claims two or more levels above the highest education the CV shows (for example Master on the profile, Diploma on the CV), when the CV has an education section.
3. **Experience:** the profile claims five or more years more than the dated jobs on the CV add up to.

These are shown as **warnings** only and never decline: a different phone number or email on the CV, one level of education, three or four years of experience, none of the profile's employers appearing on the CV. The thresholds are constants at the top of `consistency.ts`.

## Staying fair
- The comparison is repeated only when something it looks at changes (name, phone, email, years of experience, education levels, employers): the result is cached with a hash of those details. Correcting the profile and applying again re-reads the CV.
- A CV that cannot be read is never declined. Small reading mistakes in names are tolerated.
- Only the findings are stored (`CvCheck`), not the CV's text.
- `POST /workers/me/cv-check` ("Check again") re-runs it after a correction; `GET /workers/me/cv-check` returns the last result; `GET /workers/me/opportunities` returns the fitting jobs.
- Automatic applying (`autoApply`) skips a worker whose CV is declined, like any other failed application.

## Honest limits
- **This compares the CV with the profile; it does not prove either is true.** A person who invents the same false details on both passes. Verified identity and certificates (above) are what add evidence, and an employer still decides who to hire. The system declines or accepts the *CV and application as consistent*, never the person for a job.
- The CV reader is rule-based (`cvParser`, `rules-1.0`): odd layouts, tables and non-English CVs can be read wrongly, which could make an honest CV look inconsistent. That is why only large contradictions decline, and why the person can always correct the profile and try again. Review the thresholds on real CVs before launch.
- Years of experience come from dated job ranges only; a CV with jobs but no dates is not judged on experience.
- Not built: a person asking for a human to review a declined CV, and showing the check result on the employer's candidate screen (only the notification carries it for now).
