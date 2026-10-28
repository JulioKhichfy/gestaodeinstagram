// Endpoints principais via HTTP real (servidor em porta aleatória, dados temporários).
import './helpers.ts';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

const { app } = await import('../src/server.ts');
const { db } = await import('../src/db.ts');

let base = '';
let token = '';
const server = app.listen(0);

before(async () => {
  await new Promise((ok) => server.once('listening', ok));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

async function api(method: string, path: string, body?: unknown, auth = true) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

describe('API', () => {
  it('sessão: cria senha, recusa errada, protege rotas', async () => {
    assert.equal((await api('POST', '/session/setup', { password: 'curta' })).status, 400);
    const setup = await api('POST', '/session/setup', { password: 'senha-de-teste', remember: true });
    assert.equal(setup.status, 200);
    token = setup.json.token;
    assert.equal((await api('POST', '/session/login', { password: 'errada' }, false)).status, 401);
    assert.equal((await api('GET', '/accounts', undefined, false)).status, 401);
    assert.equal((await api('GET', '/compare', undefined, false)).status, 401);
  });

  it('lista as 4 contas sem expor tokens', async () => {
    const r = await api('GET', '/accounts');
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 4);
    assert.ok(!JSON.stringify(r.json).match(/token(Enc)?"\s*:\s*"/i));
  });

  it('relatório, posts e CSV de uma conta', async () => {
    db.prepare(
      `INSERT INTO media(id, account_id, media_type, product_type, caption, permalink, timestamp, synced_at)
       VALUES('m1', 'autora', 'IMAGE', 'FEED', 'Olá; mundo', 'https://x/p/m1', ?, 0)`,
    ).run(new Date().toISOString());
    db.prepare(`INSERT INTO media_insights(media_id, reach, likes, shares, synced_at) VALUES('m1', 100, 5, 1, 0)`).run();

    const report = await api('GET', '/accounts/autora/report?days=30');
    assert.equal(report.status, 200);
    assert.equal(report.json.kpis.posts, 1);

    const posts = await api('GET', '/accounts/autora/posts?format=post');
    assert.equal(posts.json[0].score, 10);

    const csv = await api('GET', '/accounts/autora/posts.csv');
    assert.match(csv.headers.get('content-type')!, /text\/csv/);
    assert.match(csv.json, /"Olá; mundo"/);

    assert.equal((await api('GET', '/accounts/inexistente/report')).status, 404);
  });

  it('experimentos: registra gancho e aparece no ranking', async () => {
    assert.equal((await api('PUT', '/media/m1/tags', { hook: 'Pergunta', style: 'Educativo' })).status, 204);
    const r = await api('GET', '/accounts/autora/experiments');
    assert.equal(r.json.combos[0].hook, 'Pergunta');
    assert.ok(r.json.options.hooks.includes('Pergunta'));
  });

  it('ciclos: cria com checklist padrão e marca item', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const c = await api('POST', '/accounts/autora/cycles', { startDate: today, objective: 'Mais salvamentos' });
    assert.equal(c.status, 201);
    assert.ok(c.json.checklist.length > 5);
    const checklist = c.json.checklist.map((i: any, n: number) => ({ ...i, done: n === 0 }));
    const u = await api('PUT', `/cycles/${c.json.id}`, { checklist });
    assert.equal(u.json.checklist[0].done, true);
    assert.equal((await api('POST', '/accounts/autora/cycles', {})).status, 400);
  });

  it('rascunhos: cria, edita status e apaga', async () => {
    const d = await api('POST', '/accounts/loja/drafts', { title: 'Kit Natal', kind: 'carousel' });
    assert.equal(d.status, 201);
    const u = await api('PUT', `/drafts/${d.json.id}`, { status: 'pronto', body: 'Legenda' });
    assert.equal(u.json.status, 'pronto');
    assert.equal(u.json.title, 'Kit Natal');
    assert.equal((await api('DELETE', `/drafts/${d.json.id}`)).status, 204);
  });

  it('tráfego pago: recomendação por conta e plano', async () => {
    const b = await api('GET', '/accounts/projetos/boost');
    assert.match(b.json.recommendation.audience, /Quem contrata/); // padrão do tipo "servicos"
    assert.equal((await api('POST', '/accounts/projetos/ad-plans', { dailyBudget: 0, days: 5 })).status, 400);
    const p = await api('POST', '/accounts/projetos/ad-plans', { objective: 'Mensagens', dailyBudget: 30, days: 7 });
    assert.equal(p.status, 201);
    const u = await api('PUT', `/ad-plans/${p.json.id}`, { status: 'concluido', spent: 210, resultActions: 12 });
    assert.equal(u.json.result_actions, 12);
  });

  it('configurações: salva pesos com limites', async () => {
    const r = await api('PUT', '/settings', { weights: { shares: 99, likes: -1 } });
    assert.equal(r.json.weights.shares, 20);
    assert.equal(r.json.weights.likes, 0);
  });

  it('descoberta: exige sessão, funciona sem Facebook e não expõe token', async () => {
    assert.equal((await api('GET', '/facebook/status', undefined, false)).status, 401);
    assert.equal((await api('GET', '/accounts/loja/discovery/suggestions', undefined, false)).status, 401);

    const st = await api('GET', '/facebook/status');
    assert.equal(st.json.connected, false);
    assert.match(st.json.redirectUri, /\/api\/facebook\/callback$/);
    assert.equal(st.json.linked.length, 4);
    assert.equal((await api('POST', '/facebook/connect', {})).status, 400, 'sem FB_APP_ID no .env');

    assert.equal((await api('GET', '/accounts/loja/discovery/search?q=decoração')).status, 409);
    const w = await api('POST', '/accounts/loja/discovery/watchlist', { username: '@Loja.Referencia' });
    assert.equal(w.status, 201);
    assert.equal(w.json.username, 'loja.referencia');
    assert.equal((await api('POST', '/accounts/loja/discovery/watchlist', { username: 'a b' })).status, 400);

    const saved = await api('GET', '/accounts/loja/discovery/profiles');
    assert.deepEqual(saved.json.map((p: any) => p.username), ['loja.referencia']);
    const u = await api('PATCH', `/discovery/${w.json.id}`, { status: 'em_contato' });
    assert.equal(u.json.status, 'em_contato');
    assert.equal((await api('PATCH', `/discovery/${w.json.id}`, { status: 'seguir' })).status, 400);

    const usage = await api('GET', '/accounts/loja/discovery/usage');
    assert.equal(usage.json.usage, null);
    assert.equal((await api('GET', '/accounts/xyz/discovery/suggestions')).status, 404);
    assert.doesNotMatch(JSON.stringify([st.json, w.json, saved.json]), /token(Enc)?"\s*:\s*"/i);
  });

  it('jev: exige sessão e fica desligado sem chave', async () => {
    assert.equal((await api('GET', '/jev/status', undefined, false)).status, 401);
    const st = await api('GET', '/jev/status');
    assert.equal(st.json.configured, false);
    const r = await api('POST', '/accounts/loja/jev/review', { caption: 'Olá' });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /TYPESAFE_API_KEY/);
    assert.equal((await api('POST', '/accounts/xyz/jev/review', { caption: 'Olá' })).status, 404);
  });

  it('salvar o registro à mão confirma a sugestão do Jev', async () => {
    db.prepare(`UPDATE media_tags SET tagged_by = 'jev', tag_confidence = 0.7 WHERE media_id = 'm1'`).run();
    assert.equal((await api('GET', '/accounts/autora/posts')).json[0].taggedBy, 'jev');
    await api('PUT', '/media/m1/tags', { hook: 'Pergunta', style: 'Educativo' });
    assert.equal((await api('GET', '/accounts/autora/posts')).json[0].taggedBy, null);
  });

  it('conexão por token: valida antes de chamar o Instagram', async () => {
    assert.equal((await api('POST', '/accounts/loja/token', { token: 'x' }, false)).status, 401);
    assert.equal((await api('POST', '/accounts/loja/token', { token: 'curto' })).status, 400);
    assert.equal((await api('POST', '/accounts/xyz/token', { token: 'IG'.repeat(30) })).status, 404);
  });

  it('alertas de todas as contas', async () => {
    const r = await api('GET', '/alerts');
    assert.equal(r.json.length, 4);
    assert.ok(r.json.every((a: any) => a.alerts.some((x: any) => x.code === 'disconnected')));
  });
});
