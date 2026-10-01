import { expect, test, type Page } from '@playwright/test';

const ROOT = { email: 'root@e2e.test', password: 'RootE2e2026!' };

async function loginAsRoot(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ROOT.email);
  await page.getByLabel('Contraseña').fill(ROOT.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/plataforma/);
}

/** Llamada a la API con la sesión del navegador. */
const callApi = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('gc.token')}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    },
    { method, path, body },
  );

test('el superadministrador publica los términos y cada organización los acepta', async ({ page, browser }) => {
  await loginAsRoot(page);
  try {
    await page.goto('/plataforma#legal');
    await page.getByLabel('Razón social o nombre').fill('Turnos del Paraguay S.A.');
    await page.getByLabel('RUC').fill('80099999-1');
    await page.getByLabel('Domicilio').fill('Av. España 1000, Asunción');
    await page.getByLabel('Correo de contacto').fill('legal@turnos.test');
    await page.getByRole('button', { name: 'Guardar datos del titular' }).click();
    await expect(page.getByText('Datos legales guardados')).toBeVisible();

    for (const title of ['Términos y condiciones del servicio', 'Acuerdo de tratamiento de datos personales']) {
      await page.locator('div.py-3', { hasText: title }).getByRole('button', { name: 'Revisar y publicar' }).click();
      await expect(page.getByRole('dialog').getByText('Turnos del Paraguay S.A.').first()).toBeVisible();
      await page.getByRole('button', { name: 'Publicar versión 1' }).click();
      await page.getByRole('button', { name: 'Publicar', exact: true }).click();
      await expect(page.getByText(`Publicada la versión 1 de «${title}»`)).toBeVisible();
    }

    // El registro pide la casilla.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto('/registro');
    await visitor.getByLabel('Nombre de la organización').fill('Clínica Términos');
    await visitor.getByLabel('Su nombre').fill('Tere Admin');
    await visitor.getByLabel('Email').fill(`terminos-${Date.now()}@e2e.test`);
    await visitor.getByLabel('Contraseña').fill('clave-segura-123');
    const create = visitor.getByRole('button', { name: 'Crear cuenta' });
    await expect(create).toBeDisabled();
    await visitor.getByRole('checkbox').check();
    await create.click();
    await expect(visitor).toHaveURL(/\/app\/bienvenida$/);

    // La página pública muestra el texto con los datos del titular.
    const reader = await (await browser.newContext()).newPage();
    await reader.goto('/terminos');
    await expect(reader.getByRole('heading', { name: 'Términos y condiciones del servicio' })).toBeVisible();
    await expect(reader.getByText('Turnos del Paraguay S.A.').first()).toBeVisible();
    await reader.context().close();

    // Una versión importante nueva: el administrador la acepta antes de seguir.
    const terms = (await callApi(page, 'GET', '/platform/legal')).body.documents[0];
    expect((await callApi(page, 'POST', '/platform/legal/terms/publish', { source: terms.source, note: 'Nuevos módulos' })).status).toBe(200);
    await visitor.goto('/app/configuracion');
    const gate = visitor.getByRole('dialog', { name: /Actualizamos los términos del servicio/ });
    await expect(gate).toBeVisible();
    await expect(gate.getByText('Versión 2 · Nuevos módulos')).toBeVisible();
    await gate.getByRole('checkbox').check();
    await gate.getByRole('button', { name: 'Aceptar y continuar' }).click();
    await expect(gate).toBeHidden();
    await visitor.goto('/app/configuracion/contrato');
    await expect(visitor.getByText(/Versión 2, por Tere Admin/)).toBeVisible();
    await visitor.context().close();
  } finally {
    await callApi(page, 'PUT', '/platform/legal/settings', { requireAcceptance: false });
  }
});
