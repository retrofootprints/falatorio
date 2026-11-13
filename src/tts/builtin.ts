// Built-in system voices via speechSynthesis (main thread).
import type { Lang } from '../models';

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export function builtinTTSSupported() {
  return 'speechSynthesis' in window;
}

/** iOS loads voices asynchronously: wait for voiceschanged, with a timeout fallback. */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!builtinTTSSupported()) return Promise.resolve([]);
  voicesPromise ??= new Promise((resolve) => {
    const now = speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    const t = setTimeout(() => resolve(speechSynthesis.getVoices()), 2500);
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(t);
        resolve(speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
  return voicesPromise;
}

export function voicesFor(all: SpeechSynthesisVoice[], lang: Lang) {
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  // Portuguese must be European Portuguese only: pt-PT, never pt-BR.
  return all
    .filter((v) => (lang === 'en' ? norm(v.lang).startsWith('en') : norm(v.lang) === 'pt-pt'))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

let keepAlive: SpeechSynthesisUtterance | null = null; // iOS can GC the utterance mid-speech

/** Must be called synchronously from a click handler on iOS. */
export function speakBuiltin(
  text: string,
  voice: SpeechSynthesisVoice | undefined,
  lang: Lang,
): Promise<{ startMs: number; durMs: number }> {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang ?? (lang === 'en' ? 'en-US' : 'pt-PT');
  if (voice) u.voice = voice;
  keepAlive = u;
  const t0 = performance.now();
  let tStart = 0;
  return new Promise((resolve, reject) => {
    u.onstart = () => (tStart = performance.now());
    u.onend = () => {
      const end = performance.now();
      resolve({ startMs: (tStart || end) - t0, durMs: end - (tStart || t0) });
      keepAlive = null;
    };
    u.onerror = (e) => {
      keepAlive = null;
      if (e.error === 'canceled' || e.error === 'interrupted') {
        resolve({ startMs: (tStart || performance.now()) - t0, durMs: performance.now() - (tStart || t0) });
      } else reject(new Error(`Speech synthesis error: ${e.error}`));
    };
    speechSynthesis.speak(u);
  });
}
