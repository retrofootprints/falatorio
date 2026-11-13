import './styles.css';
import { detectWebGPU, slot } from './engine';
import { $, appState, fmtMB, setLang } from './ui-util';
import type { Lang } from './models';
import { initTTS, refreshTTS } from './tts/ui';
import { initSTT, refreshSTT } from './stt/ui';

const diagEl = $('diag');
const modelStatus = $('modelStatus');
const unloadBtn = $<HTMLButtonElement>('unload');
const clearBtn = $<HTMLButtonElement>('clearCache');

let cacheBytes: number | null = null;

function renderDiag() {
  const backend = slot.info?.backend ?? '—';
  const cache = cacheBytes == null ? '…' : fmtMB(cacheBytes);
  const threads = crossOriginIsolated ? `${navigator.hardwareConcurrency} threads` : '1 thread';
  diagEl.textContent = `WebGPU: ${appState.webgpu ? 'yes' : 'no'} · backend: ${backend} (${threads}) · cache: ${cache}`;
  modelStatus.textContent = slot.key
    ? slot.info
      ? `Loaded: ${slot.label} (${slot.info.backend})`
      : `Loading: ${slot.label}…`
    : 'No model in memory';
  unloadBtn.disabled = !slot.key;
}

async function updateCache() {
  try {
    const est = await navigator.storage?.estimate?.();
    cacheBytes = est?.usage ?? null;
  } catch {
    cacheBytes = null;
  }
  renderDiag();
}

// ---- language toggle ----
const langBtns = document.querySelectorAll<HTMLButtonElement>('#lang button');
langBtns.forEach((b) => {
  b.onclick = () => {
    const l = b.dataset.lang as Lang;
    langBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.documentElement.lang = l === 'pt' ? 'pt-PT' : 'en';
    setLang(l);
  };
});

// ---- tabs ----
const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tabs button');
tabBtns.forEach((b) => {
  b.onclick = () => {
    tabBtns.forEach((x) => {
      const on = x === b;
      x.setAttribute('aria-selected', String(on));
      $(`tab-${x.dataset.tab}`).hidden = !on;
    });
  };
});

// ---- model memory + cache ----
unloadBtn.onclick = () => slot.unload();

clearBtn.onclick = async () => {
  if (!confirm('Delete all downloaded models? They will be downloaded again on next use.')) return;
  slot.unload();
  clearBtn.disabled = true;
  try {
    // Transformers.js ("transformers-cache") and kokoro-js ("kokoro-voices") use
    // Cache Storage; the app shell/CDN caches of the service worker are kept.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith('falatorio-')).map((k) => caches.delete(k)));
    // Piper keeps voices in the Origin Private File System.
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('piper', { recursive: true });
    } catch {
      /* nothing stored */
    }
  } finally {
    clearBtn.disabled = false;
    await updateCache();
  }
};

slot.subscribe(() => {
  renderDiag();
  if (slot.info) {
    void updateCache();
    // Ask the browser not to evict the cached models.
    void navigator.storage?.persist?.().catch(() => {});
  }
});

initTTS();
initSTT();
renderDiag();
void updateCache();

detectWebGPU().then((ok) => {
  appState.webgpu = ok;
  renderDiag();
  refreshTTS();
  refreshSTT();
});

// Service worker: caches the app shell and the ONNX Runtime / phonemizer
// runtimes so the page works offline once the models are cached.
// It also adds COOP/COEP headers, so after the first visit the page is
// cross-origin isolated and ONNX Runtime can use multithreaded WASM. The very
// first visit reloads once so the worker can take control.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then(async () => {
      await navigator.serviceWorker.ready;
      if (!crossOriginIsolated && !sessionStorage.getItem('coi-reloaded')) {
        sessionStorage.setItem('coi-reloaded', '1');
        location.reload();
      }
    })
    .catch((e) => console.warn('SW failed', e));
}
