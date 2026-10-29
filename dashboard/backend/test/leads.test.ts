// Captar clientes: comentários -> classificação (regra fixa + Jev) -> lista com status -> resposta com um clique.
import './helpers.ts';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';

const { openDb, db: appDb } = await import('../src/db.ts');
const { findAccount } = await import('../src/config.ts');
const L = await import('../src/leads.ts');
const { leadsRoutes } = await import('../src/routes-leads.ts');
const { encrypt, write } = await import('../src/store.ts');
type Answer = import('../src/jev.ts').Answer;
type IgComment = import('../src/instagram.ts').IgComment;

const loja = findAccount('loja')!; // username loja.exemplo
const NOW = Date.parse('2026-10-29T12:00:00Z');
const auth = { token: 't', via: 'facebook' as const };

function seedMedia(db: any) {
  db.prepare(`INSERT INTO media(id, account_id, media_type, caption, permalink, timestamp, comments_count, synced_at)
              VALUES('m1', 'loja', 'IMAGE', 'Kit aconchego de inverno', 'https://instagram.com/p/m1', ?, 5, 0)`).run('2026-10-20T10:00:00Z');
  db.prepare(`INSERT INTO media(id, account_id, media_type, caption, timestamp, comments_count, synced_at)
              VALUES('velho', 'loja', 'IMAGE', 'Post antigo', ?, 3, 0)`).run('2026-01-01T10:00:00Z');
}

const comment = (id: string, username: string, text: string, ts = '2026-10-21T10:00:00Z', replies: IgComment[] = []): IgComment => ({
  id,
  username,
  text,
  timestamp: ts,
  like_count: 1,
  replies: { data: replies },
});

const COMMENTS: IgComment[] = [
  comment('c1', 'ana', 'Quanto custa o kit? Preciso pra sexta', '2026-10-21T10:00:00Z'),
  comment('c2', 'bia', 'Que lindo! 😍', '2026-10-22T10:00:00Z'),
  comment('c3', 'spammer', 'Ganhe seguidores grátis no link', '2026-10-23T10:00:00Z'),
  comment('c4', 'loja.exemplo', 'Obrigada a todos!', '2026-10-23T11:00:00Z'), // a própria conta: ignorado
  comment('c5', 'caio', 'Vocês fazem para consultório?', '2026-10-24T10:00:00Z', [
    { id: 'r1', username: 'loja.exemplo', text: 'Fazemos sim! Te chamei no direct.', timestamp: '2026-10-24T12:00:00Z' },
  ]),
];

const fakeApi = () => {
  const replies: { id: string; message: string }[] = [];
  const api: import('../src/leads.ts').CommentsApi = {
    async getComments(_auth, mediaId) {
      return mediaId === 'm1' ? COMMENTS : [];
    },
    async reply(_auth, id, message) {
      replies.push({ id, message });
      return { id: `reply-${id}` };
    },
  };
  return { api, replies };
};

/** Dublê do Jev por texto do comentário. */
const fakeJev: import('../src/jev.ts').JevClient = {
  async systemOne(state: any) {
    const t: string = state.comentario;
    const choice = (c: string, confidence = 0.9): Answer => ({ type: 'choice', choice: c, confidence, probabilities: {} });
    const noul = (n: number): Answer => ({ type: 'noul', noul: n });
    const by: Record<string, Record<string, Answer>> = {
      ana: { intencao: choice('compra'), interesse: noul(0.95), urgente: noul(0.8) },
      bia: { intencao: choice('elogio'), interesse: noul(0.1), urgente: noul(0.05) },
      spam: { intencao: choice('spam'), interesse: noul(0.6), urgente: noul(0.1) },
      caio: { intencao: choice('duvida', 0.6), interesse: noul(0.7), urgente: noul(0.1) },
    };
    const key = /Quanto/.test(t) ? 'ana' : /lindo/.test(t) ? 'bia' : /Ganhe/.test(t) ? 'spam' : 'caio';
    return { model: 'jev-test', answers: by[key], usage: { input_tokens: 300 } };
  },
};

describe('regra fixa', () => {
  it('reconhece pedidos de compra, com acento e radicais', () => {
    for (const t of ['Quanto custa?', 'faz orçamento?', 'quero encomendar', 'Parcela em 3x?', 'me chama no direct', 'tem disponível?']) {
      assert.ok(L.keywordInterest(t), t);
    }
    for (const t of ['Que lindo', 'comprometida com isso', 'amei a cor']) assert.ok(!L.keywordInterest(t), t);
  });
});

describe('comentários e classificação', () => {
  it('lê só os posts recentes, ignora a própria conta e registra a resposta já dada', async () => {
    const db = openDb(':memory:');
    seedMedia(db);
    const r = await L.syncComments(db, fakeApi().api, 'loja', auth, 'Loja.Exemplo', NOW);
    assert.deepEqual(r, { posts: 1, fetched: 4, added: 4 });
    assert.equal((await L.syncComments(db, fakeApi().api, 'loja', auth, 'loja.exemplo', NOW)).added, 0, 'idempotente');
    const c5 = db.prepare('SELECT replied_at, reply_text FROM comments WHERE id = ?').get('c5') as any;
    assert.deepEqual([c5.replied_at, c5.reply_text], ['2026-10-24T12:00:00Z', 'Fazemos sim! Te chamei no direct.']);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comments WHERE id = 'c4'").get()!.n, 0);
  });

  it('Jev separa interessados de elogio e spam; urgentes e sem resposta primeiro', async () => {
    const db = openDb(':memory:');
    seedMedia(db);
    await L.syncComments(db, fakeApi().api, 'loja', auth, 'loja.exemplo', NOW);
    assert.deepEqual(await L.classifyComments(db, fakeJev, loja), { classified: 4, failed: 0 });

    const novos = L.listLeads(db, 'loja', 'novo');
    assert.deepEqual(novos.map((l) => l.username), ['ana', 'caio'], 'elogio e spam ficam de fora; respondido vai para o fim');
    assert.equal(novos[0].intentLabel, 'Quer comprar ou contratar');
    assert.equal(novos[0].media.permalink, 'https://instagram.com/p/m1');
    assert.equal(L.listLeads(db, 'loja', 'todos').length, 4);
    assert.equal(appDb === db, false);
  });

  it('sem Jev, a regra fixa ainda encontra quem pergunta o preço', async () => {
    const db = openDb(':memory:');
    seedMedia(db);
    await L.syncComments(db, fakeApi().api, 'loja', auth, 'loja.exemplo', NOW);
    await L.classifyComments(db, null, loja);
    assert.deepEqual(L.listLeads(db, 'loja', 'novo').map((l) => l.username), ['ana']);
  });

  it('status, valor fechado e números do período', async () => {
    const db = openDb(':memory:');
    seedMedia(db);
    await L.syncComments(db, fakeApi().api, 'loja', auth, 'loja.exemplo', NOW);
    await L.classifyComments(db, fakeJev, loja);
    L.markReplied(db, 'c1', 'Oi Ana! Te chamei no direct.');
    assert.equal(L.getLead(db, 'c1')!.status, 'em_conversa');
    L.updateLead(db, 'c1', { status: 'cliente', dealValue: '189.9', notes: 'Kit inverno' });
    assert.throws(() => L.updateLead(db, 'c1', { status: 'vip' }), /Status inválido/);
    assert.throws(() => L.updateLead(db, 'c1', { dealValue: -5 }), /Valor inválido/);
    L.updateLead(db, 'c3', { status: 'descartado' });

    const s = L.leadStats(db, 'loja', 30, NOW);
    assert.deepEqual([s.comments, s.leads, s.novo, s.clientes, s.descartados, s.valor, s.pending], [4, 3, 1, 1, 1, 189.9, 0]);
    assert.equal(s.conversao, 33.3);
    assert.equal((s.topPosts[0] as any).clients, 1);
  });
});

describe('rotas', () => {
  const { api, replies } = fakeApi();
  const app = express().use(express.json()).use('/api', leadsRoutes(() => ({ api, jev: fakeJev })));
  const server = app.listen(0);
  let base = '';
  before(async () => {
    await new Promise((ok) => server.once('listening', ok));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
    seedMedia(appDb);
  });
  after(() => server.close());
  const call = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json' } }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const connect = (permissions: string[]) =>
    write((d) => {
      d.connections.loja = {
        igUserId: '1',
        username: 'loja.exemplo',
        tokenEnc: encrypt('tok'),
        tokenIssuedAt: Date.now(),
        tokenExpiresAt: Date.now() + 86_400_000,
        permissions,
        via: 'facebook',
      };
    });

  it('sem a permissão de comentários pede para reconectar', async () => {
    connect(['instagram_basic']);
    const st = await call('/accounts/loja/leads/status');
    assert.deepEqual([st.json.connected, st.json.hasPermission], [true, false]);
    const r = await call('/accounts/loja/leads/refresh', { method: 'POST' });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /reconecte/);
  });

  it('busca, classifica, responde e muda o status', async () => {
    connect(['instagram_basic', 'instagram_manage_comments']);
    const r = await call('/accounts/loja/leads/refresh', { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(r.json.classified, 4);
    const novos = await call('/accounts/loja/leads?status=novo');
    assert.equal(novos.json[0].username, 'ana');

    assert.equal((await call('/leads/c1/reply', { method: 'POST', body: JSON.stringify({ message: ' ' }) })).status, 400);
    const replied = await call('/leads/c1/reply', { method: 'POST', body: JSON.stringify({ message: 'Oi Ana! Te chamei no direct.' }) });
    assert.equal(replied.json.status, 'em_conversa');
    assert.deepEqual(replies, [{ id: 'c1', message: 'Oi Ana! Te chamei no direct.' }]);

    const patched = await call('/leads/c1', { method: 'PATCH', body: JSON.stringify({ status: 'cliente', dealValue: 250 }) });
    assert.deepEqual([patched.json.status, patched.json.dealValue], ['cliente', 250]);
    assert.equal((await call('/accounts/loja/leads?status=xyz')).status, 400);
    assert.equal((await call('/leads/nao-existe', { method: 'PATCH', body: '{}' })).status, 404);
    const stats = await call('/accounts/loja/leads/stats?days=3650');
    assert.equal(stats.json.clientes, 1);
  });
});
