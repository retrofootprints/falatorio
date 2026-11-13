import { TtsSession } from '@mintplex-labs/piper-tts-web';
import { serve, postProgress } from '../worker-util';

// Keep in sync with the onnxruntime-web version in package.json.
const ORT_VERSION = '1.22.0';
const PIPER_WASM = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

let session: TtsSession | null = null;

serve({
  async load(m: { voiceId: string }) {
    const t0 = performance.now();
    // The library downloads the voice from Hugging Face (the URL is built with
    // fetch(), so the "ã" in "tugão" is percent-encoded automatically) and
    // keeps it in the Origin Private File System for offline use.
    session = await TtsSession.create({
      voiceId: m.voiceId as any,
      progress: (p) => {
        if (!p.url.startsWith('tts://')) postProgress(p.loaded, p.total);
      },
      wasmPaths: {
        onnxWasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
        piperData: `${PIPER_WASM}.data`,
        piperWasm: `${PIPER_WASM}.wasm`,
      },
    });
    return { result: { backend: 'wasm', loadMs: performance.now() - t0 } };
  },

  async run(m: { text: string }) {
    if (!session) throw new Error('Piper is not loaded.');
    const t0 = performance.now();
    const wav = await session.predict(m.text);
    const { samples, sampleRate } = parseWav16(await wav.arrayBuffer());
    return {
      result: { samples, sampleRate, genMs: performance.now() - t0 },
      transfer: [samples.buffer],
    };
  },
});

// The library returns a canonical 44-byte-header PCM16 mono WAV.
function parseWav16(buf: ArrayBuffer) {
  const view = new DataView(buf);
  const sampleRate = view.getUint32(24, true);
  const n = (buf.byteLength - 44) >> 1;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { samples, sampleRate };
}
