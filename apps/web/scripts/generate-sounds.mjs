/**
 * Genera los sonidos de llamado incluidos (WAV 22 kHz mono) por síntesis aditiva.
 * Son originales, por lo que pueden distribuirse sin restricciones de licencia.
 *
 *   node apps/web/scripts/generate-sounds.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/sounds');

const NOTE = (name) => {
  const map = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  const semis = map[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
};

/** Mezcla de notas: cada una con parciales (relación de frecuencia, amplitud) y decaimiento. */
function render(duration, notes) {
  const samples = new Float32Array(Math.ceil(duration * RATE));
  for (const n of notes) {
    const start = Math.floor(n.at * RATE);
    const length = Math.min(samples.length - start, Math.ceil((n.length ?? 1.5) * RATE));
    for (let i = 0; i < length; i++) {
      const t = i / RATE;
      const attack = Math.min(1, t / (n.attack ?? 0.005));
      const env = attack * Math.exp(-t * (n.decay ?? 3));
      let v = 0;
      for (const [ratio, amp, partialDecay = 0] of n.partials ?? [[1, 1]]) {
        const phase = 2 * Math.PI * n.freq * ratio * t;
        const wave = n.wave === 'square' ? Math.sign(Math.sin(phase)) * 0.5 : Math.sin(phase);
        v += amp * wave * Math.exp(-t * partialDecay);
      }
      samples[start + i] += v * env * (n.gain ?? 0.5);
    }
  }
  // Normaliza y suaviza el final para evitar clics.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0 ? 0.85 / peak : 1;
  const fade = Math.floor(0.05 * RATE);
  for (let i = 0; i < samples.length; i++) {
    const tail = Math.min(1, (samples.length - i) / fade);
    samples[i] *= scale * tail;
  }
  return samples;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const bell = [[1, 1], [2.76, 0.45, 2], [5.4, 0.25, 4], [8.93, 0.12, 6]];
const marimba = [[1, 1], [4, 0.35, 12], [9.9, 0.1, 20]];
const soft = [[1, 1], [2, 0.2, 3], [3, 0.08, 5]];
const pluck = [[1, 1], [2, 0.5, 4], [3, 0.25, 6], [4, 0.12, 8]];

const sounds = {
  'chime-soft': render(2.4, [
    { freq: NOTE('E5'), at: 0, decay: 2.2, partials: soft, length: 2 },
    { freq: NOTE('C5'), at: 0.45, decay: 1.8, partials: soft, length: 1.9 },
  ]),
  'bell-ding': render(2.6, [{ freq: NOTE('A5'), at: 0, decay: 1.6, partials: bell, length: 2.6 }]),
  'triple-rise': render(1.8, ['C5', 'E5', 'G5'].map((n, i) => ({ freq: NOTE(n), at: i * 0.22, decay: 4, partials: soft, length: 1.2 }))),
  'triple-fall': render(1.8, ['G5', 'E5', 'C5'].map((n, i) => ({ freq: NOTE(n), at: i * 0.22, decay: 4, partials: soft, length: 1.2 }))),
  announcement: render(3, ['G4', 'C5', 'E5', 'G5'].map((n, i) => ({ freq: NOTE(n), at: i * 0.38, decay: 1.8, partials: bell, length: 1.8, gain: 0.45 }))),
  marimba: render(1.6, ['C5', 'E5', 'G5', 'C6'].map((n, i) => ({ freq: NOTE(n), at: i * 0.12, decay: 6, partials: marimba, length: 1 }))),
  xylophone: render(1.4, ['G5', 'B5', 'D6'].map((n, i) => ({ freq: NOTE(n), at: i * 0.1, decay: 9, partials: [[1, 1], [3.9, 0.3, 25]], length: 0.8 }))),
  harp: render(2.2, ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6'].map((n, i) => ({ freq: NOTE(n), at: i * 0.07, decay: 2.5, partials: pluck, length: 1.6, gain: 0.35 }))),
  'double-beep': render(0.8, [
    { freq: 1046, at: 0, decay: 0.5, length: 0.14, attack: 0.004, gain: 0.5 },
    { freq: 1046, at: 0.22, decay: 0.5, length: 0.14, attack: 0.004, gain: 0.5 },
  ]),
  'soft-pop': render(0.9, [
    { freq: NOTE('C6'), at: 0, decay: 9, partials: soft, length: 0.5 },
    { freq: NOTE('G6'), at: 0.08, decay: 9, partials: soft, length: 0.5, gain: 0.35 },
  ]),
  gong: render(4, [{ freq: 110, at: 0, decay: 0.9, partials: [[1, 1], [1.48, 0.6, 0.6], [2.03, 0.4, 1], [2.73, 0.3, 1.5], [3.4, 0.2, 2]], length: 4, attack: 0.02 }]),
  retro: render(1.2, ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'].map((n, i) => ({ freq: NOTE(n), at: i * 0.08, decay: 3, wave: 'square', length: 0.09, gain: 0.3 }))),
};

for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(path.join(outDir, `${name}.wav`), wav(samples));
  console.log(`✔ ${name}.wav (${(samples.length / RATE).toFixed(1)} s)`);
}
