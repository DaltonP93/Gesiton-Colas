import { expect, test } from '@playwright/test';

/** Ninguna página se desborda a lo ancho en celulares y tablets. */
const PAGES = [
  '/app',
  '/app/resumen',
  '/app/atencion',
  '/app/monitor',
  '/app/configuracion',
  '/app/configuracion/marca',
  '/app/configuracion/servicios',
  '/app/configuracion/usuarios',
  '/app/configuracion/cliente',
  '/app/pantallas',
  '/app/kioscos',
  '/app/contenido',
  '/app/listas',
  '/app/reportes',
  '/app/sonidos',
  '/app/facturacion',
  '/app/perfil',
];

for (const [name, viewport] of [
  ['celular', { width: 360, height: 780 }],
  ['tablet', { width: 820, height: 1180 }],
] as const) {
  test(`sin desborde horizontal en ${name}`, async ({ browser, page }) => {
    // Organización nueva (con sesión) para recorrer el panel.
    await page.goto('/registro');
    await page.getByLabel('Nombre de la organización', { exact: true }).fill(`Adaptable ${name}`);
    await page.getByLabel('Su nombre').fill('Ada');
    await page.getByLabel('Email').fill(`adaptable-${name}-${Date.now()}@e2e.test`);
    await page.getByLabel('Contraseña').fill('password123');
    const terms = page.getByRole('checkbox');
    if (await terms.count()) await terms.check();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/app\/bienvenida$/);
    const token = await page.evaluate(() => localStorage.getItem('gc.token'));
    const kiosk = await page.evaluate(async (t) => (await (await fetch('/api/v1/kiosks', { headers: { authorization: `Bearer ${t}` } })).json())[0].token as string, token);

    const ctx = await browser.newContext({ viewport, isMobile: name === 'celular', hasTouch: true });
    await ctx.addInitScript((t) => localStorage.setItem('gc.token', t!), token);
    const mobile = await ctx.newPage();
    const overflowing: string[] = [];
    for (const path of [...PAGES, '/', '/login', '/terminos', `/kiosco/${kiosk}?modo=movil`]) {
      await mobile.goto(path);
      await mobile.waitForLoadState('networkidle');
      const extra = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (extra > 1) overflowing.push(`${path} (+${extra}px)`);
    }
    await ctx.close();
    expect(overflowing).toEqual([]);
  });
}
