# Falatório: on-device speech playground

A proof-of-concept web app that runs **text-to-speech** and **speech-to-text**
models **inside the browser**, on the phone itself, in **English** and
**European Portuguese (pt-PT)**. It's built for iPhone 15 Pro+ / iOS 26 Safari,
uses WebGPU where available and falls back to WASM on the CPU.

**Live demo:** https://retrofootprints.github.io/falatorio/

No backend, no accounts, no analytics. Model weights are **never** committed to
this repo. They are downloaded at runtime from Hugging Face and cached by the
browser. Only one heavy model is kept in memory at a time.

## Models

Sizes below were measured from the Hugging Face file listings (Nov 2026) and
are what the UI shows.

| Task | Engine | Model / source | Download | Licence |
|---|---|---|---|---|
| TTS EN | Kokoro-82M via [`kokoro-js`](https://www.npmjs.com/package/kokoro-js) 1.2.1 | [`onnx-community/Kokoro-82M-v1.0-ONNX`](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX): `q8` = `model_quantized.onnx`, `fp32` = `model.onnx`; voices `af_heart`, `af_bella`, `am_michael`, `bf_emma`, `bm_george`, `bm_fable` (0.5 MB each) | **92 MB** (q8 · WASM) / **326 MB** (fp32 · WebGPU) | Apache-2.0 |
| TTS EN | Piper | [`en_US-lessac-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/medium) | **63 MB** | Per model card. Dataset: [Blizzard 2013 Lessac licence](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html) (non-commercial) |
| TTS EN | Piper | [`en_GB-alba-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/alba/medium) | **63 MB** | Per model card. Dataset: CC BY 4.0 |
| TTS PT-PT | Piper | [`pt_PT-tugão-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_PT/tug%C3%A3o/medium) (1 male speaker, 22.05 kHz) | **63 MB** | Per model card. Dataset: CC0 |
| TTS EN + PT-PT | Built-in `speechSynthesis` | iOS system voices (`en*` and `pt-PT` only, never `pt-BR`) | 0 | n/a |
| STT EN + PT-PT | Whisper tiny (multilingual) via [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) 3.8.1 | [`onnx-community/whisper-tiny`](https://huggingface.co/onnx-community/whisper-tiny): encoder fp32 + merged decoder q8 (WASM) / q4 (WebGPU) | **64 MB** (WASM) / **120 MB** (WebGPU) | MIT (OpenAI Whisper) |
| STT EN + PT-PT | Whisper base (multilingual) | [`onnx-community/whisper-base`](https://huggingface.co/onnx-community/whisper-base): same dtypes | **136 MB** (WASM) / **206 MB** (WebGPU) | MIT (OpenAI Whisper) |
| STT EN + PT-PT | Built-in `webkitSpeechRecognition` | `en-US` / `pt-PT`. **May send audio to Apple's servers** | 0 | n/a |

The runtimes are downloaded once from jsDelivr and cached by the service worker:
ONNX Runtime Web 1.22.0 WASM (~11 MB, or ~22 MB for the WebGPU build used by
Transformers.js), plus the Piper phonemizer (espeak-ng data, ~18 MB).

**Phonemizers:** both Piper (`piper_phonemize`) and Kokoro (`phonemizer`) use
**espeak-ng, which is GPL-3.0**. Keep this in mind before reusing the code in a
closed-source product.

### Which Piper library is used

[`@mintplex-labs/piper-tts-web`](https://www.npmjs.com/package/@mintplex-labs/piper-tts-web)
**1.0.5**. Its voice list includes `pt_PT-tugão-medium`, so no fallback was needed.
It downloads voices from the `diffusionstudio/piper-voices` mirror of
`rhasspy/piper-voices` and stores them in the Origin Private File System (OPFS).
`fetch()` percent-encodes the `ã` in `tugão` automatically.

Two quirks are handled in the code:
- The library keeps a **singleton** session, so changing voice in the same
  worker would keep the old model. The app uses one worker per Piper voice.
- It defaults to ONNX Runtime 1.18 from cdnjs. The app passes explicit
  `wasmPaths` that match the bundled `onnxruntime-web@1.22.0`.

### Kokoro quirk

`kokoro-js` 1.2.1's `stream()` never closes its internal sentence splitter when
given a plain string, so it hangs after the last sentence. The worker passes in
a `TextSplitterStream` that it has already closed.

## Architecture

- Vite + TypeScript, no UI framework. Mobile-first CSS.
- Each on-device engine runs in its **own Web Worker** (`src/tts/kokoro.worker.ts`,
  `src/tts/piper.worker.ts`, `src/stt/whisper.worker.ts`). One global slot
  (`src/engine.ts`) holds the only loaded model. Loading another model
  **terminates** the previous worker, and so does **Unload model**.
- Audio playback uses one `AudioContext`, unlocked synchronously inside the tap
  handler. `navigator.audioSession.type = 'playback'` lets audio play with the
  iPhone silent switch on.
- Recording uses `getUserMedia` + `MediaRecorder` (iOS gives `audio/mp4`), then
  `decodeAudioData`, then an `OfflineAudioContext(1 ch, 16 kHz)` that downmixes
  and resamples to a 16 kHz mono `Float32Array` for Whisper. Recording stops at
  30 s. The last recording is kept for A/B **Re-run**.
- **Service worker** (`public/sw.js`) does three things:
  1. It caches the app shell and the CDN runtimes, so the page works offline.
  2. It adds **COOP/COEP** headers to same-origin responses. GitHub Pages can't
     set headers, so this is the `coi-serviceworker` trick. With these headers
     the page is cross-origin isolated, and ONNX Runtime runs **multithreaded
     WASM**. The first visit reloads once so the service worker can take control.
     All cross-origin loads (Hugging Face, jsDelivr) are CORS fetches, which
     `require-corp` allows.
  3. It leaves model weights alone: Transformers.js and kokoro-js keep them in
     Cache Storage, and Piper keeps them in OPFS. **Clear model cache** wipes
     both.

## Measured on a desktop (headless Chrome, 12 threads, for reference only)

| Engine | Load (first, incl. download) | Generation / transcription |
|---|---|---|
| Piper tugão, 11 s of audio | 3.7 s | 1.8–2.7 s (RTF ≈ 0.2) |
| Kokoro q8 · WASM, 14 s of audio | 4.5 s | 38 s (RTF ≈ 2.6) |
| Kokoro fp32 · WebGPU, 14 s of audio | 176 s (326 MB download) | 7.3 s (RTF ≈ 0.5) |
| Whisper tiny / base, 12 s of audio | n/a | 2.4–3.7 s |

These numbers are only a reference point. The real test is the iPhone (see the
checklist in `speech-poc-plan.md`).

## Known limitations

- Kokoro q8 on WASM is slow (slower than real time even with threads). On a
  WebGPU device, the fp32 · WebGPU toggle is much faster but downloads 326 MB.
- Built-in speech recognition isn't guaranteed to run on-device, and it can't
  re-run on a stored recording because it listens live.
- Built-in system voices can't be exported to WAV.
- Whisper occasionally hallucinates or truncates text, especially `tiny`
  on synthetic or noisy audio.
- Safari may evict cached models under storage pressure. The app calls
  `navigator.storage.persist()` to ask the browser to keep them.

## Develop

```bash
npm install
npm run dev       # http://localhost:5173/falatorio/
npm run build && npm run preview
```

Pushing to `main` builds and deploys to GitHub Pages via
`.github/workflows/deploy.yml`.
