import { spawnSync } from 'node:child_process';

const url = process.env.NATILLERA_APP_URL ?? 'http://127.0.0.1:5176';

const result =
  process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Start-Process '${url}'`], { stdio: 'inherit' })
    : process.platform === 'darwin'
      ? spawnSync('open', [url], { stdio: 'inherit' })
      : spawnSync('xdg-open', [url], { stdio: 'inherit' });

process.exit(result.status ?? 0);
