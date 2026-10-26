import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // DEV and audit servers can coexist without replacing each other's prebundles.
  cacheDir: `node_modules/.vite-${mode}`,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Natillera Manager',
        short_name: 'Natillera',
        description: 'Gestion privada de ahorro de natillera.',
        theme_color: '#003f36',
        background_color: '#f4f7f6',
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
  // Audit exports and captured pages are not application entry points.
  optimizeDeps: {
    entries: ['index.html']
  },
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    watch: {
      ignored: ['**/incoming/**', '**/.playwright-mcp/**', '**/.supabase-test/**', '**/supabase/.temp/**', '**/test-results/**', '**/playwright-report/**']
    }
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
}));
