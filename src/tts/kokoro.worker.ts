import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import { KOKORO_MODEL } from '../models';
import { serve, hfProgress, workerHasWebGPU, concatFloat32 } from '../worker-util';

let tts: KokoroTTS | null = null;

serve({
  async load(m: { dtype: 'q8' | 'fp32'; device: 'wasm' | 'webgpu' }) {
    if (m.device === 'webgpu' && !(await workerHasWebGPU())) {
      throw new Error('WebGPU is not available here. Use q8 · WASM instead.');
    }
    const t0 = performance.now();
    tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: m.dtype,
      device: m.device,
      progress_callback: hfProgress(),
    });
    return { result: { backend: m.device, loadMs: performance.now() - t0 } };
  },

  async run(m: { text: string; voice: string }) {
    if (!tts) throw new Error('Kokoro is not loaded.');
    const t0 = performance.now();
    const parts: Float32Array[] = [];
    let sampleRate = 24000;
    // Sentence splitting keeps every chunk under Kokoro's 510-token limit.
    // Pass a closed splitter: kokoro-js 1.2.1 never closes the one it creates
    // for plain-string input, so stream() would hang after the last sentence.
    const splitter = new TextSplitterStream();
    splitter.push(m.text);
    splitter.close();
    for await (const { audio } of tts.stream(splitter, { voice: m.voice as any })) {
      parts.push(audio.audio);
      sampleRate = audio.sampling_rate;
    }
    const samples = concatFloat32(parts);
    return {
      result: { samples, sampleRate, genMs: performance.now() - t0 },
      transfer: [samples.buffer],
    };
  },
});
