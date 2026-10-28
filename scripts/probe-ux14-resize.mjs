import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
  await page.setContent(`<style>${readFileSync('src/styles.css', 'utf8')}</style><main class="layout"><div class="more-layout" data-mode="module"><div class="more-content"><section class="admin-page more-page"><div class="hero-band"><div class="hero-band-top"><div><h2>Mi ganancia como administrador</h2></div><button>Registrar retiro</button></div></div></section></div></div></main>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const samples = [];
  for (let i = 0; i < 30; i++) {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.setViewportSize({ width: 320, height: 900 });
    const measure = () => {
      const title = document.querySelector('h2'), hero = document.querySelector('.hero-band');
      const range = document.createRange(); range.selectNodeContents(title);
      return { viewport: innerWidth, media: matchMedia('(max-width: 359px)').matches, padding: getComputedStyle(hero).paddingLeft, width: title.getBoundingClientRect().width, font: getComputedStyle(title).fontFamily, fontSize: getComputedStyle(title).fontSize, rects: [...range.getClientRects()].map(r => ({ left: r.left, right: r.right })) };
    };
    const immediate = await page.evaluate(measure);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const settled = await page.evaluate(measure);
    samples.push({ immediate, settled });
  }
  const stale = samples.filter(sample => sample.immediate.padding !== '8px');
  for (const sample of samples) {
    assert.equal(sample.settled.padding, '8px');
    assert.equal(sample.settled.width, 272);
    assert.equal(sample.settled.fontSize, '32px');
  }
  console.log(JSON.stringify({ samples: samples.length, staleImmediate: stale.length,
    settledCorrect: samples.length, example: stale[0] ?? samples[0] }, null, 2));
} finally { await browser.close(); }
