// Helpers shared by the engine workers.

type Handler = (msg: any) => Promise<{ result: unknown; transfer?: Transferable[] }>;

export function serve(handlers: Record<string, Handler>) {
  self.onmessage = async (e: MessageEvent) => {
    const { id, type } = e.data;
    try {
      const h = handlers[type];
      if (!h) throw new Error(`Unknown message: ${type}`);
      const { result, transfer = [] } = await h(e.data);
      (self as unknown as Worker).postMessage({ id, ok: true, result }, transfer);
    } catch (err: any) {
      console.error(err);
      (self as unknown as Worker).postMessage({ id, ok: false, error: describeError(err) });
    }
  };
}

function describeError(err: any): string {
  const msg = String(err?.message ?? err);
  if (/memory|allocation|RangeError|bad_alloc|OOM/i.test(msg)) {
    return `Model too large for this device (${msg})`;
  }
  return msg;
}

export function postProgress(loaded: number, total: number) {
  (self as unknown as Worker).postMessage({ type: 'progress', loaded, total });
}

/** Aggregates Transformers.js per-file progress events into one loaded/total pair. */
export function hfProgress() {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: any) => {
    if (!p?.file) return;
    if (p.status === 'progress') {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    } else if (p.status === 'done') {
      const f = files.get(p.file);
      if (f) f.loaded = f.total;
    } else return;
    let loaded = 0;
    let total = 0;
    files.forEach((f) => {
      loaded += f.loaded;
      total += f.total;
    });
    postProgress(loaded, total);
  };
}

export async function workerHasWebGPU(): Promise<boolean> {
  try {
    const adapter = await (navigator as any).gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export function concatFloat32(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
