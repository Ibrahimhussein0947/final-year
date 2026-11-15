import { useEffect, useState } from 'react';
import { InstallButton, PwaBanners } from '@/app/pwa';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Globe, Menu, Moon, Sun, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button, LinkButton } from '@/components/ui/Button';
import { useAuth } from '@/app/auth';
import { MessagesLink, NotificationBell } from '@/components/NotificationBell';
import { useI18n, LOCALES, type Locale } from '@/i18n';
import { useTheme } from '@/app/theme';
import { cn } from '@/lib/cn';

const NAV = [
  { to: '/jobs', key: 'nav.jobs' },
  { to: '/workers', key: 'nav.workers' },
  { to: '/categories', key: 'nav.categories' },
  { to: '/how-it-works', key: 'nav.how' },
  { to: '/about', key: 'nav.about' },
];

function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{t('nav.language')}</span>
      <Globe className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" aria-hidden />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="h-9 rounded-lg border border-border bg-surface pl-8 pr-2 text-sm pointer-coarse:h-10"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('nav.theme')}
      aria-pressed={theme === 'dark'}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2 pointer-coarse:h-10 pointer-coarse:w-10"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </button>
  );
}

/** Messages and notifications stay in the top bar on phones, where people check them most. */
function MobileAlerts() {
  const { user } = useAuth();
  if (!user || (user.role !== 'WORKER' && user.role !== 'EMPLOYER')) return null;
  return (
    <>
      <MessagesLink />
      <NotificationBell />
    </>
  );
}

function AuthButtons({ mobile }: { mobile?: boolean }) {
  const { t } = useI18n();
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const grow = mobile ? 'flex-1' : '';
  if (loading) return <div className="h-9 w-24" aria-hidden />;
  if (user) {
    return (
      <>
        {!mobile && (user.role === 'WORKER' || user.role === 'EMPLOYER') && (
          <>
            <MessagesLink />
            <NotificationBell />
          </>
        )}
        {user.role === 'ADMIN' && (
          <LinkButton to="/admin" variant={mobile ? 'outline' : 'ghost'} size="sm" className={grow}>Admin</LinkButton>
        )}
        {(user.role === 'WORKER' || user.role === 'EMPLOYER') && (
          <LinkButton to="/interviews" variant={mobile ? 'outline' : 'ghost'} size="sm" className={grow}>Interviews</LinkButton>
        )}
        {(user.role === 'WORKER' || user.role === 'EMPLOYER') && (
          <LinkButton to="/analytics" variant={mobile ? 'outline' : 'ghost'} size="sm" className={grow}>Analytics</LinkButton>
        )}
        <LinkButton to="/dashboard" variant={mobile ? 'outline' : 'ghost'} size="sm" className={grow}>
          {t('nav.dashboard')}
        </LinkButton>
        <LinkButton to="/account/security" variant={mobile ? 'outline' : 'ghost'} size="sm" className={grow}>
          Security
        </LinkButton>
        <Button
          variant="accent"
          size="sm"
          className={grow}
          onClick={async () => {
            await logout();
            navigate('/');
          }}
        >
          {t('nav.logout')}
        </Button>
      </>
    );
  }
  return (
    <>
      <LinkButton to="/login" variant={mobile ? 'outline' : 'ghost'} size="sm" className={grow}>
        {t('nav.login')}
      </LinkButton>
      <LinkButton to="/register" variant="accent" size="sm" className={grow}>
        {t('nav.register')}
      </LinkButton>
    </>
  );
}

function Header() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn('whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-2', isActive ? 'text-accent' : 'text-text');

  return (
    <header className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 xl:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={linkClass}>
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-2 xl:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          <AuthButtons />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 xl:hidden">
          <MobileAlerts />
          <ThemeToggle />
          <button
            type="button"
            aria-label={t('nav.menu')}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface pointer-coarse:h-10 pointer-coarse:w-10"
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <div id="mobile-nav" className="max-h-[calc(100dvh-4rem-env(safe-area-inset-top))] overflow-y-auto border-t border-border bg-surface px-4 pb-5 pt-3 xl:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn(linkClass({ isActive }), 'py-3 text-base')}>
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
          <div className="mt-4 flex items-center gap-3">
            <LanguageSwitcher />
            <AuthButtons mobile />
          </div>
          <InstallButton className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium" />
        </div>
      )}
    </header>
  );
}

function Footer() {
  const { t } = useI18n();
  const col = 'space-y-2 text-sm text-slate-300 pointer-coarse:space-y-0';
  // Footer links are 44px tall on touch screens so they can be hit with a thumb.
  const link = 'hover:text-white pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center';
  return (
    <footer className="mt-20 bg-[#0b1f3a] text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <Logo light />
          <p className="mt-3 text-sm">{t('brand.tagline')}</p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">{t('footer.platform')}</h4>
          <ul className={col}>
            <li><Link className={link} to="/jobs">{t('nav.jobs')}</Link></li>
            <li><Link className={link} to="/workers">{t('nav.workers')}</Link></li>
            <li><Link className={link} to="/categories">{t('nav.categories')}</Link></li>
            <li><Link className={link} to="/how-it-works">{t('nav.how')}</Link></li>
            <li><Link className={link} to="/install">Install app</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">{t('footer.support')}</h4>
          <ul className={col}>
            <li><Link className={link} to="/help">{t('nav.help')}</Link></li>
            <li><Link className={link} to="/contact">{t('nav.contact')}</Link></li>
            <li><Link className={link} to="/about">{t('nav.about')}</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold text-white">{t('footer.legal')}</h4>
          <ul className={col}>
            <li><Link className={link} to="/privacy">{t('footer.privacy')}</Link></li>
            <li><Link className={link} to="/terms">{t('footer.terms')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-5 text-center text-xs sm:px-6">
        © {new Date().getFullYear()} EthioTalent AI. {t('footer.rights')} {t('footer.prototype')}
        <InstallButton className="mx-auto mt-3 flex items-center gap-2 text-white hover:underline pointer-coarse:min-h-11" />
      </div>
    </footer>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <div className="print:hidden"><Header /></div>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <div className="print:hidden"><Footer /></div>
      <PwaBanners />
    </div>
  );
}
