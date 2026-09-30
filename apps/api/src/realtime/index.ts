import type { Server as HttpServer } from 'node:http';
import { and, eq } from 'drizzle-orm';
import { Server, type Socket } from 'socket.io';
import { hasRole } from '@gc/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Auth } from '../lib/auth';
import type { Database } from '../db/client';
import { branches, displays, kiosks, tickets, userBranches } from '../db/schema';

export const rooms = {
  tenant: (id: string) => `tenant:${id}`,
  devices: (tenantId: string) => `devices:${tenantId}`,
  /** Sala pública de la sucursal (pantallas y kioscos): sin datos personales. */
  branch: (id: string) => `branch:${id}`,
  /** Kioscos de una sucursal: solo reciben cambios de la cola, nunca los llamados (con nombres). */
  kioskBranch: (id: string) => `kiosk-branch:${id}`,
  /** Sala del personal de la sucursal: datos completos. */
  staff: (id: string) => `staff:${id}`,
  display: (id: string) => `display:${id}`,
  kiosk: (id: string) => `kiosk:${id}`,
  track: (token: string) => `track:${token}`,
};

type HandshakeAuth = { kind?: 'user' | 'display' | 'kiosk' | 'ticket'; token?: string };

/**
 * Canal de tiempo real (Socket.IO). Pantallas, kioscos, operadores y clientes reciben
 * los cambios de la cola al instante. Si no hay servidor HTTP asociado (tests), las
 * emisiones son no-op.
 */
export class Realtime {
  io: Server | null = null;

  constructor(
    private readonly db: Database,
    private readonly auth: Auth,
    private readonly log: FastifyBaseLogger,
    private readonly corsOrigins: string,
  ) {}

  attach(server: HttpServer) {
    const origins = this.corsOrigins === '*' ? true : this.corsOrigins.split(',').map((o) => o.trim());
    this.io = new Server(server, { cors: { origin: origins, credentials: true }, serveClient: false, pingInterval: 20_000 });
    this.io.on('connection', (socket) => {
      this.onConnection(socket).catch((error) => {
        this.log.warn({ err: error }, 'realtime: conexión rechazada');
        socket.emit('error:auth', { message: 'No autorizado' });
        socket.disconnect(true);
      });
    });
  }

  private async onConnection(socket: Socket) {
    const { kind, token } = (socket.handshake.auth ?? {}) as HandshakeAuth;
    if (!token) throw new Error('token requerido');

    if (kind === 'display') {
      const [display] = await this.db.select().from(displays).where(eq(displays.token, token)).limit(1);
      if (!display) throw new Error('pantalla inválida');
      await socket.join([rooms.branch(display.branchId), rooms.display(display.id), rooms.devices(display.tenantId)]);
      const touch = () =>
        this.db.update(displays).set({ lastSeenAt: new Date() }).where(eq(displays.id, display.id)).catch(() => undefined);
      await touch();
      const heartbeat = setInterval(touch, 60_000);
      socket.on('disconnect', () => {
        clearInterval(heartbeat);
        void touch();
      });
      socket.emit('ready', { kind: 'display', id: display.id });
      return;
    }

    if (kind === 'kiosk') {
      const [kiosk] = await this.db.select().from(kiosks).where(eq(kiosks.token, token)).limit(1);
      if (!kiosk) throw new Error('kiosco inválido');
      await socket.join([rooms.kioskBranch(kiosk.branchId), rooms.kiosk(kiosk.id), rooms.devices(kiosk.tenantId)]);
      await this.db.update(kiosks).set({ lastSeenAt: new Date() }).where(eq(kiosks.id, kiosk.id));
      socket.emit('ready', { kind: 'kiosk', id: kiosk.id });
      return;
    }

    if (kind === 'ticket') {
      const [ticket] = await this.db
        .select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.publicToken, token))
        .limit(1);
      if (!ticket) throw new Error('turno inválido');
      await socket.join(rooms.track(token));
      socket.emit('ready', { kind: 'ticket' });
      return;
    }

    const found = await this.auth.userFromToken(token);
    if (!found || !found.user.tenantId) throw new Error('usuario inválido');
    const tenantId = found.user.tenantId;
    // Un operador asignado a ciertas sucursales solo recibe los datos (con nombres y documentos) de esas.
    const restrictedTo = hasRole(found.user.role, 'manager')
      ? null
      : (await this.db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, found.user.id))).map((r) => r.id);
    await socket.join(rooms.tenant(tenantId));
    socket.on('subscribe:branch', async (branchId: unknown, ack?: (ok: boolean) => void) => {
      if (typeof branchId !== 'string') return ack?.(false);
      const [branch] = await this.db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)))
        .limit(1)
        .catch(() => []);
      if (!branch) return ack?.(false);
      if (restrictedTo && restrictedTo.length > 0 && !restrictedTo.includes(branch.id)) return ack?.(false);
      for (const room of socket.rooms) if (room.startsWith('staff:')) await socket.leave(room);
      await socket.join(rooms.staff(branch.id));
      ack?.(true);
    });
    socket.emit('ready', { kind: 'user', id: found.user.id });
  }

  emit(room: string | string[], event: string, payload: unknown) {
    this.io?.to(room).emit(event, payload);
  }

  /** Desconecta a los clientes sin cerrar el servidor HTTP (Fastify lo cierra). */
  close() {
    if (!this.io) return;
    this.io.disconnectSockets(true);
    this.io.engine.close();
    this.io = null;
  }
}
