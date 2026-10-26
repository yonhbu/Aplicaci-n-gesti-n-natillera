import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The audit must never read the workspace dotenv files.
export default defineConfig({
  envDir: false,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
});
