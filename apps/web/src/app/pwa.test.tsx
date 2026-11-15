import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { detectPlatform, InstallButton, isIosSafari, PwaBanners, PwaProvider } from './pwa';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1';

function App() {
  return (
    <PwaProvider>
      <PwaBanners />
      <MemoryRouter><InstallButton /></MemoryRouter>
    </PwaProvider>
  );
}

describe('pwa', () => {
  it('detects iOS Safari only', () => {
    expect(isIosSafari(IPHONE)).toBe(true);
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
  });

  it('detects the platform for install instructions', () => {
    expect(detectPlatform(IPHONE)).toBe('ios-safari');
    expect(detectPlatform(IPHONE_CHROME)).toBe('ios-other');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36')).toBe('android-chrome');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23 Chrome/115 Mobile Safari/537.36')).toBe('android-samsung');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe('desktop-firefox');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120')).toBe('desktop-chromium');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17.0 Safari/605')).toBe('desktop-safari');
  });

  it('shows the offline notice when the connection drops and hides it when it returns', () => {
    render(<App />);
    expect(screen.queryByText(/You are offline/)).toBeNull();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText(/You are offline/)).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });

  it('offers install only after the browser fires beforeinstallprompt, and not after install', async () => {
    render(<App />);
    expect(screen.getByText('Install app')).toBeTruthy();
    let prompted = false;
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => { prompted = true; },
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => { window.dispatchEvent(ev); });
    const btn = screen.getByText('Install app');
    expect(ev.defaultPrevented).toBe(true);
    await act(async () => { btn.click(); });
    expect(prompted).toBe(true);
    expect(screen.queryByText('Install app')).toBeNull();
  });
});
