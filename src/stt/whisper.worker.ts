import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { whisperDtype, type Device } from '../models';
import { serve, hfProgress, workerHasWebGPU } from '../worker-util';

env.allowLocalModels = false;

let asr: AutomaticSpeechRecognitionPipeline | null = null;

serve({
  async load(m: { model: string; device: Device }) {
    if (m.device === 'webgpu' && !(await workerHasWebGPU())) {
      throw new Error('WebGPU is not available here. Use WASM instead.');
    }
    const t0 = performance.now();
    // Cast avoids TS2590 ("union type too complex") from pipeline()'s overloads.
    const makePipeline = pipeline as unknown as (task: string, model: string, opts: object) => Promise<unknown>;
    asr = (await makePipeline('automatic-speech-recognition', m.model, {
      device: m.device,
      dtype: whisperDtype(m.device),
      progress_callback: hfProgress(),
    })) as AutomaticSpeechRecognitionPipeline;
    return { result: { backend: m.device, loadMs: performance.now() - t0 } };
  },

  async run(m: { audio: Float32Array; language: 'english' | 'portuguese' }) {
    if (!asr) throw new Error('Whisper is not loaded.');
    const t0 = performance.now();
    // Language is forced (no auto-detect); input is mono 16 kHz, ≤ 30 s.
    const out: any = await asr(m.audio, { language: m.language, task: 'transcribe' } as any);
    const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? '';
    return { result: { text: text.trim(), ms: performance.now() - t0 } };
  },
});
