import { useState } from 'react';
import { assetUrl } from '../lib/api';
import { cx } from './ui';

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-24 text-3xl',
} as const;

/** Colores de fondo para las iniciales (todos con texto blanco legible). */
const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#4f46e5'];

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

function colorFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

/** Foto de perfil o, si no tiene, sus iniciales sobre un color fijo por persona. */
export function Avatar({ name, url, size = 'md', className }: { name: string; url?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = url && failed !== url;
  return (
    <span
      className={cx('relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white select-none', SIZES[size], className)}
      style={showPhoto ? undefined : { backgroundColor: colorFor(name) }}
      aria-hidden="true"
    >
      {showPhoto ? <img src={assetUrl(url)} alt="" className="size-full object-cover" onError={() => setFailed(url)} /> : initials(name)}
    </span>
  );
}
