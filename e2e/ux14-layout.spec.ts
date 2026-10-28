import { readFileSync } from 'node:fs';
import { expect, test } from './test-fixtures';
import { renderedLayout, responsiveViewport } from './responsive-layout';

test('UX14: responsive styles and enlarged text settle before measuring complete words', async ({ page }) => {
  // Exercise the real cascade without authentication or financial fixtures. The
  // monospace fallback makes the old 244px container too small on both OSes.
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${readFileSync('src/styles.css', 'utf8')}</style>
    <main class="layout"><div class="more-layout" data-mode="module"><div class="more-content">
    <section class="admin-page more-page"><div class="hero-band"><div class="hero-band-top"><div>
    <h2 style="font-family: 'Courier New', monospace">Mi ganancia como administrador</h2>
    </div><button>Registrar retiro</button></div></div></section></div></div></main>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await renderedLayout(page);
  for (let pass = 0; pass < 3; pass++) {
    await responsiveViewport(page, { width: 390, height: 900 });
    await expect(page.locator('.hero-band')).toHaveCSS('padding-left', '22px');
    await responsiveViewport(page, { width: 320, height: 900 });
    const geometry = await page.evaluate(() => {
      const title = document.querySelector('h2')!;
      const text = title.firstChild!;
      const start = text.textContent!.indexOf('administrador');
      const word = document.createRange(); word.setStart(text, start); word.setEnd(text, start + 'administrador'.length);
      const box = title.getBoundingClientRect();
      return {
        viewport: innerWidth, padding: getComputedStyle(title.closest('.hero-band')!).paddingLeft,
        fontSize: getComputedStyle(title).fontSize, rootSize: getComputedStyle(document.documentElement).fontSize,
        width: box.width, left: box.left, right: box.right,
        word: [...word.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top })),
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    expect(geometry.viewport).toBe(320);
    expect(geometry.padding).toBe('8px');
    expect(geometry.rootSize).toBe('32px');
    expect(geometry.fontSize).toBe('32px');
    expect(geometry.width).toBe(272);
    expect(new Set(geometry.word.map(rect => rect.top)).size).toBe(1);
    for (const rect of geometry.word) {
      expect(rect.left).toBeGreaterThanOrEqual(geometry.left - 1);
      expect(rect.right).toBeLessThanOrEqual(geometry.right + 1);
    }
    expect(geometry.overflow).toBe(false);
  }
});
