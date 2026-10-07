import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tsxBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const result =
  process.platform === 'win32'
    ? spawnSync(`"${tsxBin}" scripts/bootstrap-workspace.ts`, {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, SUPABASE_ENV: 'test' }
      })
    : spawnSync(tsxBin, ['scripts/bootstrap-workspace.ts'], {
        stdio: 'inherit',
        env: { ...process.env, SUPABASE_ENV: 'test' }
      });

process.exit(result.status ?? 1);
