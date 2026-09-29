import { useCallback, useEffect, useRef, useState } from 'react';
import { codeForSpeech, isAlertSound, renderTemplate, type CallDTO, type DisplayConfig } from '@gc/shared';
import { assetUrl } from '../../lib/api';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function soundUrl(file: string) {
  return isAlertSound(file) ? `/sounds/${file}.wav` : assetUrl(file);
}

export function playSound(url: string, volume: number): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, volume));
    const done = () => resolve();
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
    setTimeout(done, 6000);
  });
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const finish = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, name: string) {
  return (
    (name && voices.find((v) => v.name === name)) ||
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) ||
    null
  );
}

export async function speak(text: string, voice: DisplayConfig['voice']): Promise<void> {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  const synth = window.speechSynthesis;
  const voices = await loadVoices();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice.lang;
    utterance.rate = voice.rate;
    utterance.pitch = voice.pitch;
    utterance.volume = voice.volume;
    const selected = pickVoice(voices, voice.lang, voice.voiceName);
    if (selected) utterance.voice = selected;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    synth.cancel();
    synth.speak(utterance);
    // Algunos navegadores no disparan `onend`: límite de seguridad.
    setTimeout(done, 2500 + text.length * 120);
  });
}

export function callSpeechText(call: CallDTO, voice: DisplayConfig['voice'], branch = '') {
  return renderTemplate(voice.template, {
    code: codeForSpeech(call.code, voice.codeMode),
    service: call.service,
    counter: call.counter,
    priority: call.priorityWeight > 0 ? call.priority : '',
    customer: call.customerName ?? '',
    branch,
  });
}

/**
 * Cola de anuncios: sonido de alerta + voz, uno detrás de otro.
 * `speaking` permite atenuar la publicidad mientras se anuncia.
 */
export function useAnnouncer(config: DisplayConfig, branch: string) {
  const queue = useRef<CallDTO[]>([]);
  const busy = useRef(false);
  const settings = useRef({ config, branch });
  settings.current = { config, branch };
  const [speaking, setSpeaking] = useState(false);

  const process = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length > 0) {
      const call = queue.current.shift()!;
      const { config: cfg, branch: branchName } = settings.current;
      setSpeaking(true);
      try {
        if (cfg.sound.enabled) await playSound(soundUrl(cfg.sound.file), cfg.sound.volume);
        if (cfg.voice.enabled) {
          const text = callSpeechText(call, cfg.voice, branchName);
          for (let i = 0; i < cfg.voice.repeat; i++) {
            await speak(text, cfg.voice);
            if (i < cfg.voice.repeat - 1) await wait(500);
          }
        }
      } finally {
        await wait(350);
        setSpeaking(false);
      }
    }
    busy.current = false;
  }, []);

  const announce = useCallback(
    (call: CallDTO) => {
      // Evita anunciar dos veces el mismo llamado si llega repetido.
      if (queue.current.some((c) => c.ticketId === call.ticketId && c.callCount === call.callCount)) return;
      queue.current.push(call);
      void process();
    },
    [process],
  );

  useEffect(
    () => () => {
      queue.current = [];
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );

  return { announce, speaking };
}
