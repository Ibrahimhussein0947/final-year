# Responsive layout and installable app (PWA)

## Responsive
Checked in a browser at phone (375 px) and tablet (768 px) widths on the public pages, login/register, the worker screens (dashboard, profile, job detail, messages), the employer screens (jobs, new job, applicants, find workers) and the admin tabs. No horizontal scrolling remained on those pages.

Rules that keep it working (in `apps/web/src/index.css` and the layout components):
- Every `.grid` has a base column of `minmax(0, 1fr)`; otherwise one long non-wrapping title widens the whole page on a phone.
- `fieldset` has `min-width: 0` (browsers default to min-content).
- On touch screens (`pointer-coarse:`) buttons, icon buttons, footer links are 40 to 44 px tall; form fields use 16 px text so iOS does not zoom in.
- The job filters collapse behind a "Filters" button below the `sm` breakpoint; rows of buttons use `flex-wrap`.
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding keep content clear of notches and the home bar.

Not done: a check on real phones and on browsers other than the one used here, landscape orientation, and right-to-left/long Amharic strings in every screen.

## Installable app
Built with `vite-plugin-pwa` (config in `apps/web/vite.config.ts`, UI in `apps/web/src/app/pwa.tsx`).
- **Manifest:** name, standalone display, navy theme, icons 64/192/512 plus a maskable 512, shortcuts to Jobs, Dashboard and Messages. Icons are generated from `public/favicon.svg` with `npm run pwa:icons -w @ethiotalent/web` and committed.
- **Service worker:** precaches the app shell and static files (21 files, about 0.7 MB) so the app opens quickly and the shell opens offline. Only the Google Fonts are cached at run time.
- **Privacy:** `/api/` and `/socket.io/` are never cached or answered by the worker, so profiles, messages, phone numbers and matches are not stored by it. Offline, those screens show an offline notice and the usual loading/error states rather than old data.
- **Updates:** not silent. When a new version is downloaded a "Reload" prompt appears; it is also checked hourly.
- **Install:** an "Install app" button in the mobile menu and the footer, shown only when the browser offers installation; on iPhone Safari it shows the "Share, Add to Home Screen" steps. The service worker is registered in production builds only.
- **Server:** `infra/nginx/nginx.conf` serves `sw.js` and the manifest uncached with the right types; hashed assets stay cached for a year. Installation needs HTTPS (or localhost) in production.

## Device coverage
The page `/install` (linked in the footer) lists install steps for iPhone/iPad Safari, other iOS browsers (must use Safari), Android Chrome/Edge, Firefox and Samsung Internet, desktop Chrome/Edge, Mac Safari (Add to Dock) and desktop Firefox (cannot install). The "Install app" button uses the browser's real prompt where it exists and otherwise shows the steps for the detected browser. Browsers that cannot install still run the site normally. The build targets browsers from about 2021 onward (Vite default).
Not provided: store apps (Google Play / App Store) or Windows/Mac installers; that would need a wrapper such as Capacitor or a Trusted Web Activity, a developer account and review.

## Checks
- `npm run pwa:verify -w @ethiotalent/web` (after a build; also in CI) checks the manifest fields, the icons, that `sw.js` exists, precaches `index.html` and no API URL.
- `src/app/pwa.test.tsx`: offline notice, install prompt flow, iOS detection.

## Not verified
- The service worker could not be registered inside the development tool's embedded browser, so **registration, offline opening, the update prompt and the install flow have not been exercised in a real browser**. The built files and the server headers were checked, not the runtime behaviour. Test on Chrome (Lighthouse "installable"), Android and iPhone before relying on it.
- There is no offline queue: actions taken offline (applying, sending messages) fail and must be repeated.
- Install and offline texts are English only (not in the translation files).
- No push notifications.
