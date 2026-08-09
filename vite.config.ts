import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' → works under GitHub Pages /<repo>/ with no extra config.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The compute engine is a module worker, and it imports the same statistics
  // the page does — so it is bundled as ES, not wrapped in an IIFE.
  worker: { format: 'es' },
  // bench.html is a measuring bench, not part of the studio. It is off by
  // default so it can never reach the deployed site, and built with BENCH=1 when
  // a decision needs numbers — measured through the same production pipeline the
  // real app runs on, because a dev-server measurement is not the thing shipped.
  build: process.env.BENCH
    ? { rollupOptions: { input: { index: 'index.html', bench: 'bench.html' } } }
    : {},
})
