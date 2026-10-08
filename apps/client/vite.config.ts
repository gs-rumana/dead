import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    // Reachable from phones on the same Wi-Fi (§6.1).
    host: true,
    port: 5173,
  },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
  },
});
