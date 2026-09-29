import { Loader2, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { PairingDTO, PairingStatusDTO } from '@gc/shared';
import { QrCode } from '../../components/QrCode';
import { api } from '../../lib/api';

const DEVICE_KEY = 'gc.device';

interface StoredDevice {
  type: 'display' | 'kiosk';
  token: string;
}

function readDevice(): StoredDevice | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as StoredDevice) : null;
  } catch {
    return null;
  }
}

function saveDevice(device: StoredDevice | null) {
  try {
    if (device) window.localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    else window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* sin almacenamiento local */
  }
}

const targetPath = (d: StoredDevice) => (d.type === 'display' ? `/pantalla/${d.token}` : `/kiosco/${d.token}`);

/**
 * Página que se abre en la TV, tablet o tótem (/vincular). Muestra un código de 6 dígitos;
 * cuando alguien lo ingresa en el portal, el equipo pasa solo a su pantalla o kiosco y lo
 * recuerda para la próxima vez.
 */
export default function DeviceLinkPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [pairing, setPairing] = useState<PairingDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const requesting = useRef(false);

  // Un equipo ya vinculado va directo a su pantalla (salvo que se pida vincular de nuevo).
  useEffect(() => {
    if (params.get('nuevo') === '1') {
      saveDevice(null);
      return;
    }
    const stored = readDevice();
    if (stored) navigate(targetPath(stored), { replace: true });
  }, [params, navigate]);

  const request = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    setError(null);
    try {
      setPairing(await api.public<PairingDTO>('/public/pairings', {}));
    } catch {
      setError('No se pudo obtener un código. Reintentando…');
      setTimeout(() => void request(), 5000);
    } finally {
      requesting.current = false;
    }
  }, []);

  useEffect(() => {
    if (!readDevice() || params.get('nuevo') === '1') void request();
  }, [request, params]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Consulta periódica hasta que el portal vincule el equipo.
  useEffect(() => {
    if (!pairing) return;
    let stopped = false;
    const poll = async () => {
      try {
        const status = await api.public<PairingStatusDTO>(`/public/pairings/${pairing.id}?secret=${encodeURIComponent(pairing.secret)}`);
        if (stopped) return;
        if (status.status === 'claimed' && status.target) {
          const device = { type: status.target.type, token: status.target.token };
          saveDevice(device);
          navigate(targetPath(device), { replace: true });
        } else if (status.status === 'expired') {
          void request();
        }
      } catch {
        /* se reintenta en la próxima consulta */
      }
    };
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pairing, navigate, request]);

  const remaining = pairing ? Math.max(0, Math.floor((new Date(pairing.expiresAt).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (pairing && remaining === 0) void request();
  }, [pairing, remaining, request]);

  const host = window.location.host;
  const portalUrl = pairing ? `${window.location.origin}/app/vincular?code=${pairing.code}` : '';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-slate-950 p-8 text-center text-white">
      <div className="flex items-center gap-3 text-slate-300">
        <MonitorSmartphone className="size-8" />
        <p className="text-2xl font-semibold">Vincular este dispositivo</p>
      </div>
      {!pairing ? (
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="size-6 animate-spin" /> {error ?? 'Obteniendo código…'}
        </div>
      ) : (
        <>
          <p className="font-mono text-[clamp(4rem,14vw,11rem)] leading-none font-black tracking-[0.12em]" aria-label={`Código ${pairing.code.split('').join(' ')}`}>
            {pairing.code.slice(0, 3)}
            <span className="text-slate-600"> </span>
            {pairing.code.slice(3)}
          </p>
          <div className="grid max-w-4xl items-center gap-10 md:grid-cols-[auto_1fr]">
            <QrCode text={portalUrl} size={200} className="mx-auto rounded-2xl bg-white p-3" />
            <ol className="space-y-3 text-left text-xl text-slate-300">
              <li>
                1. En su computadora o celular ingrese a <strong className="text-white">{host}/app/vincular</strong> o escanee el código QR.
              </li>
              <li>2. Escriba el código y elija la pantalla o el kiosco que será este equipo.</li>
              <li>3. Listo: este dispositivo se abrirá solo y lo recordará al encenderse.</li>
            </ol>
          </div>
          <p className="flex items-center gap-2 text-slate-500">
            <RefreshCw className="size-4" /> El código se renueva en {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
          </p>
        </>
      )}
    </div>
  );
}
