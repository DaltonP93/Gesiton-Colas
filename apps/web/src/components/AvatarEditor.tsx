import { Camera, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { MeDTO } from '@gc/shared';
import { api, errorMessage, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar } from './Avatar';
import { Button, Modal, useFeedback } from './ui';

/** Lado del área de recorte en pantalla y de la foto final (px). */
const VIEW = 256;
const OUTPUT = 512;
const MAX_INPUT_MB = 25;

/** Foto de perfil propia: subir (con recorte cuadrado) o quitar. */
export function AvatarEditor({ hint }: { hint?: string }) {
  const { me, refresh } = useAuth();
  const { toast, confirm } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Elija una imagen (JPG, PNG o WebP).', 'error');
    if (file.size > MAX_INPUT_MB * 1024 * 1024) return toast(`La imagen supera los ${MAX_INPUT_MB} MB.`, 'error');
    setSource(URL.createObjectURL(file));
  }

  function close() {
    if (source) URL.revokeObjectURL(source);
    setSource(null);
    if (input.current) input.current.value = '';
  }

  async function save(blob: Blob) {
    setBusy(true);
    try {
      await upload<MeDTO>('/auth/me/avatar', new File([blob], 'foto.jpg', { type: 'image/jpeg' }));
      await refresh();
      toast('Foto actualizada.');
      close();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({ title: '¿Quitar su foto de perfil?', message: 'Se mostrarán sus iniciales.', confirmLabel: 'Quitar', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del<MeDTO>('/auth/me/avatar');
      await refresh();
      toast('Foto quitada.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar name={me.user.name} url={me.user.avatarUrl} size="xl" />
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Camera className="size-4" />} loading={busy && !source} onClick={() => input.current?.click()}>
            {me.user.avatarUrl ? 'Cambiar foto' : 'Subir foto'}
          </Button>
          {me.user.avatarUrl && (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} disabled={busy} onClick={() => void remove()}>
              Quitar
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">{hint ?? 'JPG, PNG o WebP. La recorta en un cuadrado antes de guardarla.'}</p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="sr-only" tabIndex={-1} aria-label="Elegir foto de perfil" onChange={(e) => pick(e.target.files?.[0])} />
      {source && <CropModal source={source} saving={busy} onCancel={close} onSave={(blob) => void save(blob)} />}
    </div>
  );
}

/** Recorte cuadrado: arrastrar para mover y acercar con el control o la rueda del mouse. */
function CropModal({ source, saving, onCancel, onSave }: { source: string; saving: boolean; onCancel: () => void; onSave: (blob: Blob) => void }) {
  const { toast } = useFeedback();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImage(img);
      const base = Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
      setOffset({ x: (VIEW - img.naturalWidth * base) / 2, y: (VIEW - img.naturalHeight * base) / 2 });
    };
    img.onerror = () => {
      toast('No se pudo abrir la imagen. Pruebe con otra (JPG, PNG o WebP).', 'error');
      onCancel();
    };
    img.src = source;
  }, [source, toast, onCancel]);

  const scaleFor = useCallback((z: number) => (image ? Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight) * z : 1), [image]);

  /** Mantiene la imagen cubriendo todo el cuadrado. */
  const clamp = useCallback(
    (x: number, y: number, z: number) => {
      if (!image) return { x, y };
      const s = scaleFor(z);
      return { x: Math.min(0, Math.max(VIEW - image.naturalWidth * s, x)), y: Math.min(0, Math.max(VIEW - image.naturalHeight * s, y)) };
    },
    [image, scaleFor],
  );

  function changeZoom(next: number) {
    const z = Math.min(4, Math.max(1, next));
    // Acerca hacia el centro del recorte.
    const before = scaleFor(zoom);
    const after = scaleFor(z);
    const cx = (VIEW / 2 - offset.x) / before;
    const cy = (VIEW / 2 - offset.y) / before;
    setOffset(clamp(VIEW / 2 - cx * after, VIEW / 2 - cy * after, z));
    setZoom(z);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setOffset(clamp(drag.current.ox + e.clientX - drag.current.x, drag.current.oy + e.clientY - drag.current.y, zoom));
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setOffset(clamp(offset.x + move[0], offset.y + move[1], zoom));
    } else if (e.key === '+' || e.key === '=') changeZoom(zoom + 0.2);
    else if (e.key === '-') changeZoom(zoom - 0.2);
  }

  function crop() {
    if (!image) return;
    const s = scaleFor(zoom);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, OUTPUT, OUTPUT);
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, -offset.x / s, -offset.y / s, VIEW / s, VIEW / s, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob((blob) => (blob ? onSave(blob) : toast('No se pudo preparar la foto.', 'error')), 'image/jpeg', 0.9);
  }

  const s = scaleFor(zoom);
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title="Recortar la foto"
      description="Arrastre para encuadrar y use el control para acercar."
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={crop} loading={saving} disabled={!image}>
            Guardar foto
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          role="application"
          aria-label="Encuadre de la foto: use las flechas para mover y + o - para acercar"
          tabIndex={0}
          className="relative cursor-grab touch-none overflow-hidden rounded-ui bg-subtle outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => changeZoom(zoom - e.deltaY / 500)}
          onKeyDown={onKeyDown}
        >
          {image && (
            <img
              src={source}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
              style={{ width: image.naturalWidth * s, height: image.naturalHeight * s, transform: `translate(${offset.x}px, ${offset.y}px)` }}
            />
          )}
          {/* Máscara: así se verá la foto redonda. */}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(15,23,42,0.55)]" />
        </div>
        <label className="flex w-full max-w-72 items-center gap-3 text-muted">
          <ZoomOut className="size-4 shrink-0" />
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} aria-label="Acercar" className="w-full accent-[var(--gc-primary)]" />
          <ZoomIn className="size-4 shrink-0" />
        </label>
      </div>
    </Modal>
  );
}
