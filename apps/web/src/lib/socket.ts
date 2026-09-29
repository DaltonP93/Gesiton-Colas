import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';

export type SocketKind = 'user' | 'display' | 'kiosk' | 'ticket';

/** Conexión en tiempo real con reconexión automática. */
export function connectSocket(kind: SocketKind, token: string): Socket {
  return io(API_BASE || window.location.origin, {
    auth: { kind, token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });
}
