import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2023',
    // No manualChunks: let the bundler split on the registry's dynamic imports.
    // Hand-tuning chunks is how CodeMirror accidentally lands in the entry bundle.
    reportCompressedSize: true,
  },
})
