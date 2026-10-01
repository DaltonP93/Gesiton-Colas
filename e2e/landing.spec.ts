import { expect, test, type Page } from '@playwright/test';

const ROOT = { email: 'root@e2e.test', password: 'RootE2e2026!' };
// PNG de 1x1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function loginAsRoot(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ROOT.email);
  await page.getByLabel('Contraseña').fill(ROOT.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/plataforma/);
}

test('el superadministrador arma la página de presentación con otra plantilla y la publica', async ({ page, browser }) => {
  await loginAsRoot(page);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('link', { name: 'Personalizar' }).click();
  await expect(page).toHaveURL(/\/plataforma\/presentacion$/);

  // Plantilla oscura y título nuevo: la vista previa cambia sin guardar.
  await page.getByRole('button', { name: /^Oscura/ }).click();
  await page.getByRole('button', { name: 'Portada', exact: true }).click();
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Turnos claros para cada sucursal');
  await page.getByLabel('Palabras resaltadas').fill('cada sucursal');
  const preview = page.frameLocator('iframe[title="Vista previa de la página de presentación"]');
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Turnos claros para cada sucursal');

  // Una sección de contacto nueva.
  await page.getByRole('button', { name: 'Secciones', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar sección' }).click();
  await page.getByRole('button', { name: /^Contacto/ }).click();
  await page.getByRole('textbox', { name: 'Correo', exact: true }).fill('ventas@turnos.test');
  await expect(preview.getByText('ventas@turnos.test')).toBeVisible();

  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Página de presentación publicada.')).toBeVisible();

  // Cualquiera la ve en /presentacion y en la dirección principal, con el título para compartir.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/presentacion');
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Turnos claros para cada sucursal');
  await expect(visitor.getByRole('link', { name: /ventas@turnos\.test/ })).toHaveAttribute('href', 'mailto:ventas@turnos.test');
  const html = await (await visitor.request.get('/')).text();
  expect(html).toContain('og:title');
  await visitor.goto('/');
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Turnos claros para cada sucursal');

  // Vuelve a la plantilla y los textos de ejemplo para las demás pruebas.
  await page.evaluate(async () => {
    const token = localStorage.getItem('gc.token');
    const res = await fetch('/api/v1/platform/settings', { headers: { authorization: `Bearer ${token}` } });
    const current = await res.json();
    await fetch('/api/v1/platform/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        landing: {
          template: 'moderna',
          hero: { title: 'Atienda mejor, sin filas y con su marca en cada pantalla.', highlight: 'sin filas' },
          sections: current.landing.sections.filter((s: { type: string }) => s.type !== 'contact'),
        },
      }),
    });
  });
});

test('el superadministrador sube su foto de perfil desde «Mi perfil»', async ({ page }) => {
  await loginAsRoot(page);
  await page.getByRole('button', { name: 'Mi cuenta' }).click();
  await page.getByRole('menuitem', { name: 'Mi perfil' }).click();
  await expect(page).toHaveURL(/\/plataforma\/perfil$/);

  await page.getByLabel('Elegir foto de perfil').setInputFiles({ name: 'yo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog', { name: 'Recortar la foto' })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar foto' }).click();
  await expect(page.getByText('Foto actualizada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cambiar foto' })).toBeVisible();
  // La foto aparece en el encabezado.
  await expect(page.locator('header img[src*="/uploads/avatars/"]')).toBeVisible();

  await page.getByRole('button', { name: 'Quitar' }).click();
  await page.getByRole('button', { name: 'Quitar' }).last().click();
  await expect(page.getByText('Foto quitada.')).toBeVisible();
});
