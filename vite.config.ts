import { defineConfig } from 'vite';

// One dev server (5180) serves every task; preview (5181) serves the built site.
export default defineConfig({
  base: './',
  // A wrong dev path is a 404 rather than a silent fallback to index.html.
  appType: 'mpa',
  optimizeDeps: { include: ['three', 'postprocessing'] },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
