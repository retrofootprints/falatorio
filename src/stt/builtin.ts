// Built-in speech recognition (webkitSpeechRecognition). Not guaranteed to be
// on-device: Safari may send audio to Apple's servers.

const Ctor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export function builtinSTTSupported() {
  return !!Ctor;
}

export interface LiveRecognition {
  stop(): void;
  done: Promise<string>;
}

export function startBuiltinRecognition(lang: string, onText: (text: string) => void): LiveRecognition {
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let interim = '';
  let error: Error | null = null;

  rec.onresult = (e: any) => {
    interim = '';
    let fin = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) fin += r[0].transcript;
      else interim += r[0].transcript;
    }
    finalText = fin;
    onText((finalText + interim).trim());
  };

  const done = new Promise<string>((resolve, reject) => {
    rec.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      error = new Error(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone or speech recognition permission denied.'
          : `Speech recognition error: ${e.error}`,
      );
    };
    rec.onend = () => (error ? reject(error) : resolve((finalText + interim).trim()));
  });

  rec.start();
  return { stop: () => rec.stop(), done };
}
