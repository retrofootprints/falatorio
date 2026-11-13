// Shared AudioContext. iOS only lets audio start from a user gesture, so
// unlockAudio() must be called synchronously inside a click handler,
// before the first `await`.

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

type SessionType = 'playback' | 'play-and-record' | 'auto';

/** Safari's Audio Session API: "playback" lets Web Audio play with the silent switch on. */
export function setAudioSession(type: SessionType) {
  const s = (navigator as any).audioSession;
  if (s && s.type !== type) {
    try {
      s.type = type;
    } catch {
      /* not supported */
    }
  }
}

export function unlockAudio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state !== 'running') void ctx.resume();
  // Play one silent sample: older iOS versions need this to fully unlock.
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
  return ctx;
}

export function getAudioContext(): AudioContext {
  return ctx ?? unlockAudio();
}

export function stopPlayback() {
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = null;
}

export function playSamples(samples: Float32Array, sampleRate: number) {
  const c = getAudioContext();
  stopPlayback();
  const buf = c.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start();
  current = src;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
