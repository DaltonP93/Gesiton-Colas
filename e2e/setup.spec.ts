import { expect, test } from '@playwright/test';

test('asistente de configuración: rubro, marca, sucursal, servicios y pantallas', async ({ page, browser }) => {
  await page.goto('/registro');
  await page.getByLabel('Nombre de la organización').fill('Sanatorio Asistente');
  await page.getByLabel('Su nombre').fill('Sara Setup');
  await page.getByLabel('Email').fill(`sara+${Date.now()}@e2e.test`);
  await page.getByLabel('Contraseña').fill('password123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/app\/bienvenida$/);

  // 1. Rubro: propone terminología y servicios de salud.
  await page.getByRole('radio', { name: /Clínica, sanatorio o laboratorio/ }).click();
  await page.getByRole('button', { name: /Siguiente/ }).click();

  // 2. Marca: menú oscuro.
  await page.getByRole('button', { name: 'Oscuro', exact: true }).click();
  await page.getByRole('button', { name: /Siguiente/ }).click();

  // 3. Sucursal con 4 consultorios.
  await page.getByLabel('Nombre de la sucursal').fill('Sede Centro');
  await page.getByRole('button', { name: 'Uno más' }).click();
  await expect(page.getByText('Consultorio 4')).toBeVisible();
  await page.getByRole('button', { name: /Siguiente/ }).click();

  // 4. Servicios sugeridos: Admisión con la letra A (los genéricos quedan desactivados).
  await expect(page.getByRole('textbox', { name: 'Nombre' }).nth(2)).toHaveValue('Admisión');
  await expect(page.getByRole('textbox', { name: 'Letra' }).nth(2)).toHaveValue('A');
  await page.getByRole('button', { name: /Siguiente/ }).click();

  // 5. Pantalla y kiosco.
  await page.getByRole('button', { name: /Solo turnos/ }).click();
  await page.getByRole('button', { name: 'Aplicar configuración' }).click();
  await expect(page.getByText('¡Su sistema está listo!')).toBeVisible({ timeout: 20_000 });

  // Se aplicó: terminología, puestos y servicios.
  await page.goto('/app/configuracion/sucursales');
  await expect(page.getByText('Sede Centro')).toBeVisible();
  await expect(page.getByText('Consultorio 4', { exact: true })).toBeVisible();

  const kiosks = await page.evaluate(async () => {
    const res = await fetch('/api/v1/kiosks', { headers: { authorization: `Bearer ${localStorage.getItem('gc.token')}` } });
    return (await res.json()) as { token: string }[];
  });
  const kioskContext = await browser.newContext({ viewport: { width: 1080, height: 1440 } });
  const kiosk = await kioskContext.newPage();
  await kiosk.goto(`/kiosco/${kiosks[0]!.token}`);
  await expect(kiosk.getByRole('button', { name: /Admisión/ })).toBeVisible();
  await expect(kiosk.getByRole('button', { name: /Laboratorio/ })).toBeVisible();
  await expect(kiosk.getByRole('button', { name: /^Caja/ })).toHaveCount(0);
  await kioskContext.close();

  // El inicio ya no ofrece el asistente.
  await page.goto('/app');
  await expect(page.getByText('Configure su sistema en 5 pasos')).toHaveCount(0);
});
