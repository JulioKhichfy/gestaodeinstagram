// Jev: contrato HTTP, revisão de legenda (nota composta, dicas, confiança) e classificação automática.
import './helpers.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';

// Servidor falso no lugar de api.typesafe.ai: confere o que o cliente envia.
let lastRequest: { auth?: string; body: any } | null = null;
let reply: { status: number; body: unknown } = { status: 200, body: {} };
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    lastRequest = { auth: req.headers.authorization, body: JSON.parse(raw || '{}') };
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body));
  });
});
await new Promise<void>((ok) => mock.listen(0, ok));
after(() => mock.close());
process.env.TYPESAFE_API_KEY = 'chave-de-teste';
process.env.JEV_BASE_URL = `http://localhost:${(mock.address() as AddressInfo).port}`;

const { openDb } = await import('../src/db.ts');
const { findAccount } = await import('../src/config.ts');
const { jevClient, JevError } = await import('../src/jev.ts');
const rv = await import('../src/review.ts');
type JevClient = import('../src/jev.ts').JevClient;
type Answer = import('../src/jev.ts').Answer;

const score = (s: number, confidence = 0.9): Answer => ({ type: 'score', score: s, confidence, legend: {}, probabilities: {} });
const choice = (c: string, confidence = 0.9): Answer => ({ type: 'choice', choice: c, confidence, probabilities: {} });
const noul = (n: number): Answer => ({ type: 'noul', noul: n });

/** Dublê do Jev: devolve respostas fixas e guarda o que recebeu. */
function fakeJev(answers: Record<string, Answer> | ((state: any) => Record<string, Answer>)) {
  const calls: { state: any; questions: Record<string, any> }[] = [];
  const client: JevClient = {
    async systemOne(state, questions) {
      calls.push({ state, questions });
      const a = typeof answers === 'function' ? answers(state) : answers;
      return { model: 'jev-test', answers: Object.fromEntries(Object.keys(questions).map((k) => [k, a[k]])), usage: { input_tokens: 120, output_tokens: 8 } };
    },
  };
  return { client, calls };
}

const goodAnswers = {
  gancho: score(3),
  clareza: score(2),
  cta: noul(0.9),
  risco: noul(0.05),
  objetivo: choice('salvamento'),
  gancho_tipo: choice('Número/lista'),
  estilo: choice('Educativo', 0.4),
  tom: score(2),
};

describe('cliente HTTP', () => {
  it('envia modelo, estado e perguntas com Bearer', async () => {
    reply = { status: 200, body: { model: 'jev-latest', answers: { x: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 10 } } };
    const r = await jevClient.systemOne({ legenda: 'oi' }, { x: { type: 'noul', instructions: 'É saudação?' } });
    assert.equal(r.answers.x.type, 'noul');
    assert.equal(lastRequest?.auth, 'Bearer chave-de-teste');
    assert.equal(lastRequest?.body.model, 'jev-latest');
    assert.deepEqual(lastRequest?.body.state, { legenda: 'oi' });
    assert.equal(lastRequest?.body.questions.x.type, 'noul');
  });

  it('traduz erros sem expor a chave', async () => {
    reply = { status: 401, body: { detail: 'invalid key' } };
    await assert.rejects(jevClient.systemOne('x', { q: { type: 'noul' } }), (e: any) => e.status === 503 && !/chave-de-teste/.test(e.message));
    reply = { status: 422, body: { detail: [{ loc: ['body', 'questions'], msg: 'field required', type: 'missing' }] } };
    await assert.rejects(jevClient.systemOne('x', { q: { type: 'noul' } }), /body\.questions: field required/);
  });
});

describe('revisão de legenda', () => {
  const loja = findAccount('loja')!; // a pasta da fixture tem claude.md
  const autora = findAccount('autora')!; // sem claude.md

  it('nota composta com os pesos do código e perfil da conta no estado', async () => {
    const db = openDb(':memory:');
    const { client, calls } = fakeJev(goodAnswers);
    const r = await rv.reviewCaption(db, client, loja, { caption: '5 erros ao decorar a sala\n\nSalve para consultar depois.', kind: 'carousel' });
    // gancho 1 · 35, clareza 2/3 · 25, cta 0,9 · 20, tom 1 · 20  => (35 + 16,67 + 18 + 20) / 100
    assert.equal(r.grade, 90);
    assert.equal(r.toneEvaluated, true);
    assert.match(calls[0].state.perfil_da_conta, /É UMA LOJA/);
    assert.equal(calls[0].state.primeira_linha, '5 erros ao decorar a sala');
    assert.equal(calls[0].state.formato, 'Carrossel');
    assert.equal(Object.keys(calls[0].questions).length, 8, 'uma chamada com todas as perguntas');
    assert.equal(r.hook?.value, 'Número/lista');
    assert.equal(r.style?.uncertain, true, 'confiança 0,4 fica marcada como dúvida');
    assert.equal(r.objective.label, 'Salvamento');
    assert.deepEqual(r.warnings, []);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM jev_calls').get() as any).n, 1);
  });

  it('sem claude.md não pergunta o tom e redistribui os pesos', async () => {
    const { client, calls } = fakeJev(goodAnswers);
    const r = await rv.reviewCaption(openDb(':memory:'), client, autora, { caption: 'Texto' });
    assert.equal(calls[0].questions.tom, undefined);
    assert.equal(r.toneEvaluated, false);
    assert.equal(r.dimensions.length, 3);
    assert.equal(r.grade, Math.round(((35 + (25 * 2) / 3 + 18) / 80) * 100));
  });

  it('dicas e alertas: gancho fraco, venda sem CTA, risco, hashtags', async () => {
    const { client } = fakeJev({ ...goodAnswers, gancho: score(0), cta: noul(0.1), risco: noul(0.8), objetivo: choice('venda'), gancho_tipo: choice('Outro') });
    const caption = `Compre já ${'#tag '.repeat(31)}`;
    const r = await rv.reviewCaption(openDb(':memory:'), client, loja, { caption });
    assert.ok(r.tips.some((t) => /1ª linha/.test(t)));
    assert.ok(r.tips.some((t) => /pedindo uma ação/.test(t)));
    assert.ok(r.warnings.some((w) => /venda sem chamada/.test(w)));
    assert.ok(r.warnings.some((w) => /tema sensível/.test(w)));
    assert.ok(r.warnings.some((w) => /31 hashtags/.test(w)));
    assert.equal(r.hook, null, '"Outro" não vira sugestão');
  });

  it('recusa legenda vazia sem chamar o Jev', async () => {
    const { client, calls } = fakeJev(goodAnswers);
    await assert.rejects(rv.reviewCaption(openDb(':memory:'), client, loja, { caption: '   ' }), (e: any) => e.status === 400);
    assert.equal(calls.length, 0);
  });

  it('regras fixas', () => {
    assert.deepEqual(rv.captionChecks('Curta'), { tips: [], warnings: [] });
    assert.match(rv.captionChecks('a #1 #2 #3 #4 #5 #6').tips[0], /6 hashtags/);
    assert.match(rv.captionChecks('x'.repeat(130)).tips[0], /1ª linha tem 130/);
    assert.match(rv.captionChecks('x'.repeat(2201)).warnings[0], /2200/);
  });
});

describe('classificação automática', () => {
  function seed() {
    const db = openDb(':memory:');
    const ins = db.prepare(`INSERT INTO media(id, account_id, media_type, caption, permalink, timestamp, synced_at) VALUES(?, 'loja', 'IMAGE', ?, '', ?, 0)`);
    ins.run('a', 'Você sabia que a luz muda tudo?', '2026-10-01T00:00:00Z');
    ins.run('b', 'Bastidores da montagem do kit', '2026-10-02T00:00:00Z');
    ins.run('c', 'Post confuso', '2026-10-03T00:00:00Z');
    ins.run('d', '', '2026-10-04T00:00:00Z'); // sem legenda: ignorado
    ins.run('e', 'Já registrado à mão', '2026-10-05T00:00:00Z');
    db.prepare(`INSERT INTO media_tags(media_id, account_id, hook, style) VALUES('e', 'loja', 'Promessa', 'Humor')`).run();
    return db;
  }
  const byCaption = (state: any): Record<string, Answer> =>
    /sabia/.test(state.legenda)
      ? { gancho_tipo: choice('Pergunta', 0.85), estilo: choice('Educativo', 0.8) }
      : /Bastidores/.test(state.legenda)
        ? { gancho_tipo: choice('Outro', 0.9), estilo: choice('Bastidores', 0.75) }
        : { gancho_tipo: choice('Pergunta', 0.3), estilo: choice('Humor', 0.2) };

  it('grava só o que tem confiança, marca como Jev e não repete', async () => {
    const db = seed();
    const { client, calls } = fakeJev(byCaption);
    const r = await rv.autotagPosts(db, client, 'loja');
    assert.deepEqual(r, { tagged: 2, uncertain: 1, failed: 0, remaining: 0 });
    assert.equal(calls.length, 3);
    const tags = Object.fromEntries((db.prepare('SELECT * FROM media_tags ORDER BY media_id').all() as any[]).map((t) => [t.media_id, t]));
    assert.deepEqual([tags.a.hook, tags.a.style, tags.a.tagged_by], ['Pergunta', 'Educativo', 'jev']);
    assert.deepEqual([tags.b.hook, tags.b.style], [null, 'Bastidores']);
    assert.deepEqual([tags.c.hook, tags.c.style], [null, null]);
    assert.deepEqual([tags.e.hook, tags.e.tagged_by], ['Promessa', null], 'registro manual intocado');
    assert.equal(rv.pendingAutotag(db, 'loja'), 0);
    await rv.autotagPosts(db, client, 'loja');
    assert.equal(calls.length, 3, 'não consulta de novo os que já passaram');
  });

  it('para na chave inválida', async () => {
    const db = seed();
    const client: JevClient = {
      async systemOne() {
        throw new JevError(503, 'Jev recusou a chave');
      },
    };
    await assert.rejects(rv.autotagPosts(db, client, 'loja'), /recusou a chave/);
    assert.equal(rv.pendingAutotag(db, 'loja'), 3);
  });
});
