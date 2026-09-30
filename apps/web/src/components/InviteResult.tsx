import { CheckCircle2, MailWarning, MessageCircle } from 'lucide-react';
import { Link } from 'react-router';
import type { InviteResultDTO } from '@gc/shared';
import { CopyField } from './CopyField';
import { Button, Modal } from './ui';

/**
 * Resultado de una invitación: confirma el envío por correo o, si no salió,
 * muestra el enlace para compartirlo a mano (WhatsApp, chat interno...).
 */
export function InviteResultModal({
  result,
  name,
  email,
  mailSettingsPath,
  onClose,
}: {
  result: InviteResultDTO;
  name: string;
  email: string;
  /** Dónde se configura el correo (se ofrece si el envío falló). */
  mailSettingsPath?: string;
  onClose: () => void;
}) {
  const message = `Hola ${name.split(' ')[0]}, te invitamos a ingresar al sistema de turnos. Abrí este enlace para elegir tu contraseña: ${result.inviteUrl}`;
  return (
    <Modal
      open
      onClose={onClose}
      title={result.emailSent ? 'Invitación enviada' : 'Comparta la invitación'}
      description={email}
      footer={<Button onClick={onClose}>Listo</Button>}
    >
      <div className="space-y-4">
        {result.emailSent ? (
          <p className="flex gap-2 rounded-ui border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <span>
              Le enviamos un correo a <strong>{email}</strong> para que elija su contraseña. Si no le llega, puede compartirle este enlace.
            </span>
          </p>
        ) : (
          <div className="flex gap-2 rounded-ui border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
            <MailWarning className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="min-w-0 space-y-1">
              <p>
                <strong>El correo no se envió.</strong> {result.emailError}
              </p>
              <p className="text-muted">Copie el enlace y envíeselo por WhatsApp, chat o correo propio. Vence en 7 días.</p>
              {mailSettingsPath && (
                <Link to={mailSettingsPath} onClick={onClose} className="inline-block font-medium text-primary-text hover:underline">
                  Configurar el correo saliente
                </Link>
              )}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium">Enlace de invitación</p>
          <CopyField value={result.inviteUrl} />
        </div>
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="inline-block">
          <Button variant="secondary" icon={<MessageCircle className="size-4" />}>
            Enviar por WhatsApp
          </Button>
        </a>
      </div>
    </Modal>
  );
}
