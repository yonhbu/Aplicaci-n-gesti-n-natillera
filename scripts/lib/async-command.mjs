import { spawn } from 'node:child_process';

// Keep timers and HTTP socket lifecycle running while a long test subprocess runs.
export function runNode(args, { capture = false } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true
    });
    let stdout = '', stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', error => resolve({ status: 1, stdout, stderr: `No se pudo iniciar Node (${error.code ?? 'error'}).` }));
    child.once('close', status => resolve({ status: status ?? 1, stdout, stderr }));
  });
}
