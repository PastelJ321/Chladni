import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { offlinePlugin } from './offline-plugin';

export default defineConfig({
  base: './',
  plugins: [react(), offlinePlugin()],
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
