import { expect, test, type Page } from '@playwright/test';

const ROOT = { email: 'root@e2e.test', password: 'RootE2e2026!' };

async function loginAsRoot(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ROOT.email);
  await page.getByLabel('Contraseña').fill(ROOT.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/plataforma/);
}

/** Deja los ajustes como estaban para las demás pruebas (registro abierto, página de presentación). */
async function restoreSettings(page: Page) {
  await page.evaluate(async () => {
    await fetch('/api/v1/platform/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('gc.token')}` },
      body: JSON.stringify({ homePage: 'landing', allowSignup: true, allowDemo: true, allowEmailLogin: true, brand: { appName: 'Gestión de Colas' } }),
    });
  });
}

test('el superadministrador configura la página principal, la marca y el registro', async ({ page, browser }) => {
  await loginAsRoot(page);
  try {
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.getByRole('radio', { name: /Pantalla de ingreso/ }).click();
    await page.getByRole('switch', { name: /Registro de organizaciones/ }).click();
    await page.getByLabel('Nombre de la plataforma').fill('Turnos Norte');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Ajustes de la plataforma guardados')).toBeVisible();

    // Quien entra a la dirección principal ve directamente el ingreso, con la marca nueva y sin registro.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto('/');
    await expect(visitor).toHaveURL(/\/login$/);
    await expect(visitor.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(visitor.getByText('Turnos Norte').first()).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Cree su organización' })).toHaveCount(0);
    await visitor.context().close();

    // Con la sesión abierta, /login pregunta en vez de redirigir sin avisar.
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Ya inició sesión' })).toBeVisible();
    await page.getByRole('button', { name: /Continuar como/ }).click();
    await expect(page).toHaveURL(/\/plataforma/);
  } finally {
    await restoreSettings(page);
  }
});

test('crea una organización con invitación y agrega superadministradores', async ({ page, browser }) => {
  await loginAsRoot(page);

  // Organización con invitación: sin correo, se muestra el enlace para compartirlo.
  const adminEmail = `ana+${Date.now()}@e2e.test`;
  await page.getByRole('button', { name: 'Nueva organización' }).first().click();
  await page.getByLabel('Nombre de la organización').fill('Clínica Invitada');
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Ana Admin');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByRole('switch', { name: /Enviar una invitación/ }).click();
  await page.getByRole('button', { name: 'Crear organización' }).click();
  await expect(page.getByRole('heading', { name: 'Comparta la invitación' })).toBeVisible();
  const inviteUrl = await page.getByRole('dialog').locator('input[readonly]').inputValue();
  expect(inviteUrl).toMatch(/\/invitacion\?token=/);
  await page.getByRole('button', { name: 'Listo' }).click();

  const invited = await (await browser.newContext()).newPage();
  await invited.goto(inviteUrl);
  await invited.getByLabel('Nueva contraseña').fill('AnaClave2026');
  await invited.getByLabel('Repita la contraseña').fill('AnaClave2026');
  await invited.getByRole('button', { name: 'Aceptar e ingresar' }).click();
  await expect(invited).toHaveURL(/\/app/);
  await invited.context().close();

  // El uso de la organización se ve en la lista y sus usuarios se pueden administrar.
  const row = page.getByRole('listitem').filter({ hasText: 'Clínica Invitada' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Usuarios' }).click();
  await expect(page.getByRole('dialog').getByText(adminEmail)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Enlace de acceso' }).click();
  await expect(page.getByText(/Quien abra este enlace entra como/)).toBeVisible();
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.keyboard.press('Escape');

  // Superadministradores
  await page.getByRole('button', { name: 'Superadministradores', exact: true }).click();
  await expect(page.getByRole('table').getByText(ROOT.email)).toBeVisible();
  await page.getByRole('button', { name: 'Agregar superadministrador' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Soporte Nivel 2');
  const supportEmail = `soporte+${Date.now()}@e2e.test`;
  await dialog.getByLabel('Email').fill(supportEmail);
  await dialog.getByRole('textbox', { name: /^Contraseña/ }).fill('Soporte2026!');
  await dialog.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText(supportEmail)).toBeVisible();
});
