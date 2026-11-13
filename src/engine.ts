// A single global slot for the one heavy model allowed in memory.
// Every on-device engine lives in its own Web Worker; switching to a
// different model terminates the previous worker, which frees its memory.

export interface Progress {
  loaded: number;
  total: number;
}

export interface ReadyInfo {
  backend: string;
  loadMs: number;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

class EngineSlot {
  key: string | null = null;
  label = '';
  info: ReadyInfo | null = null;
  private worker: Worker | null = null;
  private ready: Promise<ReadyInfo> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private progressCb: ((p: Progress) => void) | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  isReady(key: string) {
    return this.key === key && this.info !== null;
  }

  /** Load (or reuse) the engine identified by `key`. Resolves once the model is ready. */
  load(
    key: string,
    label: string,
    makeWorker: () => Worker,
    loadMsg: Record<string, unknown>,
    onProgress: (p: Progress) => void,
  ): Promise<ReadyInfo> {
    if (this.key === key && this.ready) {
      this.progressCb = onProgress;
      return this.ready;
    }
    this.unload();
    this.key = key;
    this.label = label;
    this.progressCb = onProgress;
    const w = makeWorker();
    this.worker = w;
    w.onmessage = (e) => this.handle(e.data);
    w.onerror = (e) => {
      e.preventDefault?.();
      this.failAll(new Error(e.message || 'Worker crashed (the model may be too large for this device).'));
    };
    const ready = this.request({ type: 'load', ...loadMsg }).then((info: ReadyInfo) => {
      if (this.worker === w) {
        this.info = info;
        this.emit();
      }
      return info;
    });
    this.ready = ready;
    ready.catch(() => {
      if (this.worker === w) this.unload();
    });
    this.emit();
    return ready;
  }

  request<T = any>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const w = this.worker;
    if (!w) return Promise.reject(new Error('No model loaded.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...msg, id }, transfer);
    });
  }

  private handle(m: any) {
    if (m.type === 'progress') {
      this.progressCb?.({ loaded: m.loaded, total: m.total });
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
  }

  private failAll(err: Error) {
    const all = [...this.pending.values()];
    this.pending.clear();
    all.forEach((p) => p.reject(err));
  }

  unload() {
    if (this.worker) this.worker.terminate();
    this.failAll(new Error('Model unloaded.'));
    this.worker = null;
    this.ready = null;
    this.key = null;
    this.label = '';
    this.info = null;
    this.emit();
  }
}

export const slot = new EngineSlot();

let webgpuPromise: Promise<boolean> | null = null;
export function detectWebGPU(): Promise<boolean> {
  webgpuPromise ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      return !!adapter;
    } catch {
      return false;
    }
  })();
  return webgpuPromise;
}
