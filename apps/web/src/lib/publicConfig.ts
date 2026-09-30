import { useQuery } from '@tanstack/react-query';
import type { PublicConfigDTO } from '@gc/shared';
import { api } from './api';

export type PublicConfig = PublicConfigDTO;

/** Opciones públicas de la instalación: página de inicio, registro, demo y marca de la pantalla de ingreso. */
export const usePublicConfig = () =>
  useQuery({ queryKey: ['public-config'], queryFn: () => api.public<PublicConfig>('/public/config'), staleTime: 5 * 60_000 });
