import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Natillera Manager',
        short_name: 'Natillera',
        description: 'Gestion privada de ahorro de natillera.',
        theme_color: '#14532d',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: []
      }
    })
  ],
  server: {
    port: 5176
  },
  preview: {
    port: 4176
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (id.includes('@supabase')) {
            return 'supabase';
          }
          if (id.includes('react') || id.includes('react-dom')) {
            return 'react';
          }
          return undefined;
        }
      }
    }
  }
});
