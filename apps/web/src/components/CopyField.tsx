import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { copyToClipboard } from '../lib/format';
import { Button, Input } from './ui';

export function CopyField({ value, open, mono = true }: { value: string; open?: boolean; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className={mono ? 'font-mono text-xs' : undefined} onFocus={(e) => e.currentTarget.select()} />
      <Button
        variant="secondary"
        icon={copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        onClick={async () => {
          if (await copyToClipboard(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
      {open && (
        <a href={value} target="_blank" rel="noreferrer">
          <Button variant="secondary" icon={<ExternalLink className="size-4" />}>
            Abrir
          </Button>
        </a>
      )}
    </div>
  );
}
