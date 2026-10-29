import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Offline: precache every built asset. No web manifest, so no install
    // banner. The registration script is an external file, which keeps it
    // out of the entry bundle and inside `script-src 'self'`.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        // Only the shell: the per-tool HTML that scripts/seo.ts writes after
        // this runs is for crawlers, and they never run a service worker.
        globIgnores: ['*/**/index.html'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // ES workers keep a worker's dynamic import() as a separate chunk; IIFE
  // inlined it, so the CSS worker loaded Prettier even to minify.
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    // No manualChunks: let the bundler split on the registry's dynamic imports.
    // Hand-tuning chunks is how CodeMirror accidentally lands in the entry bundle.
    reportCompressedSize: true,
  },
})
