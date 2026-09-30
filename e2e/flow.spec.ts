import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SCREENSHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => {
    const token = localStorage.getItem('gc.token');
    const res = await fetch(`/api/v1${p}`, { headers: { authorization: `Bearer ${token}` } });
    return res.json();
  }, path);
}

test('flujo completo: registro, kiosco, llamado en pantalla y seguimiento', async ({ page, browser }) => {
  // 1. Alta de la organización (SaaS)
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('sin filas');
  await shot(page, '01-landing');
  await page.getByRole('link', { name: 'Probar gratis' }).click();
  await page.getByLabel('Nombre de la organización').fill('Clínica E2E');
  await page.getByLabel('Su nombre').fill('Ana Admin');
  await page.getByLabel('Email').fill(`ana+${Date.now()}@e2e.test`);
  await page.getByLabel('Contraseña').fill('password123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  // Una organización nueva empieza por el asistente de configuración; esta prueba lo omite.
  await expect(page).toHaveURL(/\/app\/bienvenida$/);
  await expect(page.getByText('¿A qué se dedica su organización?')).toBeVisible();
  await page.getByRole('button', { name: 'Omitir por ahora' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Clínica E2E').first()).toBeVisible();
  await shot(page, '02-dashboard');

  const displays = await apiGet<{ token: string }[]>(page, '/displays');
  const kiosks = await apiGet<{ token: string }[]>(page, '/kiosks');

  // 2. Pantalla de TV en otra ventana
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage();
  await tv.goto(`/pantalla/${displays[0]!.token}`);
  await expect(tv.getByText('Bienvenidos a Clínica E2E')).toBeVisible();
  await tv.mouse.click(400, 400);

  // 3. Kiosco: emitir un turno preferencial
  const kioskContext = await browser.newContext({ viewport: { width: 1080, height: 1500 } });
  const kiosk = await kioskContext.newPage();
  await kiosk.goto(`/kiosco/${kiosks[0]!.token}`);
  await expect(kiosk.getByText('¡Bienvenido!')).toBeVisible();
  await shot(kiosk, '03-kiosco');
  await kiosk.getByRole('button', { name: /Atención al cliente/ }).click();
  await kiosk.getByRole('button', { name: /Atención preferencial/ }).click();
  await expect(kiosk.getByText('A001')).toBeVisible();
  await shot(kiosk, '04-kiosco-turno');

  // 4. Fila virtual desde el celular
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/kiosco/${kiosks[0]!.token}?modo=movil`);
  await phone.getByRole('button', { name: /Caja/ }).click();
  await phone.getByRole('button', { name: /Atención general/ }).click();
  await expect(phone.getByText('C001')).toBeVisible();
  await phone.getByRole('link', { name: /Ver mi turno en vivo/ }).click();
  await expect(phone).toHaveURL(/\/t\//);
  await expect(phone.getByText('C001')).toBeVisible();
  await expect(phone.getByText('personas antes que usted')).toBeVisible();
  await shot(phone, '05-seguimiento-espera');

  // 5. Operador: configurar puesto y llamar
  await page.goto('/app/atencion');
  await page.getByRole('combobox', { name: 'Ventanilla', exact: true }).selectOption({ label: 'Ventanilla 1' });
  await page.getByRole('button', { name: 'Todos' }).click();
  await page.getByRole('button', { name: 'Guardar puesto' }).click();
  await page.getByRole('button', { name: 'Llamar siguiente' }).click();
  await expect(page.getByText('A001').first()).toBeVisible();
  await shot(page, '06-consola');

  // La pantalla muestra el llamado en tiempo real
  await expect(tv.getByText('A001').first()).toBeVisible();
  await expect(tv.getByText('Ventanilla 1').first()).toBeVisible();
  await shot(tv, '07-pantalla-llamado');

  // 6. Atender y llamar al cliente de la fila virtual
  await page.getByRole('button', { name: 'Iniciar atención' }).click();
  await page.getByRole('button', { name: 'Finalizar', exact: true }).click();
  await page.getByRole('button', { name: 'Llamar siguiente' }).click();
  await expect(page.getByText('C001').first()).toBeVisible();
  await expect(phone.getByText('¡Es su turno!')).toBeVisible();
  await shot(phone, '08-seguimiento-llamado');

  // 7. Publicidad: agregar un video de YouTube a la biblioteca
  await page.goto('/app/contenido');
  await page.getByRole('button', { name: 'Desde URL' }).click();
  await page.getByLabel('URL').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(page.getByText('YouTube').first()).toBeVisible();
  await page.getByRole('button', { name: 'Agregar a la biblioteca' }).click();
  await expect(page.getByText('YouTube dQw4w9WgXcQ', { exact: true })).toBeVisible();
  await shot(page, '09-biblioteca');

  // 8. Reportes del día
  await page.goto('/app/reportes');
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  await shot(page, '10-reportes');

  await Promise.all([tvContext.close(), kioskContext.close(), phoneContext.close()]);
});
