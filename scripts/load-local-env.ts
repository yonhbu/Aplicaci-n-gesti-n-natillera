import { config } from 'dotenv';

export function loadLocalEnv() {
  config({ path: '.env.local', override: false, quiet: true });
  config({ path: '.env.test.local', override: false, quiet: true });
}
