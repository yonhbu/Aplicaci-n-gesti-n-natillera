import type { Page } from '@playwright/test';

// setViewportSize acknowledges the emulation command before Chromium necessarily
// applies its responsive styles. Measure after a rendering opportunity, not just
// after innerWidth changes. This does not retry or relax any geometry assertion.
export async function renderedLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

export async function responsiveViewport(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await renderedLayout(page);
}
