import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { TextAreaField, TextField } from '@/components/ui/primitives';
import { insertText, speechErrorText } from '@/lib/speech';

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = true;
  interimResults = true;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() { FakeRecognition.last = this; }
  start() { this.started = true; }
  stop() { this.started = false; this.onend?.(); }
}
const say = (r: FakeRecognition, text: string) =>
  r.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });

const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  FakeRecognition.last = null;
});

describe('voice typing', () => {
  it('shows no microphone when the browser has no speech recognition', () => {
    wrap(<TextField voice label="Search" />);
    expect(screen.queryByRole('button', { name: /speak/i })).toBeNull();
  });

  it('adds spoken words to a field, after what is already there', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    wrap(<TextField voice label="Search" defaultValue="driver" />);
    fireEvent.click(screen.getByRole('button', { name: /speak to fill in search/i }));
    const r = FakeRecognition.last!;
    expect(r.started).toBe(true);
    expect(r.lang).toBe('en-US');
    expect(r.interimResults).toBe(false);
    act(() => say(r, 'in Adama'));
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('driver in Adama');
  });

  it('works in a text area, toggles to a stop button, and stops listening', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    wrap(<TextAreaField voice label="Biography" />);
    fireEvent.click(screen.getByRole('button', { name: /speak to fill in biography/i }));
    expect(screen.getByRole('button', { name: /stop voice typing/i })).toBeTruthy();
    act(() => say(FakeRecognition.last!, 'I fix cars'));
    expect((screen.getByLabelText('Biography') as HTMLTextAreaElement).value).toBe('I fix cars');
    fireEvent.click(screen.getByRole('button', { name: /stop voice typing/i }));
    expect(screen.getByRole('button', { name: /speak to fill in biography/i })).toBeTruthy();
  });

  it('explains a blocked microphone in plain words', () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    wrap(<TextField voice label="Search" />);
    fireEvent.click(screen.getByRole('button', { name: /speak/i }));
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));
    expect(screen.getByRole('alert').textContent).toMatch(/microphone is blocked/i);
  });

  it('insertText ignores blank speech and error text is empty for an abort', () => {
    const input = document.createElement('input');
    input.value = 'a';
    insertText(input, '   ');
    expect(input.value).toBe('a');
    expect(speechErrorText('aborted', 'en')).toBe('');
    expect(speechErrorText('language-not-supported', 'om')).toMatch(/Amharic or English/);
  });
});
