import type { Progress } from './engine';
import type { Lang } from './models';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
export const fmtSec = (s: number) => `${s.toFixed(1)} s`;
export const fmtMB = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;

/** Shows a download progress bar; `expectedMB` is used until the real total is known. */
export function setProgress(el: HTMLElement, p: Progress | null, expectedMB = 0) {
  if (!p) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const bar = el.querySelector<HTMLElement>('.bar')!;
  const label = el.querySelector<HTMLElement>('.label')!;
  const total = Math.max(p.total, expectedMB * 1e6);
  const frac = total ? Math.min(1, p.loaded / total) : 0;
  bar.style.width = `${(frac * 100).toFixed(1)}%`;
  if (p.loaded === 0) label.textContent = 'Starting…';
  else if (frac >= 0.995) label.textContent = `Downloaded ${fmtMB(p.loaded)}. Initialising model…`;
  else label.textContent = `Downloading ${fmtMB(p.loaded)} / ~${fmtMB(total)} (${Math.round(frac * 100)}%)`;
}

export function setStats(el: HTMLElement, rows: [string, string][]) {
  el.replaceChildren(
    ...rows.map(([k, v]) => {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      d.append(dt, dd);
      return d;
    }),
  );
}

export function showError(el: HTMLElement, err: unknown) {
  if (!err) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  el.textContent = msg;
  el.hidden = false;
}

export function fillSelect(sel: HTMLSelectElement, options: { value: string; label: string }[], keep = true) {
  const prev = sel.value;
  sel.replaceChildren(
    ...options.map((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      return opt;
    }),
  );
  if (keep && options.some((o) => o.value === prev)) sel.value = prev;
}

// ---- global app state ----
export const appState = { lang: 'en' as Lang, webgpu: false };
const langListeners = new Set<() => void>();
export const onLangChange = (fn: () => void) => langListeners.add(fn);
export function setLang(l: Lang) {
  appState.lang = l;
  langListeners.forEach((fn) => fn());
}
