import { test, expect } from '@playwright/test';

test('pantalla de login muestra acceso privado', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Natillera Manager' })).toBeVisible();
  await expect(page.getByLabel('Correo autorizado')).toBeVisible();
});
