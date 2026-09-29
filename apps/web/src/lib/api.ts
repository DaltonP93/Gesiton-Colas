/** Cliente HTTP de la API REST (`/api/v1`). */

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const TOKEN_KEY = 'gc.token';
const TENANT_KEY = 'gc.tenant';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const session = {
  get token() {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  },
  set token(value: string | null) {
    const s = storage();
    if (!s) return;
    if (value) s.setItem(TOKEN_KEY, value);
    else s.removeItem(TOKEN_KEY);
  },
  /** Organización en la que opera el superadministrador (soporte). */
  get tenantOverride() {
    return storage()?.getItem(TENANT_KEY) ?? null;
  },
  set tenantOverride(value: string | null) {
    const s = storage();
    if (!s) return;
    if (value) s.setItem(TENANT_KEY, value);
    else s.removeItem(TENANT_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** No enviar el token (endpoints públicos). */
  anonymous?: boolean;
}

function headers(anonymous?: boolean, json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  if (!anonymous && session.token) h.authorization = `Bearer ${session.token}`;
  if (!anonymous && session.tenantOverride) h['x-tenant-id'] = session.tenantOverride;
  return h;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: string; message?: string; details?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return new ApiError(res.status, body.error ?? 'error', body.message ?? `Error ${res.status}`, body.details);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
    headers: headers(options.anonymous, hasBody),
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  if (res.status === 401 && !options.anonymous && session.token) {
    window.dispatchEvent(new CustomEvent('gc:unauthorized'));
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  public: <T>(path: string, body?: unknown) =>
    request<T>(path, { anonymous: true, body, method: body === undefined ? 'GET' : 'POST' }),
};

/** Sube un archivo con progreso (multipart). */
export function upload<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Los campos deben ir antes del archivo para que el servidor los lea.
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/v1${path}`);
    for (const [k, v] of Object.entries(headers(false, false))) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { error?: string; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* vacío */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(xhr.status, body.error ?? 'error', body.message ?? `Error ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Error de red al subir el archivo'));
    xhr.send(form);
  });
}

/** Descarga un archivo autenticado (p. ej. CSV). */
export async function download(path: string, filename: string) {
  const res = await fetch(`${API_BASE}/api/v1${path}`, { headers: headers(false, false) });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** URL absoluta para archivos servidos por la API (uploads relativos). */
export function assetUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return `${API_BASE}${url}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'validation_error' && Array.isArray(error.details) && error.details.length > 0) {
      const first = error.details[0] as { message?: string; instancePath?: string; path?: unknown[] };
      const where = first.instancePath || (first.path ? first.path.join('.') : '');
      return `${error.message}${where ? ` (${where})` : ''}: ${first.message ?? ''}`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado';
}
