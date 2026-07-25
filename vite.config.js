import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'assets',
  build: {
    chunkSizeWarningLimit: 650,
  },
});
