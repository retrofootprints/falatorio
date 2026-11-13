import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site at https://<user>.github.io/<repo>/
  base: '/falatorio/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web', 'kokoro-js', '@mintplex-labs/piper-tts-web'],
  },
});
