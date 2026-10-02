import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    hmr: { overlay: false },
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
