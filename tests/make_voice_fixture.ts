// UI testi için sahte mikrofon: boğuk bir kadın sesi (ezgi, hece aralıkları). Kullanım: node --import tsx tests/make_voice_fixture.ts <çıktı.wav>
import fs from 'node:fs';
import { wavBlob } from '../src/audio/sweep';
import { synthVoice } from '../src/audio/voice';
const rate = 48000;
const x = synthVoice(rate, 12, 230, { mudDb: 6, presenceDb: -5, noise: 0.0004 });
const buf = Buffer.from(await (wavBlob([x], rate) as Blob).arrayBuffer());
fs.writeFileSync(process.argv[2] || 'tests/fixtures/voice.wav', buf);
console.log('ok', x.length / rate, 's');
