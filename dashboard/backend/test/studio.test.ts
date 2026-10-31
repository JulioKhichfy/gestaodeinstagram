// Estúdio: validação do plano (o que torna seguro executar), leitura das pastas e execução com FFmpeg falso.
import { TMP } from './helpers.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';

const fake = path.join(import.meta.dirname, 'fixtures', 'bin', 'fake-ffmpeg.mjs');
process.env.FFMPEG_BIN = `node "${fake}"`;
process.env.FFPROBE_BIN = `node "${fake}" probe`;

const S = await import('../src/studio.ts');
const { studioRoutes } = await import('../src/routes-studio.ts');

const pasta = path.join(TMP, 'videos');
fs.mkdirSync(pasta, { recursive: true });
const video = path.join(pasta, 'viagem.mp4');
const foto = path.join(pasta, 'foto.jpg');
fs.writeFileSync(video, 'x');
fs.writeFileSync(foto, 'x');
fs.writeFileSync(path.join(pasta, 'anotacoes.txt'), 'ignorar');
const outDir = path.join(pasta, 'editados');
const ctx = { inputs: [video, foto], outDir };
const plan = (passos: import('../src/studio.ts').PlanStep[]) => ({ resumo: 'r', passos, avisos: [], kdenlive: '' });
const ff = (args: string[]) => ({ descricao: 'd', tipo: 'ffmpeg' as const, args });

describe('validação do plano', () => {
  it('aceita um plano bom, com passo encadeado e legenda', () => {
    const p = plan([
      { descricao: 'legenda', tipo: 'arquivo', nome: 'legendas.srt', conteudo: '1\n00:00:00,000 --> 00:00:02,000\nOlá\n' },
      ff(['-i', video, '-vf', "scale=1080:1920,subtitles=legendas.srt:force_style='FontName=Arial'", 'reels.mp4']),
      ff(['-i', 'reels.mp4', '-vf', "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Oi'", 'reels-texto.mp4']),
    ]);
    assert.deepEqual(S.validatePlan(p, ctx), []);
  });

  it('recusa o que poderia ler, sobrescrever ou apagar fora das pastas', () => {
    const casos: [string[], RegExp][] = [
      [['-y', '-i', video, 'a.mp4'], /-y não é permitida/],
      [['-i', 'C:\\Windows\\System32\\config\\SAM', 'a.mp4'], /fora das pastas|não é um dos arquivos/],
      [['-i', video, '-vf', "subtitles='D\\:/outro/x.srt'", 'a.mp4'], /fora das pastas/],
      [['-i', 'https://site.com/v.mp4', 'a.mp4'], /protocolos/],
      [['-f', 'concat', '-i', 'lista.txt', 'a.mp4'], /concat/],
      [['-i', video, 'C:\\Windows\\a.mp4'], /só um nome de arquivo|fora das pastas/],
      [['-i', video, '..\\..\\a.mp4'], /"\.\."/],
      [['-i', video, 'saida.exe'], /só um nome de arquivo de mídia/],
      [['-i', 'nao-gerado.mp4', 'a.mp4'], /não é um dos arquivos escolhidos/],
    ];
    for (const [args, re] of casos) {
      const problems = S.validatePlan(plan([ff(args)]), ctx).join(' | ');
      assert.match(problems, re, args.join(' '));
    }
    assert.match(S.validatePlan(plan([{ descricao: 'x', tipo: 'arquivo', nome: '..\\x.bat', conteudo: '' }]), ctx).join(), /arquivo de texto inválido/);
  });

  it('legenda automática: o .srt do whisper vira entrada válida e o modelo fica liberado', () => {
    const model = path.join(S.modelsDir(), 'ggml-small.bin').replace(/\\/g, '/').replace(':', '\\:');
    const p = plan([
      ff(['-i', video, '-vn', '-af', `whisper=model=${model}:language=pt:destination=legendas.srt:format=srt`, '-f', 'null', '-']),
      ff(['-i', video, '-vf', 'subtitles=legendas.srt', 'legendado.mp4']),
    ]);
    assert.deepEqual(S.validatePlan(p, ctx), []);
  });

  it('encontra caminhos escondidos em filtros', () => {
    assert.deepEqual(S.embeddedPaths("subtitles='C\\:/a b/x.srt':force_style='x'"), ['C:/a b/x.srt']);
    assert.deepEqual(S.embeddedPaths('scale=1080:1920'), []);
  });
});

describe('pastas e capacidades', () => {
  it('lê a pasta: só mídias, com duração e resolução; avisa o que não achou', async () => {
    const r = await S.scan([pasta, 'relativo\\x.mp4', path.join(TMP, 'nao-existe')]);
    assert.deepEqual(r.files.map((f) => [f.name, f.kind]).sort(), [
      ['foto.jpg', 'imagem'],
      ['viagem.mp4', 'video'],
    ]);
    const v = r.files.find((f) => f.kind === 'video')!;
    assert.deepEqual([v.duration, v.width, v.height, v.audio], [12.5, 1920, 1080, true]);
    assert.equal(r.errors.length, 2);
  });

  it('o que o FFmpeg instalado sabe fazer', async () => {
    const c = await S.capabilities(true);
    assert.equal(c.ffmpeg, 'ffmpeg version 9.0-teste');
    assert.deepEqual([c.subtitles, c.drawtext, c.whisper], [true, true, false]);
  });
});

describe('rotas', () => {
  const plano = JSON.stringify({
    resumo: 'Reels vertical com legenda',
    passos: [
      { descricao: 'Cria a legenda', tipo: 'arquivo', nome: 'legendas.srt', conteudo: '1\n00:00:00,000 --> 00:00:02,000\nOlá\n' },
      { descricao: 'Vertical 9:16 com legenda', tipo: 'ffmpeg', args: ['-i', video, '-vf', 'subtitles=legendas.srt', 'reels.mp4'] },
    ],
    avisos: [],
    kdenlive: '',
  });
  const perigoso = JSON.stringify({ resumo: 'x', passos: [{ descricao: 'x', tipo: 'ffmpeg', args: ['-y', '-i', video, 'a.mp4'] }] });
  let prompt = '';
  const app = express()
    .use(express.json())
    .use('/api', studioRoutes(async (_s, u) => ((prompt = u), u.includes('PERIGOSO') ? perigoso : `Aqui está: ${plano}`)));
  const server = app.listen(0);
  let base = '';
  before(async () => {
    if (!server.listening) await new Promise((ok) => server.once('listening', ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  after(() => server.close());
  const call = (p: string, body?: unknown) =>
    fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({
      status: r.status,
      json: r.status === 204 ? null : await r.json(),
    }));

  it('planeja, executa e cria os arquivos em "editados"; nunca sobrescreve', async () => {
    const p = await call('/estudio/planejar', { arquivos: [video], pedido: 'Reels vertical com legenda' });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.deepEqual(p.json.problems, []);
    assert.equal(p.json.outDir, outDir);
    assert.match(prompt, /viagem\.mp4 \| video \| 12\.5s \| 1920x1080/);
    assert.match(prompt, /Legenda automática da fala NÃO está disponível/);

    const job = await call('/estudio/executar', { planId: p.json.id });
    assert.equal(job.status, 202);
    await S.jobFinished(job.json.id);
    const done = (await call(`/estudio/trabalhos/${job.json.id}`)).json;
    assert.deepEqual([done.done, done.error, done.outputs], [true, undefined, ['legendas.srt', 'reels.mp4']]);
    assert.match(fs.readFileSync(path.join(outDir, 'reels.mp4'), 'utf8'), /^gerado por -hide_banner -nostdin -n -i /);
    assert.equal(fs.readFileSync(video, 'utf8'), 'x', 'o original fica intacto');

    const again = await call('/estudio/executar', { planId: (await call('/estudio/planejar', { arquivos: [video], pedido: 'de novo' })).json.id });
    await S.jobFinished(again.json.id);
    assert.match((await call(`/estudio/trabalhos/${again.json.id}`)).json.error, /Já existe "legendas\.srt"/);
  });

  it('plano com problema não executa', async () => {
    const p = await call('/estudio/planejar', { arquivos: [video], pedido: 'PERIGOSO' });
    assert.match(p.json.problems.join(), /-y não é permitida/);
    assert.equal((await call('/estudio/executar', { planId: p.json.id })).status, 400);
    assert.equal((await call('/estudio/planejar', { arquivos: [], pedido: 'x' })).status, 400);
    assert.equal((await call('/estudio/abrir', { path: 'C:\\Windows' })).status, 400);
  });
});
