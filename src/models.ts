// Model catalogue. Sizes were checked against the Hugging Face file listings
// on 2026-11-12 (decimal MB, model weights only; tokenizer/config files are
// a few KB extra, and the ONNX Runtime / phonemizer WASM runtimes are
// fetched once from jsDelivr and cached separately).

export type Lang = 'en' | 'pt';
export type Device = 'wasm' | 'webgpu';

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export const KOKORO_VARIANTS = {
  // onnx/model_quantized.onnx: 92,361,116 bytes
  q8: { dtype: 'q8', device: 'wasm' as Device, label: 'q8 · WASM', mb: 92 },
  // onnx/model.onnx: 325,532,232 bytes
  fp32: { dtype: 'fp32', device: 'webgpu' as Device, label: 'fp32 · WebGPU', mb: 326 },
} as const;
export type KokoroVariant = keyof typeof KOKORO_VARIANTS;

export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'af_heart · US female' },
  { id: 'af_bella', label: 'af_bella · US female' },
  { id: 'am_michael', label: 'am_michael · US male' },
  { id: 'bf_emma', label: 'bf_emma · UK female' },
  { id: 'bm_george', label: 'bm_george · UK male' },
  { id: 'bm_fable', label: 'bm_fable · UK male' },
];

// rhasspy/piper-voices (served through the diffusionstudio/piper-voices mirror
// used by @mintplex-labs/piper-tts-web). All three .onnx files are ~63.2 MB.
export const PIPER_VOICES: Record<Lang, { id: string; label: string; mb: number }[]> = {
  en: [
    { id: 'en_US-lessac-medium', label: 'en_US-lessac-medium · US', mb: 63 },
    { id: 'en_GB-alba-medium', label: 'en_GB-alba-medium · UK', mb: 63 },
  ],
  pt: [{ id: 'pt_PT-tugão-medium', label: 'pt_PT-tugão-medium · PT', mb: 63 }],
};

// Whisper (multilingual) via Transformers.js, onnx-community repos.
// WASM:   encoder fp32 + merged decoder q8 (int8)
// WebGPU: encoder fp32 + merged decoder q4 (q8 ops are not GPU-accelerated)
export const WHISPER_MODELS = {
  tiny: {
    id: 'onnx-community/whisper-tiny',
    label: 'Whisper tiny',
    mb: { wasm: 64, webgpu: 120 }, // 32.9 + 30.7 / 32.9 + 86.7
  },
  base: {
    id: 'onnx-community/whisper-base',
    label: 'Whisper base',
    mb: { wasm: 136, webgpu: 206 }, // 82.5 + 53.7 / 82.5 + 123.6
  },
} as const;
export type WhisperSize = keyof typeof WHISPER_MODELS;

export function whisperDtype(device: Device) {
  return device === 'webgpu'
    ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
    : { encoder_model: 'fp32', decoder_model_merged: 'q8' };
}
