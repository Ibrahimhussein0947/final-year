// Voice typing through the browser's own speech recognition (the Web Speech API).
// The audio is handled by the browser vendor's service (Chrome sends it to Google), not by this platform.
// Where the browser has no speech recognition the microphone button simply is not shown.

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => Recognition;

export function getRecognition(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The speech language for each interface language. Afaan Oromoo support depends on the browser. */
export const SPEECH_LANG: Record<string, string> = { en: 'en-US', am: 'am-ET', om: 'om-ET' };

export const speechSupported = () => getRecognition() !== null;

/** Plain-language reasons for the errors the browser can report. */
export function speechErrorText(code: string, locale: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone is blocked. Allow the microphone for this site in your browser settings.';
    case 'no-speech':
      return 'Did not hear anything. Tap the microphone and speak again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'language-not-supported':
      return locale === 'om' ? 'Your browser cannot listen in Afaan Oromoo. Switch the language to Amharic or English to use voice.' : 'Your browser cannot listen in this language.';
    case 'network':
      return 'Voice typing needs an internet connection.';
    case 'aborted':
      return '';
    default:
      return 'Voice typing did not work. Please type instead.';
  }
}

/** Put text into an input or textarea the way a user typing would, so React and react-hook-form both notice. */
export function insertText(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const clean = text.trim();
  if (!clean) return;
  const current = el.value;
  const next = current && !/\s$/.test(current) ? `${current} ${clean}` : `${current}${clean}`;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (setter) setter.call(el, next);
  else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export type { Recognition };
