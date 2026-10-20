// UI testi için sahte mikrofon kaydı: 3 tarama, iki varış (0 ve +23 ms), RT ≈ 0,9 s. Kullanım: node --import tsx tests/make_sweep_fixture.ts <çıktı.wav>
import fs from 'node:fs';
import { convolve, sweepSequence, SWEEP_DEFAULT, wavBlob } from '../src/audio/sweep';
const rate = 48000;
const seq = sweepSequence({ ...SWEEP_DEFAULT, fs: rate }, 0.5, 1.5);
const room = new Float64Array(Math.round(rate * 1.2));
room[Math.round(0.012 * rate)] = 0.8;
room[Math.round(0.035 * rate)] = 0.5;
let s = 3;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
for (let i = Math.round(0.02 * rate); i < room.length; i++) room[i] += 0.04 * rnd() * Math.exp((-6.91 * (i / rate)) / 0.9);
const y = convolve(seq.data, room);
const out = new Float32Array(y.length);
for (let i = 0; i < y.length; i++) out[i] = y[i] * 0.5 + 0.001 * rnd();
const blob = wavBlob([out], rate);
const buf = Buffer.from(await blob.arrayBuffer());
fs.writeFileSync(process.argv[2] || 'tests/fixtures/sweep-room.wav', buf);
console.log('ok', out.length / rate, 's');
