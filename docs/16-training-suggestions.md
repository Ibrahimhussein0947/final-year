# Training suggestions

Workers who lack a skill see where they can learn it.

## How it works
- **Courses are listed by administrators** at `/admin/training` (title, provider, web address, online or in a place, cost in ETB where 0 is free and empty is "not stated", duration, languages, and the skills it teaches). Nothing is shown to workers unless an administrator listed it: there is no built-in or scraped course catalogue, and the platform never invents a course.
- **For one job** (the job page, under "Why this matches you"): the skills the job lists that the worker does not (required first), and the courses that teach them.
- **In general** (the Analytics page): the skills most often *required* by open jobs in the worker's field that they lack, and the courses for them.
- Courses are ranked by how many of the gaps they cover, then a small preference for free, online and nearby (the worker's place or an area above it). The list is capped at 12 courses and 8 gaps. A gap with no course says "No course listed yet".
- API: `GET /api/v1/training/suggestions[?jobId=...]` (workers); `GET/POST/PATCH/DELETE /api/v1/admin/training` (administrators, audited).

## Honest limits
- The gap is demand-based and skill-name based, like the existing "Skills worth adding" list. A related skill the worker already has (which earns partial match credit) does not remove a gap.
- A listing is not an endorsement and finishing a course does not guarantee a job; the screen says so.
- No course catalogue ships with the system, so until an administrator adds courses the list is empty. Nobody checks a listed course still exists or is accurate.
- Not built: training-institution accounts that list their own courses, course ratings, enrolment, and certificates from a course feeding the profile automatically.
