import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

const ICONS = 'https://mjrnlrmefyxcuvzzwifl.supabase.co/storage/v1/object/public/menu/dunk/icons'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'DUNK — Smash Burgers',
        short_name: 'DUNK',
        description: 'Commande tes smash burgers DUNK en livraison ou à emporter.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F7EFDC',
        theme_color: '#F7EFDC',
        categories: ['food', 'shopping'],
        icons: [
          { src: `${ICONS}/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${ICONS}/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${ICONS}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Commander', url: '/', description: 'Voir le menu' },
          { name: 'Mes commandes', url: '/compte', description: 'Historique et fidélité' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/admin/, /^\/livreur/],
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/public/menu/'),
            handler: 'CacheFirst',
            options: { cacheName: 'dunk-images', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'dunk-fonts' },
          },
        ],
      },
    }),
  ],
})
