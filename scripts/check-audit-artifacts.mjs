import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const { yauzl } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const roots = ['browser', 'extended-browser', 'corrections-browser', 'ea-regression-browser', 'all-browser', 'navigation-browser']
  .map(folder => `incoming/functional-audit/${folder}`);
roots.push('incoming/ci-database');
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file); else files.push(file);
  }
}
for (const root of roots) if (existsSync(root)) walk(root);
if (files.some(file => file.endsWith('trace-unsanitized.zip'))) throw Error('Queda una traza sin sanear.');
const archives = files.filter(file => file.endsWith('.zip'));
let entries = 0;
for (const file of archives) {
  await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    zip.on('error', reject); zip.on('end', resolve);
    zip.on('entry', entry => {
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject);
        stream.on('end', () => {
          entries++;
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { zip.readEntry(); return; }
          if (/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[\w-]+/.test(text)) {
            zip.close(); reject(Error('Se detectó material de autenticación en una traza; no compartir artefactos.')); return;
          }
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  }));
}
if (!archives.length) throw Error('No hay trazas saneadas que verificar.');
console.log(`PASS: ${archives.length} archivos ZIP, ${entries} entradas revisadas; sin JWT/claves elevadas detectadas ni trazas crudas.`);
