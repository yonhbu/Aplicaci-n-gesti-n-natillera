import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

// Same build as the application, without reading local dotenv during UX validation.
export default defineConfig(async environment => {
  const config = await (typeof base === 'function' ? base(environment) : base);
  return mergeConfig(config, { envDir: false, build: { outDir: 'incoming/ux15/build' } });
});
