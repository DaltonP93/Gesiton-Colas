import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function useQrDataUrl(text: string | null | undefined, size = 320) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!text) {
      setUrl(null);
      return;
    }
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((data) => alive && setUrl(data))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [text, size]);
  return url;
}

export function QrCode({ text, size = 160, className }: { text: string; size?: number; className?: string }) {
  const url = useQrDataUrl(text, size * 2);
  if (!url) return <div style={{ width: size, height: size }} className={className} />;
  return <img src={url} width={size} height={size} alt="Código QR" className={className} style={{ imageRendering: 'pixelated' }} />;
}
