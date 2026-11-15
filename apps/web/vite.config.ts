import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const brand = '#0b1f3a';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app (PWA): a manifest, install icons, and a service worker that keeps the app shell and static files so
    // the app opens fast and opens offline. It NEVER caches API responses or uploaded files (private data stays off the
    // device cache), and it does not update silently: the person is asked to reload (see src/app/pwa.tsx).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // registered in src/app/pwa.tsx so the update prompt can be shown
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'EthioTalent AI',
        short_name: 'EthioTalent',
        description: 'Connecting Ethiopian talent with the right opportunities: jobs, workers and explained matches.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: brand,
        theme_color: brand,
        categories: ['business', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Browse jobs', short_name: 'Jobs', url: '/jobs', icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'My dashboard', short_name: 'Dashboard', url: '/dashboard', icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Messages', short_name: 'Messages', url: '/messages', icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        cleanupOutdatedCaches: true,
        // Every page of the single-page app opens from the cached shell. The API, live connections and the files of the
        // service worker itself are never answered from it.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /\/sw\.js$/, /\/workbox-.*\.js$/, /\/manifest\.webmanifest$/],
        // Only static, public resources are cached at run time (the web fonts). No /api/ route is listed here on purpose.
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i, handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-styles', expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
          { urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'google-fonts-files', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Same-origin API in development so the httpOnly refresh cookie works without CORS.
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:4100', '/socket.io': { target: process.env.API_PROXY ?? 'http://localhost:4100', ws: true } },
  },
});
