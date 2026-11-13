import { slot } from '../engine';
import { playSamples, stopPlayback, unlockAudio, encodeWav, setAudioSession } from '../audio';
import { KOKORO_VARIANTS, KOKORO_VOICES, PIPER_VOICES, type KokoroVariant } from '../models';
import { PRESETS } from '../presets';
import { $, appState, fillSelect, fmtMs, fmtSec, onLangChange, setProgress, setStats, showError } from '../ui-util';
import { builtinTTSSupported, loadVoices, speakBuiltin, voicesFor } from './builtin';

type Engine = 'kokoro' | 'piper' | 'builtin';

const engineSel = $<HTMLSelectElement>('ttsEngine');
const voiceSel = $<HTMLSelectElement>('ttsVoice');
const variantBox = $('kokoroVariant');
const presetsBox = $('presets');
const textArea = $<HTMLTextAreaElement>('ttsText');
const countEl = $('ttsCount');
const speakBtn = $<HTMLButtonElement>('speak');
const progressEl = $('ttsProgress');
const statusEl = $('ttsStatus');
const errorEl = $('ttsError');
const resultEl = $('ttsResult');
const audioEl = $<HTMLAudioElement>('ttsAudio');
const downloadEl = $<HTMLAnchorElement>('ttsDownload');
const statsEl = $('ttsStats');

const SOFT_LIMIT = 500;
let variant: KokoroVariant = 'q8';
let systemVoices: SpeechSynthesisVoice[] = [];
let busy = false;
let lastUrl: string | null = null;

function engines(): { value: Engine; label: string }[] {
  const builtin = { value: 'builtin' as Engine, label: 'Built-in (iOS) · 0 MB' };
  return appState.lang === 'en'
    ? [
        { value: 'kokoro', label: 'Kokoro (82M)' },
        { value: 'piper', label: 'Piper · 63 MB' },
        builtin,
      ]
    : [{ value: 'piper', label: 'Piper (tugão) · 63 MB' }, builtin];
}

function renderEngines() {
  fillSelect(engineSel, engines());
  renderVoices();
}

function renderVoices() {
  const engine = engineSel.value as Engine;
  voiceSel.disabled = false;
  if (engine === 'kokoro') {
    fillSelect(voiceSel, KOKORO_VOICES.map((v) => ({ value: v.id, label: v.label })));
  } else if (engine === 'piper') {
    const list = PIPER_VOICES[appState.lang];
    fillSelect(voiceSel, list.map((v) => ({ value: v.id, label: v.label })));
    voiceSel.disabled = list.length === 1;
  } else {
    const list = voicesFor(systemVoices, appState.lang);
    fillSelect(
      voiceSel,
      list.length
        ? list.map((v) => ({ value: v.voiceURI, label: `${v.name} · ${v.lang}${v.localService ? '' : ' (network)'}` }))
        : [{ value: '', label: appState.lang === 'pt' ? 'No pt-PT voice installed' : 'No English voice found' }],
    );
    voiceSel.disabled = !list.length;
  }
  variantBox.hidden = engine !== 'kokoro';
  renderVariant();
}

function renderVariant() {
  variantBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const v = b.dataset.variant as KokoroVariant;
    b.setAttribute('aria-pressed', String(v === variant));
    if (v === 'fp32') {
      b.disabled = !appState.webgpu;
      b.title = appState.webgpu ? '' : 'WebGPU not available on this device';
    }
  });
}

function renderPresets() {
  presetsBox.replaceChildren(
    ...PRESETS[appState.lang].map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = p.label;
      b.onclick = () => {
        textArea.value = p.text;
        updateCount();
      };
      return b;
    }),
  );
  textArea.value = PRESETS[appState.lang][0].text;
  textArea.lang = appState.lang === 'pt' ? 'pt-PT' : 'en';
  updateCount();
}

function updateCount() {
  const n = textArea.value.length;
  countEl.textContent = `${n} / ${SOFT_LIMIT}`;
  countEl.classList.toggle('over', n > SOFT_LIMIT);
}

function setBusy(b: boolean, label = '') {
  busy = b;
  speakBtn.disabled = b;
  speakBtn.textContent = b ? label || 'Working…' : '▶ Speak';
}

function setStatus(text: string) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function engineSpec(engine: 'kokoro' | 'piper') {
  if (engine === 'kokoro') {
    const v = KOKORO_VARIANTS[variant];
    return {
      key: `kokoro:${variant}`,
      label: `Kokoro ${v.label}`,
      expectedMB: v.mb,
      make: () => new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' }),
      loadMsg: { dtype: v.dtype, device: v.device },
    };
  }
  const voiceId = voiceSel.value;
  return {
    key: `piper:${voiceId}`,
    label: `Piper ${voiceId}`,
    expectedMB: 63,
    // One worker per Piper voice: the library keeps a singleton session.
    make: () => new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' }),
    loadMsg: { voiceId },
  };
}

function onSpeak() {
  if (busy) return;
  const text = textArea.value.trim();
  if (!text) return;
  const engine = engineSel.value as Engine;
  showError(errorEl, null);

  // Unlock audio synchronously inside the tap, before any await.
  setAudioSession('playback');
  unlockAudio();

  if (engine === 'builtin') {
    stopPlayback();
    const voice = systemVoices.find((v) => v.voiceURI === voiceSel.value);
    setBusy(true, 'Speaking…');
    resultEl.hidden = false;
    audioEl.hidden = true;
    downloadEl.hidden = true;
    speakBuiltin(text, voice, appState.lang)
      .then(({ startMs, durMs }) =>
        setStats(statsEl, [
          ['engine', `Built-in · ${voice?.name ?? 'default'}`],
          ['time to first sound', fmtMs(startMs)],
          ['audio length', fmtSec(durMs / 1000)],
          ['download', 'not available for system voices'],
        ]),
      )
      .catch((e) => showError(errorEl, e))
      .finally(() => setBusy(false));
    return;
  }

  if (builtinTTSSupported()) speechSynthesis.cancel();
  void runModel(engine, text);
}

async function runModel(engine: 'kokoro' | 'piper', text: string) {
  const spec = engineSpec(engine);
  const voice = voiceSel.value;
  setBusy(true, slot.isReady(spec.key) ? 'Generating…' : 'Loading model…');
  try {
    const wasReady = slot.isReady(spec.key);
    if (!wasReady) setProgress(progressEl, { loaded: 0, total: 0 }, spec.expectedMB);
    const info = await slot.load(spec.key, spec.label, spec.make, spec.loadMsg, (p) =>
      setProgress(progressEl, p, spec.expectedMB),
    );
    setProgress(progressEl, null);
    setBusy(true, 'Generating…');
    setStatus('Generating audio on this device…');
    const r = await slot.request<{ samples: Float32Array; sampleRate: number; genMs: number }>({
      type: 'run',
      text,
      voice,
    });
    setStatus('');
    playSamples(r.samples, r.sampleRate);

    const wav = encodeWav(r.samples, r.sampleRate);
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(wav);
    audioEl.src = lastUrl;
    audioEl.hidden = false;
    downloadEl.href = lastUrl;
    downloadEl.download = `${engine}-${voice}.wav`;
    downloadEl.hidden = false;
    resultEl.hidden = false;

    const seconds = r.samples.length / r.sampleRate;
    setStats(statsEl, [
      ['engine', `${spec.label} · ${voice}`],
      ['backend', info.backend],
      ['load time', wasReady ? 'already in memory' : fmtMs(info.loadMs)],
      ['generation time', fmtMs(r.genMs)],
      ['audio length', fmtSec(seconds)],
      ['real-time factor', `${(r.genMs / 1000 / seconds).toFixed(2)}×`],
    ]);
  } catch (e) {
    showError(errorEl, e);
  } finally {
    setProgress(progressEl, null);
    setStatus('');
    setBusy(false);
  }
}

export function initTTS() {
  engineSel.onchange = renderVoices;
  textArea.oninput = updateCount;
  speakBtn.onclick = onSpeak;
  variantBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => {
      variant = b.dataset.variant as KokoroVariant;
      renderVariant();
    };
  });
  onLangChange(() => {
    renderEngines();
    renderPresets();
  });
  renderEngines();
  renderPresets();
  loadVoices().then((v) => {
    systemVoices = v;
    renderVoices();
  });
}

/** Called once WebGPU detection finishes. */
export function refreshTTS() {
  renderVariant();
}
