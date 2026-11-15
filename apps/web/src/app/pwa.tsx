import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';

// Installable-app support: online/offline state, the install prompt, and "new version available".
// The service worker only keeps the app shell and static files. It never stores API answers (see vite.config.ts).
// Texts are English only for now (not yet in the translation files).

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  online: boolean;
  installed: boolean; // already running as an installed app
  canInstall: boolean; // browser offered an install prompt
  iosHint: boolean; // iPhone/iPad Safari: no prompt exists, show manual steps
  updateReady: boolean;
  install: () => Promise<void>;
  applyUpdate: () => void;
  dismissUpdate: () => void;
}

const Ctx = createContext<PwaState | null>(null);

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone);
}

export function isIosSafari(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && !otherBrowser;
}

export type Platform =
  | 'ios-safari' | 'ios-other' | 'android-chrome' | 'android-firefox' | 'android-samsung'
  | 'desktop-chromium' | 'desktop-safari' | 'desktop-firefox' | 'other';

export function detectPlatform(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): Platform {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  if (ios) return isIosSafari(ua) ? 'ios-safari' : 'ios-other';
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return 'android-samsung';
    if (/Firefox/.test(ua)) return 'android-firefox';
    return 'android-chrome';
  }
  if (/Firefox/.test(ua)) return 'desktop-firefox';
  if (/Chrome|Chromium|Edg\//.test(ua)) return 'desktop-chromium';
  if (/Safari/.test(ua)) return 'desktop-safari';
  return 'other';
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  'ios-safari': 'iPhone / iPad (Safari)',
  'ios-other': 'iPhone / iPad (Chrome, Firefox, Edge)',
  'android-chrome': 'Android (Chrome, Edge, Opera)',
  'android-firefox': 'Android (Firefox)',
  'android-samsung': 'Android (Samsung Internet)',
  'desktop-chromium': 'Windows / Mac / Linux / Chromebook (Chrome, Edge)',
  'desktop-safari': 'Mac (Safari)',
  'desktop-firefox': 'Windows / Mac / Linux (Firefox)',
  other: 'Other browsers',
};

export const INSTALL_STEPS: Record<Platform, string> = {
  'ios-safari': 'Tap the Share button, scroll down, tap “Add to Home Screen”, then “Add”.',
  'ios-other': 'On iPhone and iPad installing only works from Safari. Open this page in Safari, tap Share, then “Add to Home Screen”.',
  'android-chrome': 'Tap “Install app” on this page, or open the browser menu (⋮) and choose “Install app” / “Add to Home screen”.',
  'android-firefox': 'Open the menu (⋮) and choose “Install”.',
  'android-samsung': 'Open the menu (≡) and choose “Add page to” → “Home screen”.',
  'desktop-chromium': 'Click “Install app” on this page, or the install icon at the right end of the address bar, or menu → “Install EthioTalent AI”.',
  'desktop-safari': 'In Safari 17 or newer choose File → “Add to Dock”.',
  'desktop-firefox': 'Firefox on computers cannot install web apps. Use Chrome, Edge or Safari to install, or keep using the site in a tab or bookmark it.',
  other: 'Look for “Install”, “Add to Home screen” or “Add to Dock” in your browser menu. If there is none, bookmark the site; it works fully in a normal browser tab.',
};

export function PwaProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [installed, setInstalled] = useState(isStandalone);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateSw, setUpdateSw] = useState<null | ((reload?: boolean) => Promise<void>)>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const before = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const done = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', before);
      window.removeEventListener('appinstalled', done);
    };
  }, []);

  // Register the service worker in production builds only (a worker in development would serve stale files).
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      const update = registerSW({
        onNeedRefresh: () => setUpdateReady(true),
        onRegisteredSW: (_url, registration) => {
          if (registration) timer = setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
        },
      });
      setUpdateSw(() => update);
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setPromptEvent(null);
  }, [promptEvent]);

  const applyUpdate = useCallback(() => {
    if (updateSw) void updateSw(true);
    else window.location.reload();
  }, [updateSw]);

  const value = useMemo<PwaState>(
    () => ({
      online,
      installed,
      canInstall: !installed && promptEvent !== null,
      iosHint: !installed && promptEvent === null && isIosSafari(),
      updateReady,
      install,
      applyUpdate,
      dismissUpdate: () => setUpdateReady(false),
    }),
    [online, installed, promptEvent, updateReady, install, applyUpdate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePwa(): PwaState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePwa must be used inside PwaProvider');
  return v;
}

/** Offline notice and "new version" prompt, pinned to the bottom edge (respects the phone's safe area). */
export function PwaBanners() {
  const { online, updateReady, applyUpdate, dismissUpdate } = usePwa();
  if (online && !updateReady) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {!online && (
        <div role="status" className="pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>You are offline. Pages you opened before still work, but jobs, messages and matches need a connection and may be out of date.</span>
        </div>
      )}
      {updateReady && (
        <div role="alert" className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg">
          <RefreshCw className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="flex-1">A new version is ready.</span>
          <button type="button" onClick={applyUpdate} className="rounded-lg bg-accent px-3 py-1.5 font-medium text-white pointer-coarse:py-2.5">Reload</button>
          <button type="button" onClick={dismissUpdate} aria-label="Dismiss" className="rounded-lg p-1.5 hover:bg-surface-2"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

/** "Install app" button: the real prompt where the browser offers one, otherwise the steps for this device. Hidden once installed. */
export function InstallButton({ className = '' }: { className?: string }) {
  const { installed, canInstall, install } = usePwa();
  const [show, setShow] = useState(false);
  if (installed) return null;
  const platform = detectPlatform();
  return (
    <div>
      <button type="button" onClick={() => (canInstall ? void install() : setShow((v) => !v))} aria-expanded={canInstall ? undefined : show} className={className}>
        <Download className="h-4 w-4" aria-hidden /> Install app
      </button>
      {show && (
        <p className="mt-2 max-w-xs text-xs">
          {INSTALL_STEPS[platform]} <Link to="/install" className="underline">All devices</Link>
        </p>
      )}
    </div>
  );
}
