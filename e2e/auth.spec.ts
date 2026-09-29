import { expect, test, type APIRequestContext } from '@playwright/test';

interface Mail {
  to: string;
  tag: string;
  text: string;
}

async function lastMail(request: APIRequestContext, to: string, tag: string): Promise<Mail> {
  for (let i = 0; i < 20; i++) {
    const outbox = (await (await request.get('/api/v1/dev/outbox')).json()) as Mail[];
    const mail = outbox.find((m) => m.to === to && m.tag === tag);
    if (mail) return mail;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No llegó el correo ${tag} a ${to}`);
}
const linkIn = (text: string) => /(https?:\/\/\S+token=[A-Za-z0-9]+)/.exec(text)![1]!;
const codeIn = (text: string) => /Código: (\d{6})/.exec(text)![1]!;

test('olvidé mi contraseña y acceso con código por correo', async ({ page, request }) => {
  const email = `olvido+${Date.now()}@e2e.test`;
  const reg = await request.post('/api/v1/auth/register', {
    data: { organizationName: 'Olvido SA', name: 'Omar', email, password: 'password123' },
  });
  expect(reg.status()).toBe(201);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('link', { name: '¿Olvidó su contraseña?' }).click();
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText('Revise su correo')).toBeVisible();

  await page.goto(linkIn((await lastMail(request, email, 'reset_password')).text));
  await page.getByLabel('Nueva contraseña').fill('nuevaClave456');
  await page.getByLabel('Repita la contraseña').fill('nuevaClave456');
  await page.getByRole('button', { name: 'Guardar e ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('¿Qué desea abrir?')).toBeVisible();

  // Cerrar sesión e ingresar sin contraseña con el código del correo.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.goto('/ingresar-con-correo');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Enviarme el código' }).click();
  await page.getByLabel('Código de 6 dígitos').fill(codeIn((await lastMail(request, email, 'email_login')).text));
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('demo por correo y vinculación de una TV con código', async ({ page, browser, request }) => {
  const email = `demo+${Date.now()}@e2e.test`;
  await page.goto('/');
  await page.getByRole('link', { name: /Recibir una demo por correo/ }).click();
  await page.getByLabel('Su nombre').fill('Diana Demo');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Enviarme la demo' }).click();
  await expect(page.getByText('¡Su demo está lista!')).toBeVisible();

  await page.goto(linkIn((await lastMail(request, email, 'demo')).text));
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Está usando una')).toBeVisible();
  await expect(page.getByText('Panel TV')).toBeVisible();
  await expect(page.getByText('Kiosco / triage')).toBeVisible();

  // La TV abre /vincular y muestra un código.
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage();
  await tv.goto('/vincular');
  const codeText = await tv.getByLabel(/^Código \d/).getAttribute('aria-label');
  const code = codeText!.replace(/\D/g, '');
  expect(code).toHaveLength(6);

  // Desde el portal se ingresa el código y se elige la pantalla.
  await page.getByLabel('Código del dispositivo').fill(code);
  await page.getByRole('button', { name: 'Vincular', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/vincular\?code=/);
  await page.getByRole('button', { name: 'Vincular dispositivo' }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();

  await expect(tv).toHaveURL(/\/pantalla\//, { timeout: 15_000 });
  await expect(tv.getByText('Pague sus servicios sin filas').or(tv.getByText(/Bienvenidos a/).first())).toBeVisible();

  // Al volver a /vincular, el equipo recuerda su pantalla.
  await tv.goto('/vincular');
  await expect(tv).toHaveURL(/\/pantalla\//);
  await tvContext.close();

  // Biblioteca de sonidos: los tonos incluidos se pueden descargar.
  await page.goto('/app/sonidos');
  await expect(page.getByText('Campana suave')).toBeVisible();
  const wav = await request.get('/sounds/chime-soft.wav');
  expect(wav.headers()['content-type']).toContain('audio');
});
