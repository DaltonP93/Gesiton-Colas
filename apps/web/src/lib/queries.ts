import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type {
  ApiKeyDTO,
  BranchDTO,
  CounterDTO,
  DepartmentDTO,
  DisplayDTO,
  KioskDTO,
  MediaDTO,
  PlaylistDTO,
  PriorityDTO,
  QueueSnapshotDTO,
  ServiceDTO,
  UserDTO,
  WebhookDTO,
} from '@gc/shared';
import { RT } from '@gc/shared';
import { api, session } from './api';
import { useAuth } from './auth';
import { connectSocket } from './socket';

const list = <T,>(path: string) => () => api.get<T[]>(path);

export const useBranches = () => useQuery({ queryKey: ['branches'], queryFn: list<BranchDTO>('/branches') });
export const useServices = () => useQuery({ queryKey: ['services'], queryFn: list<ServiceDTO>('/services') });
export const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: list<DepartmentDTO>('/departments') });
export const usePriorities = () => useQuery({ queryKey: ['priorities'], queryFn: list<PriorityDTO>('/priorities') });
export const useCounters = (branchId?: string | null) =>
  useQuery({
    queryKey: ['counters', branchId ?? 'all'],
    queryFn: list<CounterDTO>(branchId ? `/counters?branchId=${branchId}` : '/counters'),
  });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: list<UserDTO>('/users') });
// Pantallas, kioscos y listas solo se consultan si la organización tiene el módulo activo.
export const useDisplays = () => {
  const { hasModule } = useAuth();
  return useQuery({ queryKey: ['displays'], queryFn: list<DisplayDTO>('/displays'), enabled: hasModule('displays') });
};
export const useKiosks = () => {
  const { hasModule } = useAuth();
  return useQuery({ queryKey: ['kiosks'], queryFn: list<KioskDTO>('/kiosks'), enabled: hasModule('kiosks') });
};
export const useMedia = () => useQuery({ queryKey: ['media'], queryFn: list<MediaDTO>('/media') });
export const usePlaylists = () => {
  const { hasModule } = useAuth();
  return useQuery({ queryKey: ['playlists'], queryFn: list<PlaylistDTO>('/playlists'), enabled: hasModule('advertising') });
};
export const useApiKeys = () => {
  const { hasModule } = useAuth();
  return useQuery({ queryKey: ['api-keys'], queryFn: list<ApiKeyDTO>('/api-keys'), enabled: hasModule('integrations') });
};
export const useWebhooks = () => {
  const { hasModule } = useAuth();
  return useQuery({ queryKey: ['webhooks'], queryFn: list<WebhookDTO>('/webhooks'), enabled: hasModule('integrations') });
};

export function useQueue(branchId: string | null | undefined, serviceIds: string[] = []) {
  const qs = serviceIds.length ? `?serviceIds=${serviceIds.join(',')}` : '';
  return useQuery({
    queryKey: ['queue', branchId, serviceIds.join(',')],
    queryFn: () => api.get<QueueSnapshotDTO>(`/branches/${branchId}/queue${qs}`),
    enabled: Boolean(branchId),
    refetchInterval: 30_000,
  });
}

/**
 * Crear/actualizar un recurso REST: POST `/recurso` si no hay id, PUT `/recurso/:id` si lo hay.
 * Invalida las consultas indicadas al terminar.
 */
export function useSave<T = unknown>(resource: string, invalidate: string[] = [resource]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string | null } & Record<string, unknown>) =>
      id ? api.put<T>(`/${resource}/${id}`, body) : api.post<T>(`/${resource}`, body),
    onSuccess: () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

export function useRemove(resource: string, invalidate: string[] = [resource]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/${resource}/${id}`),
    onSuccess: () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

/**
 * Suscribe al personal a los eventos en tiempo real de una sucursal e invalida
 * las consultas de cola cuando algo cambia.
 */
export function useStaffRealtime(branchId: string | null | undefined, onEvent?: (event: string, payload: unknown) => void) {
  const qc = useQueryClient();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const token = session.token;
    if (!branchId || !token) return;
    const socket = connectSocket('user', token);
    const subscribe = () => socket.emit('subscribe:branch', branchId);
    socket.on('ready', subscribe);
    const refresh = (event: string) => (payload: unknown) => {
      void qc.invalidateQueries({ queryKey: ['queue', branchId] });
      void qc.invalidateQueries({ queryKey: ['workstation'] });
      handler.current?.(event, payload);
    };
    for (const event of [RT.ticketCreated, RT.ticketCalled, RT.ticketUpdated, RT.queueChanged]) socket.on(event, refresh(event));
    return () => {
      socket.close();
    };
  }, [branchId, qc]);
}

export { usePublicConfig, type PublicConfig } from './publicConfig';
