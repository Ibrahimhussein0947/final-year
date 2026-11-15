import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import am from './am.json';
import om from './om.json';

export type Locale = 'en' | 'am' | 'om';
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'am', label: 'አማርኛ' },
  { code: 'om', label: 'Afaan Oromoo' },
];

type Dict = Record<string, string>;
const dictionaries: Record<Locale, Dict> = { en, am, om };
const STORAGE_KEY = 'et-locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'am' || saved === 'om') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Look up a key; falls back to English, then to the key itself. */
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  // Texts edited by administrators (stored on the server) take priority over the bundled files, without a new release.
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    let active = true;
    for (const l of new Set<string>([locale, 'en'])) {
      fetch(`/api/v1/translations/${l}`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((d: Record<string, string>) => active && setOverrides((o) => ({ ...o, [l]: d })))
        .catch(() => undefined); // offline or API down: the bundled text still works
    }
    return () => {
      active = false;
    };
  }, [locale]);

  const t = useCallback(
    (key: string) => overrides[locale]?.[key] ?? dictionaries[locale][key] ?? overrides.en?.[key] ?? dictionaries.en[key] ?? key,
    [locale, overrides],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
