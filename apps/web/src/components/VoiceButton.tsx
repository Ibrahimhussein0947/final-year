import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/i18n';
import { getRecognition, insertText, SPEECH_LANG, speechErrorText, type Recognition } from '@/lib/speech';

/**
 * A microphone button for a text field: tap, speak, tap again (or stop talking) and the words are added to the field.
 * Rendered only when the browser can do speech recognition.
 */
export function VoiceButton({ targetId, label }: { targetId: string; label: string }) {
  const { locale } = useI18n();
  const Ctor = getRecognition();
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.stop(), []);
  if (!Ctor) return null;

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    setMessage(null);
    const r = new Ctor!();
    r.lang = SPEECH_LANG[locale] ?? 'en-US';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      const el = document.getElementById(targetId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) insertText(el, e.results[i][0].transcript);
      }
    };
    r.onerror = (e) => setMessage(speechErrorText(e.error, locale) || null);
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setMessage('Voice typing did not start. Please try again.');
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        aria-label={listening ? `Stop voice typing for ${label}` : `Speak to fill in ${label}`}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
          listening ? 'animate-pulse border-danger bg-danger-soft text-danger' : 'border-border bg-surface text-muted hover:text-accent',
        )}
      >
        {listening ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
      </button>
      {listening && <span className="text-xs text-muted" role="status">Listening…</span>}
      {message && <span className="text-xs text-danger" role="alert">{message}</span>}
    </span>
  );
}
