import { slot } from '../engine';
import { getAudioContext, setAudioSession, stopPlayback, unlockAudio } from '../audio';
import { WHISPER_MODELS, type Device, type WhisperSize } from '../models';
import { $, appState, fmtMs, fmtSec, onLangChange, setProgress, setStats, showError } from '../ui-util';
import { Recorder, toMono16k } from './recorder';
import { builtinSTTSupported, startBuiltinRecognition, type LiveRecognition } from './builtin';

type Engine = WhisperSize | 'builtin';
const MAX_SECONDS = 30;

const engineSel = $<HTMLSelectElement>('sttEngine');
const deviceBox = $('whisperDevice');
const loadBtn = $<HTMLButtonElement>('sttLoad');
const progressEl = $('sttProgress');
const errorEl = $('sttError');
const recordBtn = $<HTMLButtonElement>('record');
const recordHint = $('recordHint');
const meterEl = $('meter');
const meterBar = meterEl.querySelector<HTMLElement>('div')!;
const countdownEl = $('countdown');
const transcriptEl = $<HTMLTextAreaElement>('transcript');
const copyBtn = $<HTMLButtonElement>('copy');
const statsEl = $('sttStats');
const rerunBtn = $<HTMLButtonElement>('rerun');
const lastRecEl = $<HTMLAudioElement>('lastRec');

let device: Device = 'wasm';
let busy = false;
let loading = false;
let last: { audio: Float32Array; seconds: number; url: string } | null = null;
let active: { kind: 'whisper'; rec: Recorder } | { kind: 'builtin'; live: LiveRecognition } | null = null;
let timer = 0;
let startedAt = 0;

const engine = () => engineSel.value as Engine;
const isWhisper = (e: Engine): e is WhisperSize => e !== 'builtin';
const key = (size: WhisperSize) => `whisper:${size}:${device}`;
const whisperLang = () => (appState.lang === 'pt' ? 'portuguese' : 'english');
const bcp47 = () => (appState.lang === 'pt' ? 'pt-PT' : 'en-US');

function renderEngines() {
  const opts: { value: Engine; label: string }[] = [
    { value: 'tiny', label: 'Whisper tiny' },
    { value: 'base', label: 'Whisper base' },
    { value: 'builtin', label: 'Built-in (may use Apple servers)' },
  ];
  const prev = engineSel.value;
  engineSel.replaceChildren(
    ...opts.map((o) => {
      const el = document.createElement('option');
      el.value = o.value;
      el.textContent = o.label;
      if (o.value === 'builtin' && !builtinSTTSupported()) {
        el.disabled = true;
        el.textContent += ' — not supported in this browser';
      }
      return el;
    }),
  );
  if (prev) engineSel.value = prev;
}

function refresh() {
  const e = engine();
  const whisper = isWhisper(e);
  deviceBox.hidden = !whisper;
  loadBtn.hidden = !whisper;
  deviceBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const d = b.dataset.device as Device;
    b.setAttribute('aria-pressed', String(d === device));
    if (whisper) b.textContent = `${d === 'wasm' ? 'WASM' : 'WebGPU'} · ${WHISPER_MODELS[e].mb[d]} MB`;
    if (d === 'webgpu') b.disabled = !appState.webgpu || !!active || busy;
    else b.disabled = !!active || busy;
  });

  const ready = whisper ? slot.isReady(key(e)) : builtinSTTSupported();
  if (whisper) {
    loadBtn.disabled = ready || loading || !!active;
    loadBtn.textContent = ready ? `${WHISPER_MODELS[e].label} loaded ✓` : loading ? 'Loading…' : `Load model (${WHISPER_MODELS[e].mb[device]} MB)`;
  }
  recordBtn.disabled = !ready || (busy && !active) || loading;
  recordBtn.classList.toggle('recording', !!active);
  recordBtn.setAttribute('aria-label', active ? 'Stop recording' : 'Start recording');
  recordHint.textContent = active
    ? 'Tap to stop'
    : !ready
      ? whisper
        ? 'Load the model first'
        : 'Not supported in this browser'
      : 'Tap to record (max 30 s)';
  meterEl.hidden = e === 'builtin';
  rerunBtn.disabled = !last || !whisper || !!active || busy || loading;
  rerunBtn.title = whisper ? '' : 'Built-in recognition listens live, so it cannot re-run a recording.';
  engineSel.disabled = !!active || busy;
}

async function loadModel(): Promise<boolean> {
  const e = engine();
  if (!isWhisper(e)) return false;
  const m = WHISPER_MODELS[e];
  loading = true;
  showError(errorEl, null);
  refresh();
  try {
    setProgress(progressEl, { loaded: 0, total: 0 }, m.mb[device]);
    const info = await slot.load(
      key(e),
      `${m.label} (${device})`,
      () => new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' }),
      { model: m.id, device },
      (p) => setProgress(progressEl, p, m.mb[device]),
    );
    setStats(statsEl, [
      ['model', m.label],
      ['backend', info.backend],
      ['load time', fmtMs(info.loadMs)],
    ]);
    return true;
  } catch (err) {
    showError(errorEl, err);
    return false;
  } finally {
    loading = false;
    setProgress(progressEl, null);
    refresh();
  }
}

async function onRecord() {
  if (active) return void stopRecording();
  showError(errorEl, null);
  stopPlayback();
  setAudioSession('play-and-record');
  const ctx = unlockAudio(); // inside the tap, before any await
  const e = engine();

  if (e === 'builtin') {
    transcriptEl.value = '';
    const live = startBuiltinRecognition(bcp47(), (t) => (transcriptEl.value = t));
    active = { kind: 'builtin', live };
    startCountdown();
    live.done
      .then((text) => {
        transcriptEl.value = text;
        setStats(statsEl, [
          ['recording length', fmtSec((performance.now() - startedAt) / 1000)],
          ['transcription time', 'live (streamed while you speak)'],
          ['backend', `Built-in ${bcp47()} (may use Apple servers)`],
        ]);
      })
      .catch((err) => showError(errorEl, err))
      .finally(() => {
        stopCountdown();
        active = null;
        refresh();
      });
    refresh();
    return;
  }

  const rec = new Recorder();
  try {
    await rec.start(ctx, (level) => (meterBar.style.width = `${Math.round(level * 100)}%`));
  } catch (err: any) {
    showError(
      errorEl,
      err?.name === 'NotAllowedError' ? new Error('Microphone permission denied. Allow it in Settings › Safari › Microphone.') : err,
    );
    return;
  }
  active = { kind: 'whisper', rec };
  startCountdown();
  refresh();
}

async function stopRecording() {
  const a = active;
  if (!a) return;
  stopCountdown();
  if (a.kind === 'builtin') {
    a.live.stop(); // `done` resolves and cleans up
    return;
  }
  active = null;
  busy = true;
  refresh();
  meterBar.style.width = '0%';
  try {
    const blob = await a.rec.stop();
    const audio = await toMono16k(blob, getAudioContext());
    if (last) URL.revokeObjectURL(last.url);
    last = { audio, seconds: audio.length / 16000, url: URL.createObjectURL(blob) };
    lastRecEl.src = last.url;
    lastRecEl.hidden = false;
    busy = false;
    await transcribe();
  } catch (err) {
    showError(errorEl, err);
  } finally {
    busy = false;
    refresh();
  }
}

async function transcribe() {
  const e = engine();
  if (!last || !isWhisper(e)) return;
  if (!slot.isReady(key(e)) && !(await loadModel())) return;
  busy = true;
  refresh();
  transcriptEl.value = 'Transcribing on this device…';
  try {
    const audio = last.audio.slice(); // keep the original for re-runs
    const r = await slot.request<{ text: string; ms: number }>(
      { type: 'run', audio, language: whisperLang() },
      [audio.buffer],
    );
    transcriptEl.value = r.text;
    setStats(statsEl, [
      ['model', WHISPER_MODELS[e].label],
      ['recording length', fmtSec(last.seconds)],
      ['transcription time', fmtMs(r.ms)],
      ['backend', slot.info?.backend ?? device],
      ['language', whisperLang()],
    ]);
  } catch (err) {
    transcriptEl.value = '';
    showError(errorEl, err);
  } finally {
    busy = false;
    refresh();
  }
}

function startCountdown() {
  startedAt = performance.now();
  countdownEl.textContent = `${MAX_SECONDS} s`;
  timer = window.setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const left = Math.max(0, MAX_SECONDS - elapsed);
    countdownEl.textContent = `${Math.ceil(left)} s`;
    if (left <= 0) void stopRecording();
  }, 100);
}

function stopCountdown() {
  clearInterval(timer);
  countdownEl.textContent = `${MAX_SECONDS} s`;
}

export function initSTT() {
  renderEngines();
  engineSel.onchange = () => {
    showError(errorEl, null);
    refresh();
  };
  deviceBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => {
      device = b.dataset.device as Device;
      refresh();
    };
  });
  loadBtn.onclick = () => void loadModel();
  recordBtn.onclick = () => void onRecord();
  rerunBtn.onclick = () => void transcribe();
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(transcriptEl.value);
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
    } catch {
      transcriptEl.select();
    }
  };
  slot.subscribe(refresh);
  onLangChange(refresh);
  refresh();
}

export const refreshSTT = refresh;
