import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { authTokens, type AuthTokenPurpose } from '../db/schema';
import { randomToken, safeEqual, sha256 } from './crypto';
import { badRequest } from './errors';

const MINUTE = 60_000;

/** Vigencia de cada tipo de enlace. */
export const TOKEN_TTL: Record<AuthTokenPurpose, number> = {
  verify_email: 3 * 24 * 60 * MINUTE,
  reset_password: 60 * MINUTE,
  email_login: 15 * MINUTE,
  invite: 7 * 24 * 60 * MINUTE,
};

const MAX_CODE_ATTEMPTS = 5;
const codeHash = (userId: string, code: string) => sha256(`${userId}:${code}`);

/**
 * Crea un enlace de un solo uso (y opcionalmente un código de 6 dígitos).
 * Los enlaces anteriores del mismo tipo para el usuario quedan invalidados.
 */
export async function issueToken(
  db: DbOrTx,
  userId: string,
  purpose: AuthTokenPurpose,
  options: { ttlMs?: number; withCode?: boolean } = {},
): Promise<{ token: string; code: string | null }> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
  const token = randomToken(40);
  const code = options.withCode ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;
  await db.insert(authTokens).values({
    userId,
    purpose,
    tokenHash: sha256(token),
    codeHash: code ? codeHash(userId, code) : null,
    expiresAt: new Date(Date.now() + (options.ttlMs ?? TOKEN_TTL[purpose])),
  });
  return { token, code };
}

const INVALID = 'El enlace no es válido o ya venció. Solicite uno nuevo.';

/** Busca un enlace válido sin consumirlo (p. ej. para mostrar los datos de una invitación). */
export async function peekToken(db: DbOrTx, token: string, purpose: AuthTokenPurpose) {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) throw badRequest(INVALID);
  return row;
}

/** Consume un enlace de un solo uso y devuelve el usuario al que pertenece. */
export async function consumeToken(db: DbOrTx, token: string, purpose: AuthTokenPurpose): Promise<string> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning({ userId: authTokens.userId });
  if (!row) throw badRequest(INVALID);
  return row.userId;
}

/** Verifica un código de 6 dígitos (máximo 5 intentos por código). */
export async function consumeCode(db: DbOrTx, userId: string, code: string, purpose: AuthTokenPurpose = 'email_login'): Promise<void> {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
        isNotNull(authTokens.codeHash),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authTokens.createdAt))
    .limit(1);
  if (!row) throw badRequest('El código no es válido o venció. Solicite uno nuevo.');
  // Se cuenta el intento antes de comparar y de forma atómica: pedidos en paralelo no superan el máximo.
  const [counted] = await db
    .update(authTokens)
    .set({ attempts: sql`${authTokens.attempts} + 1` })
    .where(and(eq(authTokens.id, row.id), sql`${authTokens.attempts} < ${MAX_CODE_ATTEMPTS}`))
    .returning({ id: authTokens.id });
  if (!counted) throw badRequest('El código no es válido o venció. Solicite uno nuevo.');
  if (!safeEqual(row.codeHash ?? '', codeHash(userId, code.trim()))) throw badRequest('El código es incorrecto.');
  const used = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, row.id), isNull(authTokens.usedAt)))
    .returning({ id: authTokens.id });
  if (used.length === 0) throw badRequest('El código ya fue utilizado.');
}
