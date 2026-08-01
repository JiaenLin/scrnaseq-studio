import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' → works under GitHub Pages /<repo>/ with no extra config.
export default defineConfig({
  base: './',
  plugins: [react()],
})
