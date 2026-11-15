import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from './en.json';
import am from './am.json';
import om from './om.json';
import { I18nProvider, useI18n } from './index';

function Probe({ k }: { k: string }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="out">{t(k)}</span>
      <span data-testid="loc">{locale}</span>
      <button onClick={() => setLocale('am')}>am</button>
    </div>
  );
}
const EN = en as Record<string, string>;
const firstKey = Object.keys(EN)[0];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('translation files', () => {
  it('Amharic and Afaan Oromoo have no keys that English lacks (no orphan strings)', () => {
    for (const [name, dict] of [['am', am], ['om', om]] as const) {
      const extra = Object.keys(dict).filter((k) => !k.startsWith('_') && !(k in EN));
      expect(extra, `${name} has keys missing from English`).toEqual([]);
    }
  });
  it('no translation is an empty string', () => {
    for (const dict of [am, om] as Record<string, string>[]) expect(Object.values(dict).every((v) => v.trim().length > 0)).toBe(true);
  });
});

describe('I18nProvider', () => {
  it('returns the key itself when nothing knows it', () => {
    render(<I18nProvider><Probe k="definitely.not.a.key" /></I18nProvider>);
    expect(screen.getByTestId('out')).toHaveTextContent('definitely.not.a.key');
  });

  it('switches language, remembers it, sets the document language, and falls back to English for untranslated keys', async () => {
    const missing = Object.keys(EN).find((k) => !(k in (am as Record<string, string>)));
    render(<I18nProvider><Probe k={missing ?? firstKey} /></I18nProvider>);
    await act(async () => screen.getByText('am').click());
    expect(screen.getByTestId('loc')).toHaveTextContent('am');
    expect(localStorage.getItem('et-locale')).toBe('am');
    expect(document.documentElement.lang).toBe('am');
    if (missing) expect(screen.getByTestId('out')).toHaveTextContent(EN[missing]);
  });

  it('texts edited by an administrator (served by the API) override the bundled text', async () => {
    (fetch as any).mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/en') ? { [firstKey]: 'ADMIN EDITED' } : {}), { status: 200 }));
    render(<I18nProvider><Probe k={firstKey} /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('ADMIN EDITED'));
  });

  it('still works when the API is unreachable', async () => {
    (fetch as any).mockRejectedValue(new Error('offline'));
    render(<I18nProvider><Probe k={firstKey} /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent(EN[firstKey]));
  });
});
