// Microphone capture: MediaRecorder → decoded → mono 16 kHz Float32Array.
// iOS records audio/mp4 (AAC); decodeAudioData handles it. Whisper needs
// exactly 16 kHz mono or it silently returns garbage.

export class Recorder {
  private stream: MediaStream | null = null;
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;

  async start(ctx: AudioContext, onLevel: (level: number) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) =>
      MediaRecorder.isTypeSupported?.(t),
    );
    this.chunks = [];
    this.mr = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.mr.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.mr.start();

    // Level meter
    this.source = ctx.createMediaStreamSource(this.stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): Promise<Blob> {
    cancelAnimationFrame(this.raf);
    const mr = this.mr;
    const done = new Promise<Blob>((resolve) => {
      if (!mr || mr.state === 'inactive') return resolve(new Blob(this.chunks));
      mr.onstop = () => resolve(new Blob(this.chunks, { type: mr.mimeType || 'audio/mp4' }));
      mr.stop();
    });
    return done.finally(() => {
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.mr = null;
      this.source = null;
    });
  }
}

export async function toMono16k(blob: Blob, ctx: AudioContext): Promise<Float32Array> {
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const length = Math.max(1, Math.ceil(decoded.duration * 16000));
  // A 1-channel OfflineAudioContext at 16 kHz downmixes and resamples in one go.
  const off = new OfflineAudioContext(1, length, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}
