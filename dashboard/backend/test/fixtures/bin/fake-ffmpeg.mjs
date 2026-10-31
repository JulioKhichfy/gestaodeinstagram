// FFmpeg/FFprobe falso para os testes do Estúdio.
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === 'probe') {
  process.stdout.write(JSON.stringify({ format: { duration: '12.5' }, streams: [{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }] }));
  process.exit(0);
}
if (args.includes('-version')) {
  process.stdout.write('ffmpeg version 9.0-teste\n');
  process.exit(0);
}
if (args.includes('-filters')) {
  const whisper = process.env.FAKE_WHISPER ? ' ... whisper           A->A       Transcribe\n' : '';
  process.stdout.write(` ... subtitles         V->V       Render text subtitles\n ... drawtext          V->V       Draw text\n${whisper}`);
  process.exit(0);
}
if (args.some((a) => a.includes('FALHA'))) {
  process.stderr.write('Invalid argument\n');
  process.exit(1);
}
const out = args[args.length - 1];
if (out !== '-') {
  if (fs.existsSync(out) && args.includes('-n')) {
    process.stderr.write(`File '${out}' already exists. Exiting.\n`);
    process.exit(1);
  }
  fs.writeFileSync(out, `gerado por ${args.join(' ')}`);
}
process.stderr.write('frame=1 time=00:00:01.00 speed=1x\n');
