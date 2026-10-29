// Agenda e Story: validação, publicação no horário, túnel desligado, cancelar, reagendar e rotas.
import './helpers.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';

process.env.PUBLIC_BASE_URL = 'https://tunel.exemplo';

const { openDb, db: appDb } = await import('../src/db.ts');
const { config } = await import('../src/config.ts');
const P = await import('../src/publish.ts');
const S = await import('../src/schedule.ts');
const { scheduleRoutes } = await import('../src/routes-schedule.ts');

const media = (name: string) => {
  fs.writeFileSync(path.join(config.mediaDir, name), 'x');
  return name;
};
const exists = (name: string) => fs.existsSync(path.join(config.mediaDir, name));
const NOW = Date.now();

describe('Story', () => {
  it('aceita 1 imagem ou 1 vídeo, sem legenda', () => {
    assert.equal(P.validate({ type: 'story', caption: '', items: [media('s1.jpg')] }), null);
    assert.equal(P.validate({ type: 'story', caption: '', items: [media('s2.mp4')] }), null);
    assert.match(P.validate({ type: 'story', caption: '', items: [media('s3.jpg'), media('s4.jpg')] })!, /exatamente 1/);
  });

  it('publica com media_type STORIES pelo endereço público', async () => {
    const realFetch = globalThis.fetch;
    const calls: { url: string; body: string }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (String(url).includes('status_code')) return json({ status_code: 'FINISHED' });
      if (String(url).includes('media_publish')) return json({ id: 'M1' });
      if (String(url).includes('permalink')) return json({ permalink: 'https://instagram.com/stories/x' });
      return json({ id: 'C1' });
    }) as typeof fetch;
    try {
      const r = await P.publish('IG1', { token: 't', via: 'facebook' }, { type: 'story', caption: 'ignorada', items: [media('story.jpg')] });
      assert.equal(r.id, 'M1');
      const create = new URLSearchParams(calls[0].body);
      assert.equal(create.get('media_type'), 'STORIES');
      assert.equal(create.get('image_url'), 'https://tunel.exemplo/media/story.jpg');
      assert.equal(create.get('caption'), null, 'Story não leva legenda');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('agenda', () => {
  const req = () => ({ type: 'image' as const, caption: 'Olá', items: [media(`a${Math.random().toString(36).slice(2)}.jpg`)] });
  const ok: import('../src/schedule.ts').Publisher = async () => ({ id: 'M9', permalink: 'https://instagram.com/p/9' });
  const up = async () => true;
  const down = async () => false;

  it('valida horário e pedido', () => {
    const db = openDb(':memory:');
    assert.throws(() => S.createSchedule(db, 'loja', req(), NOW - 1000, null, NOW), /1 minuto no futuro/);
    assert.throws(() => S.createSchedule(db, 'loja', req(), NOW + 100 * 86_400_000, null, NOW), /90 dias/);
    assert.throws(() => S.createSchedule(db, 'loja', { type: 'image', caption: '', items: ['nao-existe.jpg'] }, NOW + 3_600_000, null, NOW), /não foi encontrada/);
    assert.throws(() => S.createSchedule(db, 'loja', req(), NaN, null, NOW), /inválidas/);
  });

  it('publica o que venceu, marca o rascunho e deixa o futuro esperando', async () => {
    const db = openDb(':memory:');
    const draft = Number(db.prepare(`INSERT INTO drafts(account_id, title, kind, status, created_at, updated_at) VALUES('loja', 'x', 'image', 'pronto', 0, 0)`).run().lastInsertRowid);
    const a = S.createSchedule(db, 'loja', req(), NOW + 120_000, draft, NOW);
    const b = S.createSchedule(db, 'loja', req(), NOW + 3_600_000, null, NOW);
    assert.equal(await S.runDue(db, ok, up, NOW + 130_000), 1);
    assert.deepEqual([S.getScheduled(db, a.id)!.status, S.getScheduled(db, a.id)!.permalink], ['publicado', 'https://instagram.com/p/9']);
    assert.equal(S.getScheduled(db, b.id)!.status, 'agendado');
    assert.equal((db.prepare('SELECT status FROM drafts WHERE id = ?').get(draft) as any).status, 'publicado');
    assert.deepEqual(S.listSchedule(db, 'loja', NOW).map((p) => p.status), ['agendado', 'publicado'], 'próximos primeiro');
  });

  it('túnel desligado ou erro da Meta: falhou, com aviso, e a mídia fica para tentar de novo', async () => {
    const db = openDb(':memory:');
    const r1 = req();
    const a = S.createSchedule(db, 'loja', r1, NOW + 120_000, null, NOW);
    await S.runDue(db, ok, down, NOW + 130_000);
    const failed = S.getScheduled(db, a.id)!;
    assert.equal(failed.status, 'falhou');
    assert.match(failed.error!, /túnel/);
    assert.ok(exists(r1.items[0]));
    assert.equal(await S.runDue(db, ok, up, NOW + 200_000), 0, 'falha não repete sozinha');
    const again = await S.runScheduled(db, a.id, async () => Promise.reject(new Error('Meta: mídia inválida')), up);
    assert.match(again.error!, /mídia inválida/);
    assert.equal((await S.runScheduled(db, a.id, ok, up)).status, 'publicado');
    await assert.rejects(S.runScheduled(db, a.id, ok, up), /não está aguardando/);
  });

  it('cancelar apaga a mídia; reagendar volta para agendado; reinício no meio vira falhou', () => {
    const db = openDb(':memory:');
    const r1 = req();
    const a = S.createSchedule(db, 'loja', r1, NOW + 120_000, null, NOW);
    assert.equal(S.reschedule(db, a.id, Date.now() + 7_200_000).status, 'agendado');
    assert.equal(S.cancelSchedule(db, a.id).status, 'cancelado');
    assert.equal(exists(r1.items[0]), false);
    const b = S.createSchedule(db, 'loja', req(), NOW + 120_000, null, NOW);
    db.prepare("UPDATE scheduled_posts SET status = 'publicando' WHERE id = ?").run(b.id);
    assert.throws(() => S.cancelSchedule(db, b.id), /publicando/);
    S.recoverStuck(db);
    assert.match(S.getScheduled(db, b.id)!.error!, /reiniciado/);
  });
});

describe('rotas', () => {
  let published = 0;
  const app = express()
    .use(express.json())
    .use('/api', scheduleRoutes(() => ({ publisher: async () => ((published += 1), { id: 'M', permalink: 'https://instagram.com/p/m' }), tunnel: async () => true })));
  const server = app.listen(0);
  let base = '';
  before(async () => {
    await new Promise((ok) => server.once('listening', ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  after(() => server.close());
  const call = (method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));

  it('agenda, lista, publica agora e cancela', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const created = await call('POST', '/accounts/loja/schedule', { request: { type: 'story', caption: '', items: [media('rota.jpg')] }, at });
    assert.equal(created.status, 201);
    assert.equal(created.json.type, 'story');
    assert.equal((await call('POST', '/accounts/loja/schedule', { request: { type: 'image', caption: '', items: [] }, at })).status, 400);
    assert.equal((await call('GET', '/accounts/xyz/schedule')).status, 404);
    const list = await call('GET', '/accounts/loja/schedule');
    assert.equal(list.json[0].id, created.json.id);
    const now = await call('POST', `/schedule/${created.json.id}/publish`);
    assert.deepEqual([now.json.status, published], ['publicado', 1]);
    assert.equal((await call('DELETE', `/schedule/${created.json.id}`)).status, 409, 'publicado não cancela');
    assert.equal(appDb.prepare('SELECT COUNT(*) AS n FROM scheduled_posts').get()!.n, 1);
  });
});
