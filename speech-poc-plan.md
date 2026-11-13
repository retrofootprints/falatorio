# Plan: On-device Speech Playground (EN + European PT)

A small proof-of-concept web app, hosted on **GitHub Pages**, that runs text-to-speech (TTS) and speech-to-text (STT) models **on the phone itself**, in the browser. It should make it easy to compare a few small models side by side in English and European Portuguese.

- **Target device:** iPhone 15 Pro or newer, iOS 26, Safari (WebGPU available). It must still work, just more slowly, on the WASM/CPU path.
- **Scope:** demo only. Short texts (about one paragraph) and short recordings (≤ 30 s). No accounts, no backend, no analytics.
- **Portuguese always means European Portuguese (pt-PT).** Never use Brazilian voices or the `pt-BR` locale.

---

## 1. Scope: what's in and what's out

The constraint is **phone memory and download size**, not GitHub Pages. Model files are **never committed to the repo**. They are fetched at runtime from Hugging Face and cached by the browser. GitHub Pages only serves the app (a few MB). Rule of thumb: keep each model download under about 150 MB and load **one model at a time**.

### In scope

| Task | Language | Engine / model | Approx. download | Notes |
|---|---|---|---|---|
| TTS | EN | **Kokoro-82M** via `kokoro-js` (`onnx-community/Kokoro-82M-v1.0-ONNX`) | ~90 MB (`q8`, WASM) / ~310 MB (`fp32`, WebGPU) | Best English quality per MB. Default to `q8` + WASM; offer WebGPU + `fp32` as a toggle. |
| TTS | EN | **Piper**: `en_US-lessac-medium`, `en_GB-alba-medium` | ~60 MB each | Same engine as the PT voice, so it gives a fair EN comparison. |
| TTS | PT-PT | **Piper `pt_PT-tugão-medium`** | ~63 MB | The only open pt-PT on-device voice. One male speaker, 22.05 kHz. |
| TTS | EN + PT-PT | **Built-in iOS voices** (`speechSynthesis`) | 0 | Baseline. Show only voices whose `lang` starts with `en` or equals `pt-PT`. |
| STT | EN + PT-PT | **Whisper tiny** (multilingual, *not* `.en`) via Transformers.js | small (39M params) | Fastest. Force the language (`english` / `portuguese`); don't auto-detect. |
| STT | EN + PT-PT | **Whisper base** (multilingual) via Transformers.js | moderate (74M params) | Better accuracy. Main comparison point. |
| STT | EN + PT-PT | **Built-in recognition** (`webkitSpeechRecognition`, `lang = en-US` / `pt-PT`) | 0 | Baseline. **Not guaranteed on-device:** Safari may send audio to Apple. Label it "Built-in (may use Apple servers)". |

Before wiring up each model, Claude Code must check the exact model IDs, available `dtype` files and download sizes on Hugging Face, then show the real size in the UI.

### Out of scope (and why)

- **NVIDIA Parakeet TDT 0.6B v3**: excellent for European Portuguese, but the browser build is ~1.2 GB (fp16 encoder). Too heavy for a phone tab.
- **Whisper small / medium / large-v3-turbo**: hundreds of MB to over 1 GB, likely to crash the Safari tab. *Optional stretch:* Whisper small behind an "⚠️ may crash" toggle, only if everything else works.
- **Kokoro Portuguese voices** (`pf_dora`, `pm_alex`, `pm_santa`): these are **Brazilian** Portuguese, so they're excluded.
- **Large expressive TTS** (Qwen3-TTS, XTTS, F5, Bark, Orpheus): far too large for on-device browser use.
- **English-only STT** (Moonshine, Parakeet v2, Whisper `.en`): no Portuguese counterpart, so they break the EN/PT parity.
- **Native iOS app**: not needed. A web page is enough for the proof of concept.

---

## 2. Tech stack

- **Vite + TypeScript, no UI framework** (plain DOM is enough). Mobile-first CSS.
- `@huggingface/transformers` (v3+): Whisper.
- `kokoro-js`: Kokoro.
- Piper in the browser: start with **`@mintplex-labs/piper-tts-web`** (fetches voices from HF, `predict({ text, voiceId })` API). Check that `pt_PT-tugão-medium` is in its voice list. If it isn't, load the `.onnx` + `.onnx.json` directly from `rhasspy/piper-voices`. **Pitfall:** the `ã` in `tugão` must be URL-encoded (`tug%C3%A3o`). If the library is broken or stale, fall back to `piper-tts-web` (Poket-Jony) or sherpa-onnx WASM. Record which one was used in the README.
- Each engine runs in its **own Web Worker** so the UI never freezes. Workers report download progress and timings back to the UI.
- Deploy: a **GitHub Actions** workflow builds with Vite and publishes to Pages. Set Vite `base` to `/<repo-name>/`.

### GitHub Pages / iOS gotchas to handle

1. **No custom headers on GitHub Pages**, so no cross-origin isolation (COOP/COEP) and ONNX Runtime WASM runs **single-threaded**. Accept this at first. Optional improvement: add `coi-serviceworker` (with `credentialless`) to enable threads. Make sure Hugging Face downloads still work if you do.
2. **Audio playback must start from a user tap.** Create or resume the `AudioContext` inside the click handler, before any `await`.
3. **Microphone:** HTTPS is required (Pages provides it). Use `getUserMedia({ audio: true })` + `MediaRecorder`. iOS records `audio/mp4`, so decode with `AudioContext.decodeAudioData`, then **downmix to mono and resample to 16 kHz `Float32Array`** before passing it to Whisper. Whisper won't complain about the wrong sample rate; it just returns garbage.
4. **Memory:** only one heavy model loaded at a time. Switching engines terminates the old worker. Add an "Unload model" button.
5. **WebGPU detection:** use WebGPU only if `navigator.gpu?.requestAdapter()` returns an adapter; otherwise use WASM. Show which backend is active.
6. **Caching:** Transformers.js caches in Cache Storage automatically. Make sure the Piper files are cached too. Add a "Clear model cache" button and show the approximate cache size (`navigator.storage.estimate()`).
7. **Built-in voices load asynchronously** on iOS: wait for `speechSynthesis.onvoiceschanged` (with a timeout fallback).

---

## 3. UI spec (single page, two tabs)

Global header: app name · **Language toggle `EN | PT-PT`** (shared by both tabs) · small diagnostics line (`WebGPU: yes/no · backend: webgpu/wasm · cache: 123 MB`).

### Tab 1: Speak (TTS)

1. **Engine dropdown**, filtered by the selected language:
   - EN: `Kokoro (82M)`, `Piper`, `Built-in (iOS)`
   - PT-PT: `Piper (tugão)`, `Built-in (iOS)`
2. **Voice dropdown** (changes with the engine):
   - Kokoro EN: `af_heart` (US F, default), `af_bella` (US F), `am_michael` (US M), `bf_emma` (UK F), `bm_george` (UK M), `bm_fable` (UK M)
   - Piper EN: `en_US-lessac-medium` (US), `en_GB-alba-medium` (UK)
   - Piper PT-PT: `pt_PT-tugão-medium` (only option; show the dropdown disabled)
   - Built-in: all matching system voices
3. **Precision/device toggle** (Kokoro only): `q8 · WASM` (default) / `fp32 · WebGPU`.
4. **Preset buttons**: two per language (texts in §4). Tapping one fills the text box.
5. **Text box** (editable, ~4 rows, character count, soft limit of 500 characters).
6. **▶ Speak** button. The first use of a model shows a progress bar for the download. Then generate and play.
7. **Result row:** audio player (replay), ⬇ download WAV, and stats: `load time · generation time · audio length · real-time factor`.

### Tab 2: Listen (STT)

1. **Engine dropdown**: `Whisper tiny`, `Whisper base`, `Built-in (may use Apple servers)`.
2. **Load model** button (Whisper only) with a progress bar. Recording is disabled until the model is ready.
3. **Big ● Record button**: tap to start, tap again to stop. Hard stop at 30 s, with a visible countdown and a mic level meter.
4. **Transcript box**: read-only, with a copy button. Built-in recognition can show interim results live.
5. **Stats:** `recording length · transcription time · backend`.
6. **"Re-run on last recording"** button: transcribe the same audio with a different engine for a direct A/B comparison. Keep the last recording in memory; built-in recognition can't do this (it listens live), so disable the button for it.

---

## 4. Preset texts

All original text. The Portuguese presets deliberately use pt-PT vocabulary and spelling (autocarro, pequeno-almoço, telemóvel, comboio) to test the accent.

**EN 1 (everyday):**
> This morning I missed the bus, so I walked to the office instead. The air was cold but clear, and by the time I arrived I had already planned the whole day. Sometimes a small change of routine is exactly what you need.

**EN 2 (numbers & names):**
> The meeting is on Thursday, the fourteenth of November, at half past three. Please bring the report, two printed copies of the budget, and the slides Maria shared last week. If anything changes, I'll send an update before noon.

**PT-PT 1 (quotidiano):**
> Hoje de manhã perdi o autocarro e acabei por ir a pé até ao escritório. Estava frio, mas o céu estava limpo, e quando cheguei já tinha o dia todo planeado. Às vezes, uma pequena mudança na rotina é mesmo aquilo de que precisamos.

**PT-PT 2 (números e nomes):**
> A reunião é na quinta-feira, dia catorze de novembro, às três e meia da tarde. Traz o relatório, duas cópias impressas do orçamento e os diapositivos que a Joana partilhou na semana passada. Se houver alguma alteração, mando-te uma mensagem pelo telemóvel antes do almoço.

---

## 5. Suggested project structure

```
/
├─ index.html
├─ src/
│  ├─ main.ts            # tabs, language toggle, diagnostics
│  ├─ tts/
│  │  ├─ ui.ts
│  │  ├─ kokoro.worker.ts
│  │  ├─ piper.worker.ts
│  │  └─ builtin.ts      # speechSynthesis (main thread)
│  ├─ stt/
│  │  ├─ ui.ts
│  │  ├─ recorder.ts     # MediaRecorder → mono 16 kHz Float32Array
│  │  ├─ whisper.worker.ts
│  │  └─ builtin.ts      # webkitSpeechRecognition
│  ├─ presets.ts
│  └─ styles.css
├─ vite.config.ts        # base: '/<repo-name>/', worker format: 'es'
├─ .github/workflows/deploy.yml
└─ README.md             # models used, sizes, licences, known limitations
```

---

## 6. Build order (milestones)

1. **Skeleton + deploy:** Vite app with the two tabs, language toggle and diagnostics line, deployed to GitHub Pages via Actions. Open it on the iPhone before building anything else.
2. **Built-in baselines:** `speechSynthesis` TTS and `webkitSpeechRecognition` STT, both languages. Proves the UI, mic permission and audio unlock with zero downloads.
3. **Piper:** `pt_PT-tugão-medium` first (the hardest and most important), then the two EN voices.
4. **Kokoro:** EN voices, `q8` WASM default and the WebGPU toggle.
5. **Whisper tiny → base:** recorder pipeline, forced language, re-run on the last recording.
6. **Polish:** stats, cache size + clear, unload, error messages (e.g. "model too large for this device", "mic permission denied").
7. *(Stretch)* `coi-serviceworker` for multithreaded WASM; Whisper small behind a warning.

## 7. Acceptance checklist (test on the iPhone, Safari)

- [ ] Site loads from the GitHub Pages URL; nothing large is committed to the repo.
- [ ] TTS: every engine × language combination in §1 plays audio on the first tap after the download, and a second tap is instant (served from cache).
- [ ] PT presets sound **European**, not Brazilian (check with the Piper and built-in pt-PT voices).
- [ ] STT: a 10-second phrase in each language is transcribed by Whisper tiny, Whisper base and built-in recognition. Portuguese output uses the correct accents (ç, ã, é).
- [ ] Switching models doesn't crash the tab. Unload frees memory.
- [ ] Turn on airplane mode after the models are cached: Piper, Kokoro and Whisper still work offline (built-in recognition may not, which is expected).
- [ ] The README lists each model with its source, licence (Kokoro Apache-2.0, Piper voices per model card, Whisper MIT; the Piper/Kokoro phonemizers use espeak-ng, GPL) and measured download sizes.

## 8. Non-goals

No server-side inference, API keys, user accounts, saving history, long-form audio, streaming/real-time transcription, voice cloning or Brazilian Portuguese.
