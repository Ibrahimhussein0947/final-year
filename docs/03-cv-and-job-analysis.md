# CV and job description analysis (Phase 10)

Code: `apps/api/src/modules/analysis/`. Method label in every response: `rules-1.0`.

## What it is, and what it is not

Both analyzers use **keyword and pattern rules plus the skill taxonomy**. They are not language models and do not understand text. This is deliberate for a first version: it is fast, free, explainable (every suggestion carries the sentence it came from), works offline, and does not need the Python AI service. The UI says so on both screens. A model-based extractor could later replace or complement it behind the same endpoints.

Nothing is ever saved automatically. The employer or worker reviews each suggestion, edits it, and chooses what to keep.

## Job description analysis (employer)

`POST /api/v1/analysis/job` with `{title?, description}` returns suggestions, none of which are stored:

| Suggestion | How it is found |
|---|---|
| Skills | Taxonomy names and aliases, whole-word, case-insensitive (very short terms like HR/JS need capitals). Required vs nice-to-have from cue words in the same **sentence** ("must", "required" / "advantage", "preferred") or from a "Requirements:" / "Nice to have:" heading above the line. A skill with no cue is assumed required, at medium confidence. |
| Minimum experience | "3 years of relevant experience", "at least 2 years", "experience: 4 years", ranges (takes the lower bound). "No experience required", "entry level", "fresh graduates welcome" give an explicit *no minimum* rather than nothing. |
| Qualification | PhD, master, bachelor/degree, diploma, TVET/vocational, grade 10/12. If several are named ("Diploma or Bachelor") the lowest is suggested and the employer is told. "Diploma (TVET)" counts as one diploma. "No certificate required" gives none. |
| Employment type, work mode | Keyword tables (internship, seasonal, daily labour, temporary, contract, freelance, part-time, full-time; hybrid, remote). Defaults (full-time, on-site) are returned with `low` confidence and are not pre-selected. |
| Category | Vote of the categories of the recognised skills, title words break ties. |
| Languages, salary | Amharic, Afaan Oromoo, English, Tigrinya, Somali, Afar, Arabic; "6,000 - 9,000 ETB" ranges. |

When an employer applies suggestions in the job form, the job is saved with `extractionReviewed`, which stores `Job.extractionApprovedAt` (the brief's "employer approves the extraction").

## CV analysis (worker)

Flow: upload CV (existing PDF upload) -> `POST /workers/me/cv/analyze` -> review/edit in the UI -> `POST /workers/me/cv/apply`.

- **PDF text**: Mozilla pdf.js (4.10, newer than the 4.2.67 fix for the known script-execution flaw) with eval, system fonts and XFA disabled; at most 15 pages, 40 000 characters, 15 s. Text is grouped into rows by position. Image-only PDFs and photos are read by OCR instead (next bullet). Parsing runs in the API process; running it in an isolated worker/process is planned for deployment (Phase 14).
- **OCR for photos and scans** (`modules/analysis/ocr.ts`): a CV can now be a JPEG/PNG photo or a PDF that is only pictures. Tesseract (WebAssembly build, English) reads it; scanned PDFs are drawn page by page with pdf.js and a prebuilt canvas first. Limits: 4 pages, pages drawn 1600 px wide, 25 megapixels per photo, 90 s, one OCR job at a time per server with a short queue (then a polite "try again in a minute"). The English language file (about 10 MB) downloads on first use into `apps/api/ocr-data/`; set `OCR_LANG_PATH` to a folder that already holds `eng.traineddata` to run offline, and make that folder writable and persistent in Docker. The result tells the web app that OCR was used, with Tesseract's own average confidence, and the screen warns the worker to check every line, because OCR misreads letters and digits.
- **Parsing**: section headings (summary, experience, education, skills, certifications, languages); date ranges ("2018 - Present", "Jan 2019 - Dec 2021", "03/2018 - 06/2021") for work history, with the title/employer taken from the same line, or the nearest line above or below; degree words, field, institution and year for education; certificate lines; taxonomy skills anywhere in the text (flagging those in the Skills section; other tokens are listed as "not imported"); years of experience from merged date ranges (overlaps counted once), or a stated "N years of experience", whichever is larger.
- **Safety of the save**: the apply endpoint re-validates everything with the same schemas as manual entry, skips items already on the profile, never overwrites an existing biography, and stores all items as **self-reported**. A CV is the worker's own claim; importing can never create a verified item.
- **Audit log** entries: `cv.analyzed`, `cv.applied`, `analysis.job`.

## Honest limits

- English text only. Amharic or Afaan Oromoo CVs are extracted but not understood, and OCR is English only: Amharic scans are not read (the Amharic Tesseract model could be added, but the parser would still not understand the text).
- OCR quality depends on the picture: tilted, blurred, dark or handwritten CVs read badly or not at all. Tested only on clean computer-drawn pages, not on real phone photos or scanner output, so real accuracy is unmeasured. OCR runs inside the API process (CPU heavy); an isolated worker is still the planned fix.
- 90 taxonomy skills. Anything else shows as "not imported".
- Bare years ("2018 - 2022") count from January to January, which slightly *under*-counts; month names are used when present.
- Unusual layouts (multi-column templates, tables, text boxes) can scramble the order of lines. Names/phone/email are deliberately not extracted.
- Heuristics were tuned on a handful of sample layouts (see `analysis.test.ts`), not on a large CV collection. Phase 13 should measure extraction accuracy on real, consented CVs.
- Tests used generated PDFs with a standard font. Real-world PDFs with embedded or subset fonts are handled by pdf.js but have not been tested in volume.
